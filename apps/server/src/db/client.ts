import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { config } from '../config.ts';
import * as schema from './schema.ts';

export type DB = PgliteDatabase<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

let instance: DB | null = null;
let closeFn: (() => Promise<void>) | null = null;

/**
 * Ouvre la base : PostgreSQL externe si DATABASE_URL est défini,
 * sinon PostgreSQL embarqué (PGlite) dans le dossier de données.
 */
export async function openDatabase(opts: { memory?: boolean } = {}): Promise<DB> {
  if (instance) return instance;
  if (config.databaseUrl && !opts.memory) {
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
  return instance;
}

export function db(): DB {
  if (!instance) throw new Error('Base de données non initialisée');
  return instance;
}

export async function closeDatabase() {
  await closeFn?.();
  instance = null;
  closeFn = null;
}

export { schema };
