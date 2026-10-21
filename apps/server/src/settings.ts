import { eq } from 'drizzle-orm';
import type { ModelConfig } from '@opendots/shared';
import { db, schema } from './db/client.ts';
import { decryptSecret, encryptSecret } from './secrets.ts';
import { publish } from './bus.ts';

interface SettingsShape {
  'openrouter.key': string; // chiffré
  'models.default': ModelConfig;
  'ollama.url': string;
  'engine.paused': boolean;
  'onboarding.done': boolean;
  'user.timezone': string;
}

export async function getSetting<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K] | null> {
  const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, key));
  return (row?.value as SettingsShape[K]) ?? null;
}

export async function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K] | null) {
  if (value === null) {
    await db().delete(schema.settings).where(eq(schema.settings.key, key));
  } else {
    await db()
      .insert(schema.settings)
      .values({ key, value: value as unknown as object, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: value as unknown as object, updatedAt: new Date() } });
  }
  publish({ type: 'settings.changed' });
}

export async function getOpenRouterKey(): Promise<string | null> {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const enc = await getSetting('openrouter.key');
  return enc ? decryptSecret(enc) : null;
}

export async function setOpenRouterKey(key: string | null) {
  await setSetting('openrouter.key', key ? encryptSecret(key) : null);
}

export const FALLBACK_MODEL: ModelConfig = { provider: 'openrouter', model: 'openai/gpt-oss-120b', reasoning: 'high' };

export async function getDefaultModel(): Promise<ModelConfig> {
  return (await getSetting('models.default')) ?? FALLBACK_MODEL;
}

export async function getTimezone(): Promise<string> {
  return (await getSetting('user.timezone')) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Paris';
}

export async function isPaused(): Promise<boolean> {
  return (await getSetting('engine.paused')) ?? false;
}
