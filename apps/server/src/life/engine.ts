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
import { getTeamMessage, updateTeamMessage } from '../team/service.ts';
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

let tickTimer: NodeJS.Timeout | null = null;
let ticking = false;

export function registerLifeHandlers() {
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
    const { done } = runTurn(tm.toAgentId, tm.conversationId, {
      kind: 'team',
      teamMessageId: tm.id,
      fromAgentId: tm.fromAgentId,
      expectsReply: tm.expectsReply,
      depth: tm.depth,
    });
    const result = await done;
    if (result.error) {
      await updateTeamMessage(tm.id, { status: 'failed', reply: result.error });
      throw new Error(result.error);
    }
    await updateTeamMessage(tm.id, { status: 'answered', reply: result.text, answeredAt: new Date() });
    publish({ type: 'team.changed', conversationId: tm.conversationId });
    if (tm.expectsReply && tm.depth < config.maxTeamDepth) {
      const to = await getAgent(tm.toAgentId);
      await enqueue(
        'agent.wake',
        {
          agentId: tm.fromAgentId,
          conversationId: tm.replyToConversationId ?? undefined,
          event: { type: 'agent_reply', title: `Réponse de ${to?.name ?? 'un compagnon'}`, fromAgentId: tm.toAgentId },
          text:
            `${to?.name ?? 'Un compagnon'} a répondu à ton message.\n\nTon message : ${truncate(tm.content, 1500)}\n\n` +
            `Sa réponse :\n${result.text || '(aucun texte)'}\n\nPoursuis ta tâche et informe l'utilisateur si c'est utile.`,
          depth: tm.depth + 1,
        } satisfies WakePayload,
        { agentId: tm.fromAgentId, dedupeKey: `reply:${tm.id}` },
      );
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
  if (ticking) return;
  ticking = true;
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
    ticking = false;
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
  tickTimer = setInterval(() => void tick(), config.tickMs);
  void tick();
}

export function stopScheduler() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

/** Message système affiché dans la conversation (ex. accueil). */
export async function postSystemNote(conversationId: string, agentId: string, text: string) {
  await saveMessage(
    conversationId,
    { id: newId('msg'), role: 'assistant', parts: [{ type: 'text', text }], metadata: { kind: 'chat', agentId, createdAt: new Date().toISOString() } },
    { author: 'agent', agentId },
  );
}
