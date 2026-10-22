import { desktopVisionMessages } from '../computer/vision.ts';
import { compactSemanticObservations } from '../computer/semantic-context.ts';
import { abortableChunks } from './abortable.ts';
import { interruptedMessage, INTERRUPTED } from './interruption.ts';
import { hydrateMessageImages } from '../attachments/service.ts';
import { accountKey } from '../auth/context.ts';
import { convertToModelMessages, isStepCount, streamText, toUIMessageStream, type StopCondition, type UIMessageChunk } from 'ai';
import { and, eq } from 'drizzle-orm';
import { cleanModelText, type MessageMetadata } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { log } from '../journal.ts';
import { resolveModel, requireDesktopVision } from '../models/gateway.ts';
import { getTimezone, getTurnStepLimit } from '../settings.ts';
import { contextMemories } from '../memory/repo.ts';
import { listActivities } from '../activities/repo.ts';
import { getConversation, loadMessages, messageText, saveMessage, type OpenDotsUIMessage } from '../conversations/repo.ts';
import { effectiveModel, getAgent, listAgentRows, setAgentState, type AgentRow } from './repo.ts';
import { buildSystemPrompt, type TurnMode } from './prompt.ts';
import { buildTools, toolActivityLabel } from './tools.ts';
import { buildCapabilityTools } from './capability-tools.ts';
import { activeToolNames } from './lazy-tools.ts';
import { ActiveStream, beginStream, finishStream } from './streams.ts';
import { errorMessage, KeyedMutex, newId } from '../util.ts';

export type TurnTrigger =
  | { kind: 'onboarding' }
  | { kind: 'user'; message: OpenDotsUIMessage }
  | { kind: 'event'; event: NonNullable<MessageMetadata['event']>; text: string; depth: number }
  | { kind: 'team'; teamMessageId: string; fromAgentId: string; expectsReply: boolean; depth: number; nudge?: boolean };

export interface TurnResult {
  messageId: string | null;
  text: string;
  silent: boolean;
  error: string | null;
  /** Le compagnon a explicitement indiqué qu'aucune réponse n'était nécessaire (<no_reply/>). */
  noReply?: boolean;
}

const agentLocks = new KeyedMutex();
const HISTORY_LIMIT = 40;
const HISTORY_CHAR_BUDGET = 60_000;
const SILENCE = /^\s*<(silence|no[_-]?reply)\s*\/?>\s*$/i;
const VISIBLE_EFFECT_TOOLS = /^(activity_(create|update|delete)|mail_prepare|ask_user|connection_request_setup|computer_request_setup|agent_create|skill_save|team_send_message|mcp_.+|svc_.+|computer_action|computer_target|computer_keyboard)$/;

/** Le tour s'arrête dès qu'un formulaire a été présenté à l'utilisateur. */
const formShown: StopCondition<any> = ({ steps }) =>
  (steps[steps.length - 1]?.toolResults ?? []).some(
    (r: any) => r.toolName === 'ask_user' && (r.output as { status?: string } | undefined)?.status === 'awaiting_user',
  );

export function isAgentBusy(agentId: string) {
  return agentLocks.isLocked(`${accountKey()}:${agentId}`);
}

const MESSAGE_CHAR_CAP = 12_000;

function compactToolOutput(output: unknown, max = 3000): unknown {
  const json = JSON.stringify(output ?? null);
  if (json.length <= max) return output;
  return { truncated: true, preview: json.slice(0, max) };
}

/**
 * Compacte entrées et sorties d'outils d'un message assistant. Un seul tour
 * très outillé (fichiers écrits via le shell, longues listes) ne doit pas
 * consommer tout le budget et faire oublier le reste de la conversation.
 */
function compactAssistantParts(parts: any[], preserveScreenshots: Set<string>): any[] {
  const pass = (max: number) => parts
    .filter((p) => p.type !== 'reasoning')
    .map((p: any) => {
      if (!p.type?.startsWith('tool-')) return p;
      if (['tool-computer_screenshot', 'tool-computer_action'].includes(p.type) && preserveScreenshots.has(p.output?.screenshotId)) {
        // Keep image identity and valid original arguments even in a busy turn.
        // A generic preview would silently prevent toModelOutput loading the PNG.
        const o = p.output;
        return { ...p, output: { ok: o.ok, status: o.status, actionExecuted: o.actionExecuted, screenshotId: o.screenshotId, url: o.url, width: o.width, height: o.height, capturedAt: o.capturedAt, cursor: o.cursor, focusedWindow: o.focusedWindow ? { ...o.focusedWindow, title: o.focusedWindow.title?.slice(0, 80), wmClass: o.focusedWindow.wmClass?.slice(0, 80) } : o.focusedWindow, note: o.note?.slice(0, 300) } };
      }
      // Never replay {preview,truncated} as tool arguments: the model may copy
      // that invalid shape into its next call (or run a truncated command).
      if ((p.type === 'tool-shell_exec' && typeof p.input?.command !== 'string') || ('input' in p && JSON.stringify(p.input ?? null).length > max)) return { type: 'text', text: `[Historical ${p.type.slice(5)} call (${p.state}): invalid or oversized arguments omitted. This is a summary, not an executable tool call. Result: ${JSON.stringify(compactToolOutput(p.output ?? p.errorText, max))}]` };
      return { ...p, ...('output' in p ? { output: compactToolOutput(p.output, max) } : {}) };
    });
  let out = pass(3000);
  if (JSON.stringify(out).length > MESSAGE_CHAR_CAP) out = pass(400);
  return out;
}

/** Prépare l'historique pour le modèle : rôles, événements, sorties d'outils compactées. */
export function historyForModel(
  messages: OpenDotsUIMessage[],
  self: AgentRow,
  names: Map<string, string>,
  pair: boolean,
): OpenDotsUIMessage[] {
  const out: OpenDotsUIMessage[] = [];
  const preserveScreenshots = new Set<string>();
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant' || message.metadata?.kind === 'event' || (pair && message.metadata?.agentId !== self.id)) continue;
    for (const part of [...message.parts].reverse() as any[]) {
      if (preserveScreenshots.size < 2 && ['tool-computer_screenshot', 'tool-computer_action'].includes(part.type) && part.output?.screenshotId) preserveScreenshots.add(part.output.screenshotId);
    }
    if (preserveScreenshots.size >= 2) break;
  }
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
        parts: compactAssistantParts(msg.parts as any[], preserveScreenshots) as OpenDotsUIMessage['parts'],
      };
    }
    budget -= JSON.stringify(msg.parts).length;
    if (budget < 0 && out.length >= 2) break;
    out.push(msg);
  }
  out.reverse();
  let screenshots = 2;
  for (const msg of [...out].reverse()) for (const part of [...msg.parts].reverse() as any[]) {
    if (['tool-computer_screenshot', 'tool-computer_action'].includes(part.type) && part.output?.screenshotId && --screenshots < 0) {
      const { screenshotId, url, ...rest } = part.output;
      part.output = { ...rest, screenshot: 'omitted_from_history' };
    }
  }
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
  // Also checked under the agent lock: a queued/retried greeting must never
  // interrupt an existing conversation or introduce a second welcome.
  if (trigger.kind === 'onboarding' && (await loadMessages(conversationId, { limit: 1 })).messages.length) {
    finishStream(stream);
    return { messageId: null, text: '', silent: true, error: null };
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
  if (trigger.kind === 'onboarding') {
    mode = { kind: 'onboarding' };
    hint = 'Première rencontre';
  } else if (trigger.kind === 'user') {
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
    mode = { kind: 'event', title: trigger.event.title, eventType: trigger.event.type };
    hint = `${trigger.event.title} ${trigger.text}`;
  } else {
    // Le message du coéquipier est déjà enregistré dans le fil.
    mode = { kind: 'team', peerName: names.get(trigger.fromAgentId) ?? 'un compagnon', expectsReply: trigger.expectsReply, nudge: trigger.nudge };
  }

  const depth = trigger.kind === 'user' || trigger.kind === 'onboarding' ? 0 : trigger.depth;
  const toolCtx = {
    agent,
    conversationId,
    isMain: !pair,
    userTurn: trigger.kind === 'user',
    depth,
    tz,
    abortSignal: stream.abort.signal,
    peerAgentId: trigger.kind === 'team' ? trigger.fromAgentId : undefined,
  };
  const capabilities = trigger.kind === 'onboarding'
    ? { tools: {}, info: { connectors: [] as string[], skills: [] }, lazy: { loaded: new Set<string>(), names: new Set<string>(), groups: [] } }
    : await buildCapabilityTools(toolCtx);
  const tools = trigger.kind === 'onboarding' ? {} : { ...capabilities.tools, ...buildTools(toolCtx) };
  const modelCfg = await effectiveModel(agent);
  if (tools.computer_screenshot) {
    try { await requireDesktopVision(modelCfg); }
    catch (error) {
      delete tools.computer_screenshot; delete tools.computer_action;
      capabilities.info.connectors.push(`Captures et actions par coordonnées indisponibles : ${errorMessage(error)} Utilise computer_inspect, browser_inspect et computer_target pour les éléments nommés, puis computer_keyboard pour la saisie sans vision. Pour les captures, propose un modèle vision.`);
    }
  }

  const { messages: stored } = await loadMessages(conversationId, { limit: HISTORY_LIMIT });
  if (trigger.kind === 'team' && !hint) hint = messageText(stored[stored.length - 1] ?? { parts: [] });
  const history = historyForModel(stored, agent, names, pair);
  if (trigger.kind === 'onboarding') history.push({ id: newId('msg'), role: 'user', parts: [{ type: 'text', text: 'L’utilisateur vient de terminer la configuration et de te rencontrer. Engage maintenant la conversation avec un bref accueil et une seule question pour faire connaissance.' }] });
  if (trigger.kind === 'team' && trigger.nudge) {
    history.push({
      id: newId('msg'),
      role: 'user',
      parts: [{ type: 'text', text: `[Système] Tu as terminé sans répondre à ${names.get(trigger.fromAgentId) ?? 'ton coéquipier'}. Écris maintenant ta réponse (elle lui sera transmise), ou exactement <no_reply/> si aucune réponse n'est nécessaire.` }],
    } as OpenDotsUIMessage);
  }

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
    toolNames: activeToolNames(tools, capabilities.lazy),
  });

  const responseId = newId('msg');
  let turnError: string | null = null;
  let finalMessage: OpenDotsUIMessage | null = null;
  const stepLimit = await getTurnStepLimit();
  let limitReached = false;
  let limitNotice: string | null = null;

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
      // Outils de services chargés à la demande : load_tools les active dès l'étape suivante.
      activeTools: activeToolNames(tools, capabilities.lazy) as any,
      prepareStep: ({ messages, stepNumber }) => {
        const prepared = compactSemanticObservations(desktopVisionMessages(messages));
        if (stepLimit === null || stepNumber < stepLimit) return { activeTools: activeToolNames(tools, capabilities.lazy) as any, messages: prepared };
        limitReached = true;
        return {
          activeTools: [], toolChoice: 'none' as const, messages: prepared,
          instructions: system + '\n\nThe work-step budget is exhausted. Read the LAST tool result and give the user a concise, honest progress report: verified results, unfinished work and the next action. Do not call tools, claim unfinished work is complete, or return <silence/>. The server will display the limit notice.',
        };
      },
      // No default step limit. If explicitly configured, reserve a synthesis.
      stopWhen: stepLimit === null ? [formShown] : [isStepCount(stepLimit + 1), formShown],
      providerOptions: resolved.providerOptions,
      maxRetries: 2,
      abortSignal: stream.abort.signal,
      timeout: { totalMs: 30 * 60_000, toolMs: 60_000, tools: { shell_execMs: 31 * 60_000 } } as any,
      onError: ({ error }) => {
        turnError = errorMessage(error);
      },
    });

    const metadata: MessageMetadata = {
      ...(trigger.kind === 'onboarding' ? { setup: true } : {}),
      kind: pair ? 'team' : 'chat',
      agentId,
      model: resolved.label,
      autonomous,
    };
    const modelSteps: NonNullable<MessageMetadata['modelSteps']> = [];

    const uiStream = toUIMessageStream<typeof tools, OpenDotsUIMessage>({
      stream: result.stream,
      generateMessageId: () => responseId,
      sendReasoning: true,
      messageMetadata: ({ part }) => {
        if (part.type === 'start') return { ...metadata, createdAt: new Date().toISOString() };
        if (part.type !== 'finish-step') return;
        const provider = part.providerMetadata?.openrouter?.provider;
        modelSteps.push({ step: modelSteps.length + 1, model: part.response.modelId || resolved.label, provider: typeof provider === 'string' && provider.trim() ? provider.trim().slice(0, 120) : null, responseId: part.response.id ?? null });
        return { modelSteps: [...modelSteps] };
      },
      // Erreurs d'outils incluses : elles sont renvoyées au modèle, qui peut corriger.
      // Les erreurs fatales du flux sont capturées par onError de streamText.
      onError: (error) => errorMessage(error).slice(0, 2000),
      onEnd: ({ responseMessage }) => {
        finalMessage = responseMessage;
      },
    });

    for await (const chunk of abortableChunks(uiStream, stream.abort.signal)) {
      if (chunk.type === 'finish' && limitReached && !turnError && !stream.abort.signal.aborted) {
        limitNotice = `\n\nLimite de ${stepLimit} étapes de travail atteinte : ce tour est suspendu et la tâche peut être incomplète. Tu peux me demander de continuer pour reprendre.`;
        const id = newId('limit');
        stream.push({ type: 'text-start', id });
        stream.push({ type: 'text-delta', id, delta: limitNotice });
        stream.push({ type: 'text-end', id });
      }
      stream.push(chunk);
      if (chunk.type === 'tool-input-start') {
        const label = toolActivityLabel(chunk.toolName);
        void setAgentState(agentId, chunk.toolName === 'team_send_message' ? 'collaborating' : 'working', label).catch((error) => console.error('[agent state]', error));
      } else if (chunk.type === 'text-start') {
        void setAgentState(agentId, pair ? 'collaborating' : 'thinking', null).catch((error) => console.error('[agent state]', error));
      }
    }
  } catch (err) {
    turnError = errorMessage(err);
    if (!stream.abort.signal.aborted) stream.push({ type: 'error', errorText: `Le modèle a rencontré une erreur : ${turnError}` });
  }

  if (stream.abort.signal.aborted) {
    turnError = null;
    finalMessage = interruptedMessage(finalMessage, stream.chunks, responseId);
    for (const part of finalMessage.parts as any[]) if (part.state === 'output-error' && part.errorText === INTERRUPTED) stream.push({ type: 'tool-output-error', toolCallId: part.toolCallId, errorText: INTERRUPTED });
  }

  if (limitNotice && !stream.abort.signal.aborted) {
    finalMessage ??= { id: responseId, role: 'assistant', parts: [], metadata: { agentId, kind: pair ? 'team' : 'chat', autonomous } };
    (finalMessage as OpenDotsUIMessage).parts.push({ type: 'text', text: limitNotice.trim() });
    await log(agentId, 'turn.limit', `Limite de ${stepLimit} étapes atteinte ; synthèse demandée et suspension affichée.`, { conversationId, trigger: trigger.kind });
  }

  // 2. Persistance de la réponse
  const response = finalMessage as OpenDotsUIMessage | null;
  const text = response ? messageText(response) : '';
  // Un réveil n'est masqué que s'il n'a rien produit de visible pour l'utilisateur.
  const acted = (response?.parts ?? []).some((p: any) => typeof p.type === 'string' && VISIBLE_EFFECT_TOOLS.test(p.type.slice(5)) && p.output?.ok !== false);
  // Une réponse d'un coéquipier est toujours montrée à l'utilisateur (jamais masquée).
  const mustSurface = trigger.kind === 'event' && trigger.event.type === 'agent_reply';
  const silent = autonomous && !pair && !acted && !mustSurface && (SILENCE.test(text) || (!text && !turnError));
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
    await setAgentState(agentId, autonomous && trigger.kind !== 'onboarding' && !pair ? 'sleeping' : 'available', null);
    if (autonomous) {
      await log(agentId, silent ? 'turn.silent' : 'turn.autonomous', silent ? 'Réveil traité sans message' : 'Message autonome envoyé', {
        conversationId,
        trigger: trigger.kind === 'event' ? trigger.event : trigger.kind,
      });
    }
  }

  return {
    messageId: response ? responseId : null,
    text: SILENCE.test(text) ? '' : text,
    silent,
    error: turnError,
    noReply: /^\s*<no[_-]?reply\s*\/?>\s*$/i.test(text),
  };
}
