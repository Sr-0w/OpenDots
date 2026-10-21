import { and, asc, eq } from 'drizzle-orm';
import { Cron } from 'croner';
import type { ActivityDTO, ActivityKind, ActivityMailFilter, ActivitySchedule, ActivityWatch } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { currentAccount } from '../auth/context.ts';
import { publish } from '../bus.ts';
import { publicBaseUrl } from '../config.ts';
import { newId } from '../util.ts';

export type ActivityRow = typeof schema.activities.$inferSelect;

export class ActivityError extends Error {}

export function validateSchedule(s: ActivitySchedule, tz: string): void {
  if (s.type === 'once') {
    const at = new Date(s.at);
    if (Number.isNaN(at.getTime())) throw new ActivityError(`Date invalide : ${s.at}`);
  } else if (s.type === 'interval') {
    if (!Number.isFinite(s.minutes) || s.minutes < 1) throw new ActivityError("L'intervalle doit être d'au moins 1 minute.");
  } else if (s.type === 'cron') {
    try {
      new Cron(s.expr, { timezone: s.tz ?? tz, paused: true });
    } catch (err) {
      throw new ActivityError(`Expression cron invalide « ${s.expr} » : ${(err as Error).message}`);
    }
  }
}

/** Prochaine exécution après `from`, ou null s'il n'y en a plus. */
export function computeNextRun(s: ActivitySchedule | null, tz: string, from = new Date()): Date | null {
  if (!s) return null;
  if (s.type === 'once') {
    const at = new Date(s.at);
    return at > from ? at : null;
  }
  if (s.type === 'interval') return new Date(from.getTime() + s.minutes * 60_000);
  const next = new Cron(s.expr, { timezone: s.tz ?? tz, paused: true }).nextRun(from);
  return next ?? null;
}

export function describeSchedule(s: ActivitySchedule | null, kind?: ActivityKind): string {
  if (kind === 'mail') return 'à la réception d’un e-mail';
  if (kind === 'webhook') return 'à chaque appel du webhook';
  if (!s) return 'sur événement';
  if (s.type === 'once') return `le ${new Date(s.at).toLocaleString('fr-FR')}`;
  if (s.type === 'interval') return s.minutes % 60 === 0 ? `toutes les ${s.minutes / 60} h` : `toutes les ${s.minutes} min`;
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6](?:,[0-6])*)$/.exec(s.expr.trim());
  if (m) {
    const time = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
    if (m[3] === '*') return `tous les jours à ${time}`;
    if (m[3] === '1-5') return `en semaine à ${time}`;
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return `le ${m[3].split(',').map((d) => days[Number(d)]).join(', ')} à ${time}`;
  }
  return `cron « ${s.expr} »${s.tz ? ` (${s.tz})` : ''}`;
}

export function toActivityDTO(r: ActivityRow): ActivityDTO {
  return {
    id: r.id,
    agentId: r.agentId,
    title: r.title,
    kind: r.kind,
    instructions: r.instructions,
    schedule: r.schedule,
    watch: r.watch,
    filter: r.filter,
    webhookUrl: r.webhookToken ? `${publicBaseUrl()}/api/hooks/${currentAccount() ? currentAccount()!.id + '/' : ''}${r.webhookToken}` : null,
    enabled: r.enabled,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastStatus: r.lastStatus,
    lastResult: r.lastResult,
    runCount: r.runCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function createActivity(input: {
  agentId: string;
  title: string;
  kind: ActivityKind;
  instructions: string;
  schedule?: ActivitySchedule | null;
  watch?: ActivityWatch | null;
  filter?: ActivityMailFilter | null;
  createdBy?: string;
  tz: string;
}): Promise<ActivityRow> {
  let schedule = input.schedule ?? null;
  if (input.kind === 'watch') {
    if (!input.watch?.url) throw new ActivityError('Une surveillance nécessite une URL.');
    try {
      const u = new URL(input.watch.url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      throw new ActivityError(`URL invalide : ${input.watch.url}`);
    }
    schedule = schedule ?? { type: 'interval', minutes: 60 };
  }
  if (input.kind === 'schedule' && !schedule) throw new ActivityError('Une planification nécessite un horaire.');
  if (input.kind === 'mail' || input.kind === 'webhook') schedule = null;
  if (schedule) validateSchedule(schedule, input.tz);
  const nextRunAt = input.kind === 'watch' ? new Date(Date.now() + 5_000) : computeNextRun(schedule, input.tz);
  if (input.kind === 'schedule' && !nextRunAt) throw new ActivityError('Cette date est déjà passée.');
  const row = {
    id: newId('act'),
    agentId: input.agentId,
    title: input.title.trim(),
    kind: input.kind,
    instructions: input.instructions.trim(),
    schedule,
    watch: input.kind === 'watch' ? (input.watch ?? null) : null,
    filter: input.kind === 'mail' ? (input.filter ?? {}) : null,
    webhookToken: input.kind === 'webhook' ? newId('wh', 24) : null,
    nextRunAt,
    createdBy: input.createdBy ?? 'agent',
  };
  await db().insert(schema.activities).values(row);
  publish({ type: 'activity.changed', agentId: input.agentId });
  return (await getActivity(row.id))!;
}

export async function getActivity(id: string): Promise<ActivityRow | null> {
  const [row] = await db().select().from(schema.activities).where(eq(schema.activities.id, id));
  return row ?? null;
}

export async function listActivities(agentId?: string): Promise<ActivityRow[]> {
  return db()
    .select()
    .from(schema.activities)
    .where(agentId ? eq(schema.activities.agentId, agentId) : undefined)
    .orderBy(asc(schema.activities.createdAt));
}

export async function updateActivity(
  id: string,
  agentId: string | null,
  patch: Partial<Pick<ActivityRow, 'title' | 'instructions' | 'schedule' | 'watch' | 'enabled' | 'filter'>>,
  tz: string,
): Promise<ActivityRow> {
  const current = await getActivity(id);
  if (!current || (agentId && current.agentId !== agentId)) throw new ActivityError('Activité introuvable.');
  const next: Partial<ActivityRow> = { ...patch, updatedAt: new Date() };
  const schedule = patch.schedule !== undefined ? patch.schedule : current.schedule;
  if (patch.schedule) validateSchedule(patch.schedule, tz);
  if (patch.schedule !== undefined || (patch.enabled === true && !current.enabled)) {
    next.nextRunAt = current.kind === 'webhook' || current.kind === 'mail' ? null : computeNextRun(schedule, tz);
    if (current.kind === 'schedule' && !next.nextRunAt && (patch.enabled ?? current.enabled)) {
      throw new ActivityError('Cet horaire ne produit plus aucune exécution future.');
    }
  }
  if (patch.watch) next.watchState = null;
  await db().update(schema.activities).set(next).where(eq(schema.activities.id, id));
  publish({ type: 'activity.changed', agentId: current.agentId });
  return (await getActivity(id))!;
}

export async function deleteActivity(id: string, agentId: string | null): Promise<boolean> {
  const cond = agentId ? and(eq(schema.activities.id, id), eq(schema.activities.agentId, agentId)) : eq(schema.activities.id, id);
  const res = await db().delete(schema.activities).where(cond).returning({ agentId: schema.activities.agentId });
  if (res[0]) publish({ type: 'activity.changed', agentId: res[0].agentId });
  return res.length > 0;
}

export async function recordRun(id: string, status: string, result: string | null) {
  const current = await getActivity(id);
  if (!current) return;
  await db()
    .update(schema.activities)
    .set({ lastRunAt: new Date(), lastStatus: status, lastResult: result?.slice(0, 2000) ?? null, runCount: current.runCount + 1 })
    .where(eq(schema.activities.id, id));
  publish({ type: 'activity.changed', agentId: current.agentId });
}

export async function findActivityByWebhook(token: string): Promise<ActivityRow | null> {
  const [row] = await db()
    .select()
    .from(schema.activities)
    .where(and(eq(schema.activities.webhookToken, token), eq(schema.activities.kind, 'webhook')));
  return row ?? null;
}
