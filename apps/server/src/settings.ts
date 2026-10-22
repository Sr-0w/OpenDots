import { eq } from 'drizzle-orm';
import type { DesktopPermissions, ModelConfig } from '@opendots/shared';
import { db, schema } from './db/client.ts';
import { decryptSecret, encryptSecret } from './secrets.ts';
import { publish } from './bus.ts';
import { currentAccount } from './auth/context.ts';

interface SettingsShape {
  [key: `desktop.permissions.${string}`]: DesktopPermissions;
  [key: `desktop.bot.${string}`]: { enabled: boolean; manualControl?: boolean; slot?: number; password?: string; runtimeId?: string };
  'openrouter.key': string; // chiffré
  'models.default': ModelConfig;
  'ollama.url': string;
  'engine.paused': boolean;
  'onboarding.done': boolean;
  'user.timezone': string;
  'search.config': { provider: string; apiKey?: string | null; url?: string | null }; // clés historiques ignorées
  'shell.config': ShellSettings;
  'computer.sessions': Record<string, number>;
  'desktop.config': { enabled: boolean; manualControl?: boolean };
}

export type SearchProvider = 'auto' | 'mwmbl' | 'searxng';

export interface ShellSettings {
  /** auto = Docker si disponible, sinon machine hôte. */
  mode: 'auto' | 'docker' | 'host' | 'off';
  /** ask = chaque commande demande une validation ; auto = exécution directe. */
  approval: 'ask' | 'auto' | 'default';
  image: string;
  network: boolean;
  /** Autoriser les compagnons à administrer le conteneur (installer des paquets). */
  sudo: boolean;
}

export const BUILTIN_COMPUTER_IMAGE = 'opendots/computer:8';

export const DEFAULT_SHELL: ShellSettings = { mode: 'auto', approval: 'default', image: BUILTIN_COMPUTER_IMAGE, network: true, sudo: false };

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
  if (!currentAccount() && process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
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

/** Recherche sans compte : les anciennes clés de moteurs payants ne sont plus lues. */
export async function getSearchSettings(): Promise<{ provider: SearchProvider; url: string | null }> {
  const s = await getSetting('search.config');
  const provider: SearchProvider = s?.provider === 'searxng' && s.url ? 'searxng' : s?.provider === 'mwmbl' ? 'mwmbl' : 'auto';
  return {
    provider,
    url: provider === 'searxng' ? (s?.url ?? null) : null,
  };
}

export async function setSearchSettings(input: { provider: SearchProvider; url?: string | null }) {
  const current = await getSetting('search.config');
  await setSetting('search.config', { provider: input.provider, url: input.url === undefined ? (current?.url ?? null) : input.url });
}

export async function getShellSettings(): Promise<ShellSettings> {
  const settings = { ...DEFAULT_SHELL, ...((await getSetting('shell.config')) ?? {}) };
  if (['opendots/computer:1', 'opendots/computer:3', 'opendots/computer:4', 'opendots/computer:5', 'opendots/computer:6', 'opendots/computer:7'].includes(settings.image)) settings.image = BUILTIN_COMPUTER_IMAGE;
  return settings;
}
