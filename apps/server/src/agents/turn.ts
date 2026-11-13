import { desktopVisionMessages } from '../computer/vision.ts';
import { compactSemanticObservations } from '../computer/semantic-context.ts';
import { abortableChunks } from './abortable.ts';
import { interruptedMessage, INTERRUPTED } from './interruption.ts';
import { hydrateMessageImages } from '../attachments/service.ts';
import { accountKey } from '../auth/context.ts';
import { convertToModelMessages, isStepCount, streamText, toUIMessageStream, type StopCondition, type UIMessageChunk } from 'ai';
import { and, eq } from 'drizzle-orm';
import { cleanModelText, type MessageMetadata, type MessageReplyRef } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { log } from '../journal.ts';
import { resolveModel, requireDesktopVision } from '../models/gateway.ts';
import { getTimezone, getTurnStepLimit } from '../settings.ts';
import { contextMemories } from '../memory/repo.ts';
import { listActivities } from '../activities/repo.ts';
import { getConversation, loadMessages, finalText, messageText, resolveReply, saveMessage, type OpenDotsUIMessage } from '../conversations/repo.ts';
import { effectiveModel, getAgent, listAgentRows, mainConversationId, setAgentState, type AgentRow } from './repo.ts';
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
  /** Pendant un échange entre compagnons, le compagnon a écrit à l'utilisateur dans son fil principal. */
  toldUser?: boolean;
}

const toolLocks = new KeyedMutex();
const HISTORY_LIMIT = 40;
const HISTORY_CHAR_BUDGET = 60_000;
const SILENCE = /^\s*<(silence|no[_-]?reply)\s*\/?>\s*$/i;
const VISIBLE_EFFECT_TOOLS = /^(activity_(create|update|delete)|mail_prepare|ask_user|connection_request_setup|computer_request_setup|agent_create|skill_save|team_send_message|mcp_.+|svc_.+|computer_action|computer_target|computer_keyboard)$/;

/** Le tour s'arrête dès qu'un formulaire a été présenté à l'utilisateur. */
const formShown: StopCondition<any> = ({ steps }) =>
  (steps[steps.length - 1]?.toolResults ?? []).some(
    (r: any) => r.toolName === 'ask_user' && (r.output as { status?: string } | undefined)?.status === 'awaiting_user',
  );

/** Après ce nombre d'étapes d'outils sans phrase pour l'utilisateur, le tour doit envoyer un statut. */
const STATUS_GAP = 4;

interface LiveTurn {
  key: string;
  agentId: string;
  conversationId: string;
  hint: string;
  detached: boolean;
  stream: ActiveStream;
}

interface RunSlot {
  foreground: LiveTurn | null;
  background: LiveTurn[];
  idle: Array<() => void>;
  tail: Promise<void>;
}

const runs = new Map<string, RunSlot>();

function runSlot(key: string): RunSlot {
  let slot = runs.get(key);
  if (!slot) {
    slot = { foreground: null, background: [], idle: [], tail: Promise.resolve() };
    runs.set(key, slot);
  }
  return slot;
}

function notifyIdle(slot: RunSlot) {
  const waiters = slot.idle;
  slot.idle = [];
  for (const wake of waiters) wake();
}

function waitUntilIdle(slot: RunSlot) {
  if (!slot.foreground) return Promise.resolve();
  return new Promise<void>((resolve) => slot.idle.push(resolve));
}

function detachTurn(turn: LiveTurn) {
  const slot = runSlot(turn.key);
  turn.detached = true;
  if (slot.foreground === turn) slot.foreground = null;
  if (!slot.background.includes(turn)) slot.background.push(turn);
  notifyIdle(slot);
}

function releaseTurn(turn: LiveTurn) {
  const slot = runSlot(turn.key);
  if (slot.foreground === turn) slot.foreground = null;
  slot.background = slot.background.filter((item) => item !== turn);
  notifyIdle(slot);
}

function turnHint(trigger: TurnTrigger): string {
  if (trigger.kind === 'user') return messageText(trigger.message).slice(0, 240) || 'Message';
  if (trigger.kind === 'event') return trigger.event.title;
  if (trigger.kind === 'team') return 'Message d’un coéquipier';
  return 'Accueil';
}

export function isAgentBusy(agentId: string) {
  const slot = runs.get(`${accountKey()}:${agentId}`);
  return Boolean(slot && (slot.foreground || slot.background.length));
}

/** Arrête le tour affiché et les travaux passés en arrière-plan. */
export function stopAgent(agentId: string) {
  const slot = runs.get(`${accountKey()}:${agentId}`);
  if (!slot) return false;
  const turns = [slot.foreground, ...slot.background].filter((turn): turn is LiveTurn => Boolean(turn));
  for (const turn of turns) turn.stream.abort.abort();
  return turns.length > 0;
}

function statusDue(steps: { text?: string; toolCalls?: { toolName?: string }[] }[]) {
  let silent = 0;
  for (const step of steps) {
    const calls = step.toolCalls ?? [];
    const spoke = Boolean(step.text?.trim()) || calls.some((call) => call.toolName === 'text_user');
    if (spoke) silent = 0;
    else if (calls.length) silent += 1;
  }
  return silent >= STATUS_GAP;
}

function serializeTools(tools: Record<string, { execute?: (...args: any[]) => any }>, key: string) {
  for (const item of Object.values(tools)) {
    if (typeof item?.execute !== 'function') continue;
    const execute = item.execute;
    item.execute = (input: unknown, options: unknown) => toolLocks.run(key, () => execute(input, options));
  }
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
    msg = withModelNote(msg, modelNote(msg, names));
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

/** Identifiants, réponse citée et réactions, pour que le modèle puisse réagir ou répondre. */
function modelNote(msg: OpenDotsUIMessage, names: Map<string, string>): string {
  const lines = [`[message ${msg.id}]`];
  const reply = msg.metadata?.replyTo;
  if (reply?.messageId) lines.push(`[replying to ${reply.messageId}: ${reply.preview ?? ''}]`);
  const reactions = msg.metadata?.reactions ?? [];
  if (reactions.length) {
    lines.push(`[reactions: ${reactions.map((reaction) => `${reaction.emoji} ${reaction.actor === 'user' ? 'user' : (names.get(reaction.actor) ?? reaction.actor)}`).join(', ')}]`);
  }
  return lines.join('\n');
}

function withModelNote(msg: OpenDotsUIMessage, note: string): OpenDotsUIMessage {
  const parts = msg.parts.map((part) => ({ ...part }));
  const index = parts.findIndex((part) => part.type === 'text');
  if (index >= 0 && parts[index].type === 'text') parts[index] = { ...parts[index], text: `${note}\n${parts[index].text}` };
  else parts.unshift({ type: 'text', text: note });
  return { ...msg, parts };
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
  const key = `${accountKey()}:${agentId}`;
  const slot = runSlot(key);
  const live: LiveTurn = { key, agentId, conversationId, hint: turnHint(trigger), detached: false, stream };
  const empty: TurnResult = { messageId: null, text: '', silent: true, error: null };
  const finish = (result: TurnResult) => {
    releaseTurn(live);
    if (live.detached && !stream.abort.signal.aborted && !result.silent && (result.text.trim() || result.error)) {
      const summary = result.error
        ? `Le travail en arrière-plan s'est arrêté : ${result.error.slice(0, 500)}`
        : result.text.trim().slice(0, 4000);
      void runTurn(agentId, conversationId, {
        kind: 'event',
        event: { type: 'system', title: 'Travail en arrière-plan terminé' },
        text: `Le travail que tu faisais en arrière-plan est terminé.\n\n${summary}\n\nDis à l'utilisateur en une ou deux phrases ce qui est terminé. Ne refais pas le travail.`,
        depth: 0,
      }).done.catch((error) => console.error('[background]', error));
    }
  };

  if (trigger.kind === 'user') {
    if (slot.foreground) detachTurn(slot.foreground);
    slot.foreground = live;
    const done = (async () => {
      let result = empty;
      try {
        result = await executeTurn(agentId, conversationId, trigger, stream, live);
        return result;
      } finally {
        finish(result);
      }
    })();
    done.catch(() => finishStream(stream));
    return { stream, done };
  }

  const previous = slot.tail;
  let releaseTail!: () => void;
  slot.tail = new Promise<void>((resolve) => { releaseTail = resolve; });
  const done = previous.then(async () => {
    while (slot.foreground) await waitUntilIdle(slot);
    slot.foreground = live;
    let result = empty;
    try {
      result = await executeTurn(agentId, conversationId, trigger, stream, live);
      return result;
    } finally {
      finish(result);
      releaseTail();
    }
  });
  done.catch(() => finishStream(stream));
  return { stream, done };
}

async function executeTurn(
  agentId: string,
  conversationId: string,
  trigger: TurnTrigger,
  stream: ActiveStream,
  live: LiveTurn,
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
    const reaction = trigger.event.type === 'reaction';
    await saveMessage(
      conversationId,
      {
        id: triggerMessageId,
        role: 'user',
        parts: [{ type: 'text', text: trigger.text }],
        metadata: { kind: 'event', event: trigger.event, createdAt: new Date().toISOString(), autonomous: true },
      },
      { author: 'event', agentId, hidden: reaction },
    );
    mode = { kind: 'event', title: trigger.event.title, eventType: trigger.event.type };
    hint = `${trigger.event.title} ${trigger.text}`;
  } else {
    // Le message du coéquipier est déjà enregistré dans le fil.
    mode = { kind: 'team', peerName: names.get(trigger.fromAgentId) ?? 'un compagnon', expectsReply: trigger.expectsReply, nudge: trigger.nudge };
  }

  const depth = trigger.kind === 'user' || trigger.kind === 'onboarding' ? 0 : trigger.depth;
  const turnStarted = Date.now();
  let replyTo: MessageReplyRef | null = null;
  let toldUser = false;
  const detachedStatus = new Set<string>();
  const toolCtx = {
    agent,
    conversationId,
    isMain: !pair,
    userTurn: trigger.kind === 'user',
    depth,
    tz,
    abortSignal: stream.abort.signal,
    peerAgentId: trigger.kind === 'team' ? trigger.fromAgentId : undefined,
    setReplyTo: async (messageId: string) => {
      const reply = await resolveReply(conversationId, messageId.trim());
      if (!reply) throw new Error('Message introuvable dans cette conversation.');
      replyTo = reply;
    },
    onStatus: async (text: string) => {
      if (!text) return;
      // Dans un fil entre compagnons, l'utilisateur ne lit pas ce fil : la phrase part dans son propre chat avec ce compagnon.
      if (pair) {
        toldUser = true;
        await saveMessage(await mainConversationId(agentId), {
          id: newId('msg'),
          role: 'assistant',
          parts: [{ type: 'text', text }],
          metadata: { kind: 'chat', agentId, autonomous: true, createdAt: new Date().toISOString() },
        }, { author: 'agent', agentId });
        return;
      }
      if (!live.detached) return;
      detachedStatus.add(text);
      await saveMessage(conversationId, {
        id: newId('msg'),
        role: 'assistant',
        parts: [{ type: 'text', text }],
        metadata: { kind: pair ? 'team' : 'chat', agentId, createdAt: new Date().toISOString() },
      }, { author: 'agent', agentId });
    },
  };
  const capabilities = trigger.kind === 'onboarding'
    ? { tools: {}, info: { connectors: [] as string[], skills: [] }, lazy: { loaded: new Set<string>(), names: new Set<string>(), groups: [] } }
    : await buildCapabilityTools(toolCtx);
  const tools = trigger.kind === 'onboarding' ? {} : { ...capabilities.tools, ...buildTools(toolCtx) };
  serializeTools(tools, live.key);
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
  if (trigger.kind === 'event' && trigger.event.type === 'reaction' && triggerMessageId) {
    history.push({
      id: triggerMessageId,
      role: 'user',
      parts: [{ type: 'text', text: `[message ${triggerMessageId}]\n[Événement : ${trigger.event.title}]\n${trigger.text}` }],
      metadata: { kind: 'event', event: trigger.event },
    });
  }
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
    background: runSlot(live.key).background.filter((turn) => turn !== live).map((turn) => turn.hint),
  });

  const responseId = newId('msg');
  let turnError: string | null = null;
  let finalMessage: OpenDotsUIMessage | null = null;
  const stepLimit = await getTurnStepLimit();
  let limitReached = false;
  let limitNotice: string | null = null;

  if (runSlot(live.key).foreground === live) beginStream(stream);
  publish({ type: 'turn.started', agentId, conversationId, autonomous });
  if (!live.detached) await setAgentState(agentId, pair ? 'collaborating' : autonomous ? 'awake' : 'thinking', mode.kind === 'event' ? mode.title : null);

  try {
    const resolved = await resolveModel(modelCfg);
    const result = streamText({
      model: resolved.model,
      instructions: system,
      messages: await convertToModelMessages(await hydrateMessageImages(history), { ignoreIncompleteToolCalls: true, tools }),
      tools,
      // Outils de services chargés à la demande : load_tools les active dès l'étape suivante.
      activeTools: activeToolNames(tools, capabilities.lazy) as any,
      prepareStep: ({ messages, stepNumber, steps }) => {
        const prepared = compactSemanticObservations(desktopVisionMessages(messages));
        const names = activeToolNames(tools, capabilities.lazy) as any;
        const detachedNote = live.detached
          ? '\n\nYou were moved to the background because the user sent a new message, which another turn is answering. Finish only the task already underway. Do not answer the new message. Keep sending text_user with a short status every few steps, then end with a short factual result.'
          : '';
        if (stepLimit !== null && stepNumber >= stepLimit) {
          limitReached = true;
          return {
            activeTools: [], toolChoice: 'none' as const, messages: prepared,
            instructions: system + detachedNote + '\n\nThe work-step budget is exhausted. Read the LAST tool result and give the user a concise, honest progress report: verified results, unfinished work and the next action. Do not call tools, claim unfinished work is complete, or return <silence/>. The server will display the limit notice.',
          };
        }
        if (trigger.kind === 'user' && tools.text_user && statusDue(steps as { text?: string; toolCalls?: { toolName?: string }[] }[])) {
          return {
            activeTools: names, toolChoice: { type: 'tool' as const, toolName: 'text_user' }, messages: prepared,
            instructions: system + detachedNote + '\n\nSeveral steps passed with no update for the user. Call text_user now with one short sentence in the user\'s language saying where the work stands. Do not call any other tool in this step.',
          };
        }
        return { activeTools: names, messages: prepared, ...(detachedNote ? { instructions: system + detachedNote } : {}) };
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
      if (!live.detached && chunk.type === 'tool-input-start') {
        const label = toolActivityLabel(chunk.toolName);
        void setAgentState(agentId, chunk.toolName === 'team_send_message' ? 'collaborating' : 'working', label).catch((error) => console.error('[agent state]', error));
      } else if (!live.detached && chunk.type === 'text-start') {
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
  // Dans un fil entre compagnons, la réponse transmise est le texte final, pas les phrases d'étape.
  const text = response ? (pair ? finalText(response) : messageText(response)) : '';
  // Un réveil n'est masqué que s'il n'a rien produit de visible pour l'utilisateur.
  const acted = (response?.parts ?? []).some((p: any) => typeof p.type === 'string' && VISIBLE_EFFECT_TOOLS.test(p.type.slice(5)) && p.output?.ok !== false);
  // Une réponse d'un coéquipier est toujours montrée à l'utilisateur (jamais masquée).
  const mustSurface = trigger.kind === 'event' && trigger.event.type === 'agent_reply';
  const silent = autonomous && !pair && !acted && !mustSurface && (SILENCE.test(text) || (!text && !turnError));
  if (response && response.parts.length) {
    const parts = (SILENCE.test(text) ? response.parts.filter((p) => p.type !== 'text') : response.parts).filter((p) => {
      if (p.type !== 'tool-text_user') return true;
      const said = typeof (p as { input?: { text?: unknown } }).input?.text === 'string' ? (p as { input: { text: string } }).input.text.trim() : '';
      return !detachedStatus.has(said);
    }).map((p) => p.type === 'text' ? { ...p, text: cleanModelText(p.text) } : p);
    if (parts.length) await saveMessage(
      conversationId,
      { ...response, id: responseId, role: 'assistant', parts, metadata: { ...(response.metadata ?? {}), createdAt: new Date().toISOString(), workedMs: Date.now() - turnStarted, ...(replyTo ? { replyTo } : {}) } },
      { author: 'agent', agentId, hidden: silent },
    );
  }
  if (silent && triggerMessageId) {
    await db().update(schema.messages).set({ hidden: true }).where(eq(schema.messages.id, triggerMessageId));
  }

  finishStream(stream);
  publish({ type: 'turn.finished', agentId, conversationId });

  if (turnError) {
    if (!live.detached) await setAgentState(agentId, 'error', turnError.slice(0, 200));
    await log(agentId, 'turn.error', `Erreur pendant un tour : ${turnError.slice(0, 200)}`, { conversationId, trigger: trigger.kind });
  } else {
    if (!live.detached) await setAgentState(agentId, autonomous && trigger.kind !== 'onboarding' && !pair ? 'sleeping' : 'available', null);
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
    toldUser,
  };
}
