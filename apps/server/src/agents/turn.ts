import { hydrateMessageImages } from '../attachments/service.ts';
import { accountKey } from '../auth/context.ts';
import { convertToModelMessages, isStepCount, streamText, toUIMessageStream, type StopCondition, type UIMessageChunk } from 'ai';
import { and, eq } from 'drizzle-orm';
import { cleanModelText, type MessageMetadata } from '@opendots/shared';
import { config } from '../config.ts';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { log } from '../journal.ts';
import { resolveModel } from '../models/gateway.ts';
import { getTimezone } from '../settings.ts';
import { contextMemories } from '../memory/repo.ts';
import { listActivities } from '../activities/repo.ts';
import { getConversation, loadMessages, messageText, saveMessage, type OpenDotsUIMessage } from '../conversations/repo.ts';
import { effectiveModel, getAgent, listAgentRows, setAgentState, type AgentRow } from './repo.ts';
import { buildSystemPrompt, type TurnMode } from './prompt.ts';
import { buildTools, toolActivityLabel } from './tools.ts';
import { buildCapabilityTools } from './capability-tools.ts';
import { ActiveStream, beginStream, finishStream } from './streams.ts';
import { errorMessage, KeyedMutex, newId } from '../util.ts';

export type TurnTrigger =
  | { kind: 'user'; message: OpenDotsUIMessage }
  | { kind: 'event'; event: NonNullable<MessageMetadata['event']>; text: string; depth: number }
  | { kind: 'team'; teamMessageId: string; fromAgentId: string; expectsReply: boolean; depth: number };

export interface TurnResult {
  messageId: string | null;
  text: string;
  silent: boolean;
  error: string | null;
}

const agentLocks = new KeyedMutex();
const HISTORY_LIMIT = 40;
const HISTORY_CHAR_BUDGET = 60_000;
const SILENCE = /^\s*<silence\s*\/?>\s*$/i;
const VISIBLE_EFFECT_TOOLS = /^(activity_(create|update|delete)|mail_prepare|ask_user|connection_request_setup|agent_create|skill_save|team_send_message|mcp_.+|svc_.+|computer_action)$/;

/** Le tour s'arrête dès qu'un formulaire a été présenté à l'utilisateur. */
const formShown: StopCondition<any> = ({ steps }) =>
  (steps[steps.length - 1]?.toolResults ?? []).some(
    (r: any) => r.toolName === 'ask_user' && (r.output as { status?: string } | undefined)?.status === 'awaiting_user',
  );

export function isAgentBusy(agentId: string) {
  return agentLocks.isLocked(`${accountKey()}:${agentId}`);
}

function compactToolOutput(output: unknown): unknown {
  const json = JSON.stringify(output ?? null);
  if (json.length <= 3000) return output;
  return { truncated: true, preview: json.slice(0, 3000) };
}

/** Prépare l'historique pour le modèle : rôles, événements, sorties d'outils compactées. */
function historyForModel(
  messages: OpenDotsUIMessage[],
  self: AgentRow,
  names: Map<string, string>,
  pair: boolean,
): OpenDotsUIMessage[] {
  const out: OpenDotsUIMessage[] = [];
  let budget = HISTORY_CHAR_BUDGET;
  for (const m of [...messages].reverse()) {
    const meta = m.metadata ?? {};
    let msg: OpenDotsUIMessage;
    if (meta.kind === 'event') {
      msg = { ...m, role: 'user', parts: [{ type: 'text', text: `[Événement : ${meta.event?.title ?? 'système'}]\n${messageText(m)}` }] };
    } else if (pair) {
      const mine = meta.agentId === self.id;
      msg = mine
        ? { ...m, role: 'assistant' }
        : { ...m, role: 'user', parts: [{ type: 'text', text: `${names.get(meta.agentId ?? '') ?? 'Compagnon'} : ${messageText(m)}` }] };
    } else {
      msg = m;
    }
    if (msg.role === 'assistant') {
      msg = {
        ...msg,
        parts: msg.parts
          .filter((p) => p.type !== 'reasoning')
          .map((p: any) => (p.type?.startsWith('tool-') && 'output' in p ? { ...p, output: compactToolOutput(p.output) } : p)),
      };
    }
    budget -= JSON.stringify(msg.parts).length;
    if (budget < 0 && out.length >= 2) break;
    out.push(msg);
  }
  out.reverse();
  // L'historique doit commencer par un message utilisateur.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * Exécute un tour complet d'un compagnon. Le tour s'exécute côté serveur,
 * indépendamment de toute connexion client, et diffuse ses chunks dans un
 * flux actif que les clients peuvent rejoindre à tout moment.
 */
export function runTurn(
  agentId: string,
  conversationId: string,
  trigger: TurnTrigger,
): { stream: ActiveStream; done: Promise<TurnResult> } {
  const stream = new ActiveStream(conversationId);
  const done = agentLocks.run(`${accountKey()}:${agentId}`, () => executeTurn(agentId, conversationId, trigger, stream));
  done.catch(() => finishStream(stream));
  return { stream, done };
}

async function executeTurn(
  agentId: string,
  conversationId: string,
  trigger: TurnTrigger,
  stream: ActiveStream,
): Promise<TurnResult> {
  const agent = await getAgent(agentId);
  const conversation = await getConversation(conversationId);
  if (!agent || agent.archived || !conversation) {
    finishStream(stream);
    return { messageId: null, text: '', silent: true, error: 'Compagnon ou conversation introuvable' };
  }
  const pair = conversation.kind === 'pair';
  const autonomous = trigger.kind !== 'user';
  const team = await listAgentRows();
  const names = new Map(team.map((a) => [a.id, a.name]));
  const tz = await getTimezone();

  // 1. Message déclencheur
  let triggerMessageId: string | null = null;
  let mode: TurnMode;
  let hint = '';
  if (trigger.kind === 'user') {
    const msg: OpenDotsUIMessage = {
      ...trigger.message,
      metadata: { ...(trigger.message.metadata ?? {}), kind: 'chat', createdAt: new Date().toISOString() },
    };
    await saveMessage(conversationId, msg, { author: 'user' });
    triggerMessageId = msg.id;
    mode = { kind: 'user' };
    hint = messageText(msg);
  } else if (trigger.kind === 'event') {
    triggerMessageId = newId('msg');
    await saveMessage(
      conversationId,
      {
        id: triggerMessageId,
        role: 'user',
        parts: [{ type: 'text', text: trigger.text }],
        metadata: { kind: 'event', event: trigger.event, createdAt: new Date().toISOString(), autonomous: true },
      },
      { author: 'event', agentId },
    );
    mode = { kind: 'event', title: trigger.event.title };
    hint = `${trigger.event.title} ${trigger.text}`;
  } else {
    // Le message du coéquipier est déjà enregistré dans le fil.
    mode = { kind: 'team', peerName: names.get(trigger.fromAgentId) ?? 'un compagnon', expectsReply: trigger.expectsReply };
  }

  const depth = trigger.kind === 'user' ? 0 : trigger.depth;
  const toolCtx = { agent, conversationId, isMain: !pair, userTurn: trigger.kind === 'user', depth, tz };
  const capabilities = await buildCapabilityTools(toolCtx);
  const tools = { ...capabilities.tools, ...buildTools(toolCtx) };

  const { messages: stored } = await loadMessages(conversationId, { limit: HISTORY_LIMIT });
  if (trigger.kind === 'team' && !hint) hint = messageText(stored[stored.length - 1] ?? { parts: [] });
  const history = historyForModel(stored, agent, names, pair);

  const [memories, activities, pending] = await Promise.all([
    contextMemories(agent.id, hint),
    listActivities(agent.id),
    db()
      .select({ id: schema.approvals.id, summary: schema.approvals.summary })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.agentId, agent.id), eq(schema.approvals.status, 'pending'))),
  ]);

  const system = buildSystemPrompt({
    agent,
    team,
    memories,
    activities,
    pendingApprovals: pending,
    skills: capabilities.info.skills,
    connectors: capabilities.info.connectors,
    mode,
    tz,
    now: new Date(),
    toolNames: Object.keys(tools),
  });

  const modelCfg = await effectiveModel(agent);
  const responseId = newId('msg');
  let turnError: string | null = null;
  let finalMessage: OpenDotsUIMessage | null = null;

  beginStream(stream);
  publish({ type: 'turn.started', agentId, conversationId, autonomous });
  await setAgentState(agentId, pair ? 'collaborating' : autonomous ? 'awake' : 'thinking', mode.kind === 'event' ? mode.title : null);

  try {
    const resolved = await resolveModel(modelCfg);
    const result = streamText({
      model: resolved.model,
      instructions: system,
      messages: await convertToModelMessages(await hydrateMessageImages(history), { ignoreIncompleteToolCalls: true, tools }),
      tools,
      stopWhen: [isStepCount(config.maxStepsPerTurn), formShown],
      providerOptions: resolved.providerOptions,
      maxRetries: 2,
      abortSignal: stream.abort.signal,
      timeout: { totalMs: 30 * 60_000, toolMs: 60_000, tools: { shell_execMs: 31 * 60_000 } } as any,
      onError: ({ error }) => {
        turnError = errorMessage(error);
      },
    });

    const metadata: MessageMetadata = {
      kind: pair ? 'team' : 'chat',
      agentId,
      model: resolved.label,
      autonomous,
    };

    const uiStream = toUIMessageStream<typeof tools, OpenDotsUIMessage>({
      stream: result.stream,
      generateMessageId: () => responseId,
      sendReasoning: true,
      messageMetadata: ({ part }) => (part.type === 'start' ? { ...metadata, createdAt: new Date().toISOString() } : undefined),
      // Erreurs d'outils incluses : elles sont renvoyées au modèle, qui peut corriger.
      // Les erreurs fatales du flux sont capturées par onError de streamText.
      onError: (error) => errorMessage(error).slice(0, 2000),
      onEnd: ({ responseMessage }) => {
        finalMessage = responseMessage;
      },
    });

    for await (const chunk of uiStream as unknown as AsyncIterable<UIMessageChunk>) {
      stream.push(chunk);
      if (chunk.type === 'tool-input-start') {
        const label = toolActivityLabel(chunk.toolName);
        void setAgentState(agentId, chunk.toolName === 'team_send_message' ? 'collaborating' : 'working', label);
      } else if (chunk.type === 'text-start') {
        void setAgentState(agentId, pair ? 'collaborating' : 'thinking', null);
      }
    }
  } catch (err) {
    turnError = errorMessage(err);
    stream.push({ type: 'error', errorText: `Le modèle a rencontré une erreur : ${turnError}` });
  }

  if (stream.abort.signal.aborted) turnError = null;

  // 2. Persistance de la réponse
  const response = finalMessage as OpenDotsUIMessage | null;
  const text = response ? messageText(response) : '';
  // Un réveil n'est masqué que s'il n'a rien produit de visible pour l'utilisateur.
  const acted = (response?.parts ?? []).some((p: any) => typeof p.type === 'string' && VISIBLE_EFFECT_TOOLS.test(p.type.slice(5)) && p.output?.ok !== false);
  const silent = autonomous && !pair && !acted && (SILENCE.test(text) || (!text && !turnError));
  if (response && response.parts.length) {
    const parts = (SILENCE.test(text) ? response.parts.filter((p) => p.type !== 'text') : response.parts).map((p) =>
      p.type === 'text' ? { ...p, text: cleanModelText(p.text) } : p,
    );
    await saveMessage(
      conversationId,
      { ...response, id: responseId, role: 'assistant', parts, metadata: { ...(response.metadata ?? {}), createdAt: new Date().toISOString() } },
      { author: 'agent', agentId, hidden: silent },
    );
  }
  if (silent && triggerMessageId) {
    await db().update(schema.messages).set({ hidden: true }).where(eq(schema.messages.id, triggerMessageId));
  }

  finishStream(stream);
  publish({ type: 'turn.finished', agentId, conversationId });

  if (turnError) {
    await setAgentState(agentId, 'error', turnError.slice(0, 200));
    await log(agentId, 'turn.error', `Erreur pendant un tour : ${turnError.slice(0, 200)}`, { conversationId, trigger: trigger.kind });
  } else {
    await setAgentState(agentId, autonomous && !pair ? 'sleeping' : 'available', null);
    if (autonomous) {
      await log(agentId, silent ? 'turn.silent' : 'turn.autonomous', silent ? 'Réveil traité sans message' : 'Message autonome envoyé', {
        conversationId,
        trigger: trigger.kind === 'event' ? trigger.event : trigger.kind,
      });
    }
  }

  return { messageId: response ? responseId : null, text: SILENCE.test(text) ? '' : text, silent, error: turnError };
}
