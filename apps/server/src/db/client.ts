import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { config } from '../config.ts';
import { mkdir } from 'node:fs/promises';
import { accountKey, currentAccount } from '../auth/context.ts';
import * as schema from './schema.ts';

export type DB = PgliteDatabase<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const instances = new Map<string, { instance: DB; close: () => Promise<void> }>();
const opening = new Map<string, Promise<DB>>();

/**
 * Ouvre la base : PostgreSQL externe si DATABASE_URL est défini,
 * sinon PostgreSQL embarqué (PGlite) dans le dossier de données.
 */
export async function openDatabase(opts: { memory?: boolean } = {}): Promise<DB> {
  const key = accountKey();
  const existing = instances.get(key);
  if (existing) return existing.instance;
  const pending = opening.get(key);
  if (pending) return pending;
  const promise = initialize(opts);
  opening.set(key, promise);
  try { return await promise; } finally { opening.delete(key); }
}

async function initialize(opts: { memory?: boolean }): Promise<DB> {
  let instance: DB;
  let closeFn: () => Promise<void>;
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  if (config.databaseUrl && !opts.memory && !currentAccount()) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    instance = db as unknown as DB;
    closeFn = () => pool.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = opts.memory ? new PGlite() : new PGlite(join(config.dataDir, 'pg'));
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    instance = db;
    closeFn = () => client.close();
  }
  instances.set(accountKey(), { instance, close: closeFn });
  return instance;
}

export function db(): DB {
  const entry = instances.get(accountKey());
  if (!entry) throw new Error('Base de données non initialisée');
  return entry.instance;
}

export async function closeDatabase() {
  const key = accountKey();
  await instances.get(key)?.close();
  instances.delete(key);
}

export async function closeAllDatabases() {
  await Promise.all([...instances.values()].map((entry) => entry.close()));
  instances.clear();
}

export { schema };
