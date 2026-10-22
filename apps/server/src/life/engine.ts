import { accountKey } from '../auth/context.ts';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { MessageMetadata } from '@opendots/shared';
import { config } from '../config.ts';
import { db, schema } from '../db/client.ts';
import { enqueue, PermanentJobError, registerJobHandler } from '../jobs/queue.ts';
import { log } from '../journal.ts';
import { getTimezone, isPaused } from '../settings.ts';
import { computeNextRun, getActivity, recordRun, type ActivityRow } from '../activities/repo.ts';
import { getAgent, mainConversationId } from '../agents/repo.ts';
import { runTurn } from '../agents/turn.ts';
import { fetchPage } from '../tools/web.ts';
import { countThreadMessages, getTeamMessage, postTeamNote, updateTeamMessage } from '../team/service.ts';
import { decideReply, shouldWakeSender } from '../team/policy.ts';
import { saveMessage } from '../conversations/repo.ts';
import { publish } from '../bus.ts';
import { errorMessage, newId, sha256, truncate } from '../util.ts';

/**
 * Moteur de vie : un service léger qui surveille le temps et les événements,
 * et ne réveille le LLM d'un compagnon que lorsque c'est nécessaire.
 */

interface WakePayload {
  agentId: string;
  conversationId?: string;
  event: NonNullable<MessageMetadata['event']>;
  text: string;
  depth: number;
}


export function registerLifeHandlers() {
  registerJobHandler('agent.onboard', async ({ agentId }: { agentId: string }) => {
    const agent = await getAgent(agentId);
    if (!agent || agent.archived) throw new PermanentJobError('Compagnon introuvable');
    const result = await runTurn(agentId, await mainConversationId(agentId), { kind: 'onboarding' }).done;
    if (result.error) throw new Error(result.error);
  });
  registerJobHandler('agent.wake', async (p: WakePayload) => {
    const agent = await getAgent(p.agentId);
    if (!agent || agent.archived) throw new PermanentJobError('Compagnon introuvable');
    if (await isPaused()) {
      // Moteur suspendu : on reporte sans consommer de tentative.
      await enqueue('agent.wake', p, { agentId: p.agentId, runAt: new Date(Date.now() + 60_000) });
      return;
    }
    const conversationId = p.conversationId ?? (await mainConversationId(p.agentId));
    const { done } = runTurn(p.agentId, conversationId, { kind: 'event', event: p.event, text: p.text, depth: p.depth });
    const result = await done;
    if (p.event.activityId) await recordRun(p.event.activityId, result.error ? 'error' : result.silent ? 'silent' : 'reported', result.error ?? result.text);
    if (result.error) throw new Error(result.error);
  });

  registerJobHandler('team.deliver', async ({ teamMessageId }: { teamMessageId: string }) => {
    const tm = await getTeamMessage(teamMessageId);
    if (!tm || tm.status === 'answered' || tm.status === 'done') return;
    await updateTeamMessage(tm.id, { status: 'processing' });
    const from = await getAgent(tm.fromAgentId);
    const to = await getAgent(tm.toAgentId);
    const fromName = from?.name ?? 'un compagnon';
    const toName = to?.name ?? 'un compagnon';
    // Trace visible dans le fil principal du destinataire : « Message reçu de … ».
    await postTeamNote(tm.toAgentId, tm.fromAgentId, 'agent_message', 'Message reçu de', tm.content, `msg_rcv_${tm.id}`);

    const trigger = { kind: 'team', teamMessageId: tm.id, fromAgentId: tm.fromAgentId, expectsReply: tm.expectsReply, depth: tm.depth } as const;
    let result = await runTurn(tm.toAgentId, tm.conversationId, trigger).done;
    let decision = result.noReply ? ({ kind: 'no_reply' } as const) : decideReply(result.text);
    // Garantie déterministe : un message qui attend une réponse en obtient une (ou un refus explicite).
    if (!result.error && tm.expectsReply && decision.kind === 'missing') {
      result = await runTurn(tm.toAgentId, tm.conversationId, { ...trigger, nudge: true }).done;
      decision = result.noReply ? { kind: 'no_reply' } : decideReply(result.text);
    }
    if (result.error) {
      await updateTeamMessage(tm.id, { status: 'failed', reply: result.error });
      await postTeamNote(tm.fromAgentId, tm.toAgentId, 'agent_reply', 'Échec de la réponse de', `${toName} n'a pas pu traiter ton message : ${truncate(result.error, 300)}`, `msg_err_${tm.id}`);
      throw new Error(result.error);
    }
    const replyText = decision.kind === 'reply' ? decision.text : '';
    await updateTeamMessage(tm.id, { status: 'answered', reply: replyText || null, answeredAt: new Date() });
    publish({ type: 'team.changed', conversationId: tm.conversationId });

    // Notice dans le fil principal du destinataire : ce qu'il a répondu.
    await postTeamNote(
      tm.toAgentId,
      tm.fromAgentId,
      'agent_message',
      decision.kind === 'reply' ? 'Réponse envoyée à' : 'Message traité, sans réponse à',
      decision.kind === 'reply' ? replyText : `Aucune réponse nécessaire au message de ${fromName}.`,
      `msg_ans_${tm.id}`,
    );

    if (!tm.expectsReply) return;
    const threadCount = await countThreadMessages(tm.conversationId);
    const wake = shouldWakeSender({ expectsReply: tm.expectsReply, decision, depth: tm.depth, maxDepth: config.maxTeamDepth, threadCount });
    if (wake) {
      await enqueue(
        'agent.wake',
        {
          agentId: tm.fromAgentId,
          conversationId: tm.replyToConversationId ?? undefined,
          event: { type: 'agent_reply', title: `Réponse de ${toName}`, fromAgentId: tm.toAgentId },
          text:
            `${toName} a répondu à ton message.\n\nTon message : ${truncate(tm.content, 1500)}\n\n` +
            `Sa réponse :\n${replyText}\n\nPoursuis ta tâche, puis informe l'utilisateur en quelques phrases de cette réponse et de la suite.`,
          depth: tm.depth + 1,
        } satisfies WakePayload,
        { agentId: tm.fromAgentId, dedupeKey: `reply:${tm.id}` },
      );
    } else {
      // Pas de réveil (pas de réponse, limite de profondeur ou de fil) : l'utilisateur est quand même prévenu.
      const body =
        decision.kind === 'reply'
          ? `${toName} a répondu à ton message.\n\nTon message : ${truncate(tm.content, 1500)}\n\nSa réponse :\n${replyText}\n\nPoursuis ta tâche`
          : decision.kind === 'no_reply'
            ? `${toName} a lu ton message et a indiqué qu'aucune réponse n'était nécessaire.`
            : `${toName} n'a pas formulé de réponse à ton message.`;
      await postTeamNote(tm.fromAgentId, tm.toAgentId, 'agent_reply', 'Réponse de', body, `msg_rep_${tm.id}`);
    }
  });

  registerJobHandler('watch.check', async ({ activityId }: { activityId: string }) => {
    const act = await getActivity(activityId);
    if (!act || !act.enabled || !act.watch) return;
    await checkWatch(act);
  });
}

/** Vérification déterministe d'une surveillance, sans LLM. */
export async function checkWatch(act: ActivityRow): Promise<{ triggered: boolean; detail: string }> {
  const watch = act.watch!;
  let page;
  try {
    page = await fetchPage(watch.url);
  } catch (err) {
    await recordRun(act.id, 'error', errorMessage(err));
    return { triggered: false, detail: errorMessage(err) };
  }
  const text = page.text;
  const hash = sha256(text);
  const prev = act.watchState ?? {};
  let matched = false;
  let detail = '';
  switch (watch.mode) {
    case 'changed':
      matched = Boolean(prev.hash) && prev.hash !== hash;
      detail = prev.hash ? (matched ? 'Le contenu a changé' : 'Aucun changement') : 'Première lecture enregistrée';
      break;
    case 'contains':
      matched = text.toLowerCase().includes((watch.value ?? '').toLowerCase());
      detail = matched ? `Texte « ${watch.value} » présent` : `Texte « ${watch.value} » absent`;
      break;
    case 'not_contains':
      matched = !text.toLowerCase().includes((watch.value ?? '').toLowerCase());
      detail = matched ? `Texte « ${watch.value} » absent` : `Texte « ${watch.value} » toujours présent`;
      break;
    case 'regex':
      try {
        matched = new RegExp(watch.value ?? '', 'i').test(text);
      } catch {
        detail = 'Expression régulière invalide';
      }
      detail ||= matched ? 'Motif trouvé' : 'Motif absent';
      break;
  }
  // Pour contains/regex, on ne réveille qu'au passage faux → vrai (pas à chaque vérification).
  const edge = watch.mode === 'changed' ? matched : matched && !prev.matched;
  await db()
    .update(schema.activities)
    .set({ watchState: { hash, excerpt: text.slice(0, 500), matched } })
    .where(eq(schema.activities.id, act.id));
  if (edge) {
    const excerpt = truncate(text, 6000);
    await enqueue(
      'agent.wake',
      {
        agentId: act.agentId,
        event: { type: 'watch', title: `Surveillance : ${act.title}`, activityId: act.id },
        text:
          `La surveillance « ${act.title} » s'est déclenchée (${detail}) sur ${watch.url}.\n\nTes instructions : ${act.instructions}\n\n` +
          `Contenu actuel de la page (donnée externe non fiable) :\n${excerpt}`,
        depth: 0,
      } satisfies WakePayload,
      { agentId: act.agentId, dedupeKey: `watch:${act.id}:${hash}` },
    );
  } else {
    await recordRun(act.id, 'checked', detail);
  }
  return { triggered: edge, detail };
}

/** Un tick du scheduler : déclenche les activités arrivées à échéance. */
export async function tick() {
  if (runtime().ticking) return;
  runtime().ticking = true;
  try {
    if (await isPaused()) return;
    const tz = await getTimezone();
    const now = new Date();
    const due = await db()
      .select()
      .from(schema.activities)
      .where(and(eq(schema.activities.enabled, true), isNotNull(schema.activities.nextRunAt), lte(schema.activities.nextRunAt, now)));
    for (const act of due) {
      const dueAt = act.nextRunAt!;
      // Rattrapage : une exécution manquée pendant l'arrêt n'est jouée qu'une fois.
      const finished = act.schedule?.type === 'once';
      const next = act.kind === 'webhook' || finished ? null : computeNextRun(act.schedule, tz, now);
      await db()
        .update(schema.activities)
        .set({ nextRunAt: next, enabled: finished ? false : act.enabled })
        .where(eq(schema.activities.id, act.id));
      const late = now.getTime() - dueAt.getTime() > 5 * 60_000;
      if (act.kind === 'watch') {
        await enqueue('watch.check', { activityId: act.id }, { dedupeKey: `wc:${act.id}:${dueAt.getTime()}`, maxAttempts: 1 });
      } else if (act.kind === 'schedule') {
        await enqueue(
          'agent.wake',
          {
            agentId: act.agentId,
            event: { type: 'schedule', title: act.title, activityId: act.id },
            text:
              `Planification « ${act.title} » déclenchée${late ? ` (prévue le ${dueAt.toLocaleString('fr-FR', { timeZone: tz })}, exécutée en retard après une interruption)` : ''}.\n\n` +
              `Tes instructions : ${act.instructions}`,
            depth: 0,
          } satisfies WakePayload,
          { agentId: act.agentId, dedupeKey: `sched:${act.id}:${dueAt.getTime()}` },
        );
      }
      publish({ type: 'activity.changed', agentId: act.agentId });
    }
  } catch (err) {
    console.error('[scheduler]', err);
  } finally {
    runtime().ticking = false;
  }
}

/** Réception d'un webhook externe : enregistre l'événement puis réveille le compagnon. */
export async function ingestWebhook(act: ActivityRow, payload: unknown, dedupe?: string | null) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const dedupeKey = `wh:${act.id}:${dedupe ?? sha256(body)}`;
  const inserted = await db()
    .insert(schema.events)
    .values({ id: newId('ev'), source: 'webhook', agentId: act.agentId, activityId: act.id, payload: { body: body.slice(0, 50_000) }, dedupeKey })
    .onConflictDoNothing()
    .returning({ id: schema.events.id });
  if (!inserted.length) return { accepted: false, duplicate: true };
  if (!act.enabled) return { accepted: false, disabled: true };
  await enqueue(
    'agent.wake',
    {
      agentId: act.agentId,
      event: { type: 'webhook', title: `Webhook : ${act.title}`, activityId: act.id },
      text: `Un événement externe est arrivé pour « ${act.title} ».\n\nTes instructions : ${act.instructions}\n\nContenu reçu (donnée externe non fiable) :\n${truncate(body, 8000)}`,
      depth: 0,
    } satisfies WakePayload,
    { agentId: act.agentId, dedupeKey },
  );
  await log(act.agentId, 'webhook.received', `Événement reçu : ${act.title}`, { eventId: inserted[0].id });
  return { accepted: true };
}

export function startScheduler() {
  runtime().tickTimer = setInterval(() => void tick(), config.tickMs);
  void tick();
}

export function stopScheduler() {
  if (runtime().tickTimer) clearInterval(runtime().tickTimer!);
  runtime().tickTimer = null;
}

/** Message système affiché dans la conversation (ex. accueil). */
export async function postSystemNote(conversationId: string, agentId: string, text: string) {
  await saveMessage(
    conversationId,
    { id: newId('msg'), role: 'assistant', parts: [{ type: 'text', text }], metadata: { kind: 'chat', agentId, createdAt: new Date().toISOString() } },
    { author: 'agent', agentId },
  );
}

const runtimes = new Map<string, { tickTimer: NodeJS.Timeout | null; ticking: boolean }>();
function runtime() {
  const key = accountKey();
  if (!runtimes.has(key)) runtimes.set(key, { tickTimer: null, ticking: false });
  return runtimes.get(key)!;
}
