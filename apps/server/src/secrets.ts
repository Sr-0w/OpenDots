import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

/**
 * Les secrets (clés API, mots de passe) sont chiffrés en AES-256-GCM avec une
 * clé locale stockée hors base de données (fichier 0600 dans le dossier de
 * données, ou variable OPENDOTS_SECRET_KEY). Ils ne sont jamais envoyés au
 * frontend ni aux modèles.
 */
let key: Buffer | null = null;

function masterKey(): Buffer {
  if (key) return key;
  const fromEnv = process.env.OPENDOTS_SECRET_KEY;
  if (fromEnv) {
    key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('OPENDOTS_SECRET_KEY doit faire 32 octets encodés en base64');
    return key;
  }
  const file = join(config.dataDir, 'secret.key');
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // systèmes de fichiers sans permissions POSIX
  }
  key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, enc] = payload.split(':');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Format de secret invalide');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(secret: string): string {
  if (secret.length <= 12) return '••••';
  return `${secret.slice(0, 8)}…${secret.slice(-4)}`;
}
