import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { accountKey } from '../auth/context.ts';
import { KeyedMutex } from '../util.ts';
import { IMAGE_MAX_BYTES, IMAGE_MAX_COUNT } from '@opendots/shared';
import type { OpenDotsUIMessage } from '../conversations/repo.ts';

const lock = new KeyedMutex();
const directory = () => join(config.dataDir, 'attachments');
const pattern = /^\/api\/attachments\/([a-f0-9]{32})$/;
export class AttachmentError extends Error {}
export interface Attachment { id: string; url: string; filename: string; mediaType: 'image/jpeg'; width: number; height: number; size: number }
function imageMagic(data: Buffer) {
  return data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || /^GIF8[79]a/.test(data.subarray(0, 6).toString()) || data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
}
export async function storeImage(source: Uint8Array, originalName: string): Promise<Attachment> {
  if (!source.length || source.length > IMAGE_MAX_BYTES) throw new AttachmentError('Une image doit faire entre 1 octet et 10 Mo.');
  const input = Buffer.from(source);
  if (!imageMagic(input)) throw new AttachmentError('Image non prise en charge. Choisis une image JPEG, PNG, WebP ou GIF.');
  return lock.run(accountKey(), async () => {
    let bytes: Buffer, width: number, height: number;
    try {
      const normalized = await sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: 'error' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
      bytes = normalized.data; width = normalized.info.width; height = normalized.info.height;
    } catch { throw new AttachmentError('Image invalide ou trop grande. Essaie une image de moins de 40 mégapixels.'); }
    const dir = directory(); await mkdir(dir, { recursive: true, mode: 0o700 });
    let used = 0;
    for (const file of await readdir(dir)) if (/^[a-f0-9]{32}\.jpg$/.test(file)) used += (await stat(join(dir, file))).size;
    const quota = Number(process.env.OPENDOTS_ATTACHMENTS_QUOTA_MB ?? 512) * 1024 * 1024;
    if (!Number.isFinite(quota) || quota <= 0 || used + bytes.length > quota) throw new AttachmentError('L’espace disponible pour les images de ce compte est épuisé.');
    const id = randomBytes(16).toString('hex');
    const stem = originalName.replace(/\.[^.]*$/, '').replace(/[\\/\r\n\u0000-\u001f]/g, '_').slice(0, 150) || 'image';
    const value: Attachment = { id, url: `/api/attachments/${id}`, filename: `${stem}.jpg`, mediaType: 'image/jpeg', width, height, size: bytes.length };
    await writeFile(join(dir, `${id}.jpg`), bytes, { mode: 0o600 });
    try { await writeFile(join(dir, `${id}.json`), JSON.stringify(value), { mode: 0o600 }); }
    catch (error) { await rm(join(dir, `${id}.jpg`), { force: true }); throw error; }
    return value;
  });
}
export async function readAttachment(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    const [raw, bytes] = await Promise.all([readFile(join(directory(), `${id}.json`), 'utf8'), readFile(join(directory(), `${id}.jpg`))]);
    return { attachment: JSON.parse(raw) as Attachment, bytes };
  } catch { return null; }
}
export async function validateMessageParts(parts: unknown[]) {
  if (parts.length > 16) throw new AttachmentError('Ce message contient trop de parties.');
  const clean: OpenDotsUIMessage['parts'] = []; let images = 0;
  for (const raw of parts) {
    const part = raw as Record<string, unknown> | null;
    if (part?.type === 'text') {
      if (typeof part.text !== 'string' || part.text.length > 50_000) throw new AttachmentError('Texte invalide ou trop long.');
      if (part.text.trim()) clean.push({ type: 'text', text: part.text });
    } else if (part?.type === 'file') {
      if (++images > IMAGE_MAX_COUNT) throw new AttachmentError(`Un message accepte au maximum ${IMAGE_MAX_COUNT} images.`);
      const id = typeof part.url === 'string' ? pattern.exec(part.url)?.[1] : undefined;
      const found = id ? await readAttachment(id) : null;
      if (!found) throw new AttachmentError('Image introuvable ou non autorisée pour ce compte. Ajoute-la à nouveau.');
      clean.push({ type: 'file', url: found.attachment.url, filename: found.attachment.filename, mediaType: found.attachment.mediaType });
    }
  }
  if (!clean.length) throw new AttachmentError('Message vide.');
  return clean;
}
/** Private URLs stay in storage/UI; only verified local bytes reach the provider. */
export async function hydrateMessageImages(messages: OpenDotsUIMessage[]) {
  let remaining = 12;
  const result: OpenDotsUIMessage[] = [];
  for (const message of [...messages].reverse()) {
    const parts: OpenDotsUIMessage['parts'] = [];
    for (const part of message.parts) {
      if (part.type !== 'file') { parts.push(part); continue; }
      const id = pattern.exec(part.url)?.[1];
      const image = id && remaining > 0 ? await readAttachment(id) : null;
      // Keep safe inline images produced by models in older conversation history.
      if (!image && remaining > 0 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(part.url) && part.url.length < IMAGE_MAX_BYTES * 1.4) {
        const data = Buffer.from(part.url.split(',')[1], 'base64');
        if (imageMagic(data)) { remaining--; parts.push(part); continue; }
      }
      if (image) { remaining--; parts.push({ ...part, mediaType: 'image/jpeg', url: `data:image/jpeg;base64,${image.bytes.toString('base64')}` }); }
      else parts.push({ type: 'text', text: '[Image indisponible ou ancienne image omise du contexte. Demande de la joindre à nouveau si nécessaire.]' });
    }
    result.push({ ...message, parts });
  }
  return result.reverse();
}
