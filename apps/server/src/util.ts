import { createHash, randomBytes } from 'node:crypto';

const alphabet = '0123456789abcdefghijkmnopqrstuvwxyz';

export function newId(prefix: string, size = 14): string {
  const bytes = randomBytes(size);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [tronqué, ${text.length - max} caractères de plus]`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Verrou asynchrone par clé : sérialise les tours d'un même compagnon. */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => current);
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  isLocked(key: string): boolean {
    return this.tails.has(key);
  }
}

export const AGENT_COLORS = [
  '#7c9cff',
  '#ff9fb2',
  '#7fd6c2',
  '#ffc078',
  '#b49cff',
  '#8fd3ff',
  '#f7a8e0',
  '#a9dc76',
];
