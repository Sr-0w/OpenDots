import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentAccount } from './auth/context.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');
export const systemDataDir = resolve(process.env.OPENDOTS_DATA_DIR ?? join(repoRoot, 'data'));

export const config = {
  port: Number(process.env.OPENDOTS_PORT ?? process.env.PORT ?? 4317),
  host: process.env.OPENDOTS_HOST ?? '127.0.0.1',
  get dataDir() { return currentAccount()?.dataDir ?? systemDataDir; },
  /** Si défini, PostgreSQL externe ; sinon PostgreSQL embarqué (PGlite). */
  databaseUrl: process.env.DATABASE_URL ?? null,
  /** URL publique utilisée pour construire les adresses de webhooks. */
  publicUrl: process.env.OPENDOTS_PUBLIC_URL ?? null,
  webDist: join(repoRoot, 'apps/web/dist'),
  production: process.env.NODE_ENV === 'production',
  /** Intervalle du scheduler (ms). */
  tickMs: Number(process.env.OPENDOTS_TICK_MS ?? 5000),
  maxConcurrentJobs: Number(process.env.OPENDOTS_MAX_JOBS ?? 3),
  maxAgents: Number(process.env.OPENDOTS_MAX_AGENTS ?? 16),
  maxTeamDepth: 6,
  maxStepsPerTurn: 12,
};

mkdirSync(config.dataDir, { recursive: true });

export function publicBaseUrl(): string {
  return config.publicUrl ?? `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
}
