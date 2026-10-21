import { and, eq, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { config } from '../config.ts';
import { accountKey } from '../auth/context.ts';
import { log } from '../journal.ts';
import { errorMessage } from '../util.ts';

/**
 * File de tâches persistante dans PostgreSQL. Les tâches survivent aux
 * redémarrages, sont relancées avec un délai croissant et dédupliquées.
 */
export type JobRow = typeof schema.jobs.$inferSelect;
type Handler = (payload: any, job: JobRow) => Promise<void>;

const handlers = new Map<string, Handler>();
const states = new Map<string, { running: Map<number, string | null>; timer: NodeJS.Timeout | null; stopped: boolean; pumping: boolean }>();
function state() {
  const key = accountKey();
  if (!states.has(key)) states.set(key, { running: new Map(), timer: null, stopped: true, pumping: false });
  return states.get(key)!;
}

export function registerJobHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export async function enqueue(
  type: string,
  payload: unknown,
  opts: { agentId?: string | null; runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<boolean> {
  const res = await db()
    .insert(schema.jobs)
    .values({
      type,
      payload: payload as object,
      agentId: opts.agentId ?? null,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .onConflictDoNothing()
    .returning({ id: schema.jobs.id });
  if (res.length) kick();
  return res.length > 0;
}

export function kick() {
  if (!state().stopped) setImmediate(() => void pump());
}

/** Réserve une tâche prête, en évitant les compagnons déjà occupés. */
async function claimOne(): Promise<JobRow | null> {
  const busyAgents = [...state().running.values()].filter((v): v is string => !!v);
  const busyFilter = busyAgents.length
    ? sql`AND (agent_id IS NULL OR agent_id NOT IN (${sql.join(busyAgents.map((a) => sql`${a}`), sql`, `)}))`
    : sql``;
  const res = await db().execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_at <= now() ${busyFilter}
      ORDER BY run_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`);
  const rows = ((res as any).rows ?? res) as any[];
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    agentId: r.agent_id,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAt: new Date(r.run_at),
    lockedAt: r.locked_at ? new Date(r.locked_at) : null,
    lastError: r.last_error,
    dedupeKey: r.dedupe_key,
    createdAt: new Date(r.created_at),
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
  };
}

async function pump() {
  if (state().pumping || state().stopped) return;
  state().pumping = true;
  try {
    while (state().running.size < config.maxConcurrentJobs) {
      const job = await claimOne();
      if (!job) break;
      state().running.set(job.id, job.agentId);
      void execute(job).finally(() => {
        state().running.delete(job.id);
        kick();
      });
    }
  } catch (err) {
    console.error('[jobs] erreur de la file', err);
  } finally {
    state().pumping = false;
  }
}

async function execute(job: JobRow) {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`Aucun gestionnaire pour la tâche ${job.type}`);
    await handler(job.payload, job);
    await db().update(schema.jobs).set({ status: 'done', finishedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  } catch (err) {
    const message = errorMessage(err);
    const retry = job.attempts < job.maxAttempts && !(err instanceof PermanentJobError);
    await db()
      .update(schema.jobs)
      .set(
        retry
          ? { status: 'queued', lastError: message, runAt: new Date(Date.now() + 15_000 * 2 ** (job.attempts - 1)) }
          : { status: 'failed', lastError: message, finishedAt: new Date() },
      )
      .where(eq(schema.jobs.id, job.id));
    console.error(`[jobs] ${job.type}#${job.id} échec (${job.attempts}/${job.maxAttempts}) : ${message}`);
    if (!retry) await log(job.agentId, 'job.failed', `Échec définitif de la tâche ${job.type}`, { error: message, payload: job.payload });
  }
}

export class PermanentJobError extends Error {}

export async function startQueue() {
  if (!state().stopped) return;
  state().stopped = false;
  // Reprise après interruption : les tâches « running » orphelines sont remises en file.
  await db()
    .update(schema.jobs)
    .set({ status: 'queued', runAt: new Date() })
    .where(eq(schema.jobs.status, 'running'));
  // Nettoyage des anciennes tâches terminées.
  await db()
    .delete(schema.jobs)
    .where(and(eq(schema.jobs.status, 'done'), lt(schema.jobs.finishedAt, new Date(Date.now() - 7 * 86400_000))));
  state().timer = setInterval(() => void pump(), 1000);
  kick();
}

export async function stopQueue() {
  state().stopped = true;
  if (state().timer) clearInterval(state().timer!);
  state().timer = null;
}

export function runningJobs() {
  return state().running.size;
}
