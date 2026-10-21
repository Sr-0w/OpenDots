import { beforeAll, afterAll, expect, it } from 'vitest';
import sharp from 'sharp';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, generateText } from 'ai';
import { createApplication } from '../src/app.ts';
import { authStore, closeAuthStore, registerUser, createSession } from '../src/auth/store.ts';
import { withAccount, type AccountContext } from '../src/auth/context.ts';
import { closeAllDatabases, openDatabase } from '../src/db/client.ts';
import { storeImage, readAttachment, validateMessageParts, hydrateMessageImages, type Attachment } from '../src/attachments/service.ts';
import { createAgent, mainConversationId } from '../src/agents/repo.ts';
import { loadMessages, saveMessage, type OpenDotsUIMessage } from '../src/conversations/repo.ts';
import { IMAGE_MAX_BYTES } from '@opendots/shared';
let a: AccountContext, b: AccountContext, cookieA: string, cookieB: string, image: Buffer, attachment: Attachment;
const app = createApplication(async () => { await openDatabase({ memory: true }); });
beforeAll(async () => {
  await authStore(true); a = await registerUser('images-alice@example.com', 'image test password'); b = await registerUser('images-bob@example.com', 'image test password');
  cookieA = `opendots_session=${await createSession(a.id)}`; cookieB = `opendots_session=${await createSession(b.id)}`;
  for (const account of [a, b]) await withAccount(account, () => openDatabase({ memory: true }));
  image = await sharp({ create: { width: 30, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
});
afterAll(async () => { await closeAllDatabases(); await closeAuthStore(); });
function upload(data: Buffer, name: string, cookie = cookieA) {
  const body = new FormData(); body.set('file', new File([new Uint8Array(data)], name, { type: 'image/png' }));
  return app.request('https://app.example/api/attachments', { method: 'POST', headers: { cookie, 'x-opendots-client': '1' }, body });
}
it('refuse l’accès anonyme et normalise une vraie image multipart sur une URL privée', async () => {
  expect((await upload(image, 'photo.png', '')).status).toBe(401);
  const response = await upload(image, 'photo.png'); expect(response.status).toBe(200); attachment = await response.json();
  expect(attachment).toMatchObject({ mediaType: 'image/jpeg', filename: 'photo.jpg', width: 30, height: 20 });
  expect(attachment.url).toMatch(/^\/api\/attachments\/[a-f0-9]{32}$/);
  const own = await app.request(`https://app.example${attachment.url}`, { headers: { cookie: cookieA } });
  expect(own.status).toBe(200); expect(own.headers.get('cache-control')).toBe('no-store'); expect(own.headers.get('content-type')).toContain('image/jpeg');
  const normalized = Buffer.from(await own.arrayBuffer()); expect((await sharp(normalized).metadata()).format).toBe('jpeg');
  const pixel = await sharp(normalized).raw().toBuffer(); expect([...pixel.subarray(0, 3)]).toEqual([255, 255, 255]);
  expect((await app.request(`https://app.example${attachment.url}`, { headers: { cookie: cookieB } })).status).toBe(404);
});
it('corrige l’orientation et retire les métadonnées EXIF', async () => withAccount(a, async () => {
  const input = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#abcdef' } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Private metadata' } } }).toBuffer();
  const stored = await storeImage(input, 'orientation.jpg'), actual = (await readAttachment(stored.id))!;
  const metadata = await sharp(actual.bytes).metadata(); expect([metadata.width, metadata.height]).toEqual([10, 20]); expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
}));
it('refuse SVG, faux types, fichiers corrompus, surdimensionnés et quotas dépassés', async () => withAccount(a, async () => {
  expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'fake.png')).status).toBe(400);
  await expect(storeImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'broken.png')).rejects.toThrow('invalide');
  await expect(storeImage(Buffer.alloc(IMAGE_MAX_BYTES + 1), 'large.png')).rejects.toThrow('10 Mo');
  const before = process.env.OPENDOTS_ATTACHMENTS_QUOTA_MB; process.env.OPENDOTS_ATTACHMENTS_QUOTA_MB = '0.00001';
  try { await expect(storeImage(image, 'quota.png')).rejects.toThrow('épuisé'); }
  finally { if (before === undefined) delete process.env.OPENDOTS_ATTACHMENTS_QUOTA_MB; else process.env.OPENDOTS_ATTACHMENTS_QUOTA_MB = before; }
}));
it('valide la propriété des images et empêche les URL distantes ou de fichiers serveur', async () => withAccount(a, async () => {
  const file = { type: 'file', mediaType: 'image/svg+xml', filename: 'fake', url: attachment.url };
  expect(await validateMessageParts([file])).toEqual([{ type: 'file', mediaType: 'image/jpeg', filename: attachment.filename, url: attachment.url }]);
  await expect(withAccount(b, () => validateMessageParts([file]))).rejects.toThrow('non autorisée');
  for (const url of ['http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', '/api/attachments/../secret.key', 'data:image/png;base64,AAA=']) await expect(validateMessageParts([{ ...file, url }])).rejects.toThrow('non autorisée');
  await expect(validateMessageParts(Array.from({ length: 7 }, () => file))).rejects.toThrow('6 images');
  const agent = await withAccount(b, () => createAgent({ name: 'Bob' }));
  const response = await app.request(`https://app.example/api/agents/${agent.id}/chat`, { method: 'POST', headers: { cookie: cookieB, 'x-opendots-client': '1', 'content-type': 'application/json' }, body: JSON.stringify({ message: { id: 'foreign-image', role: 'user', parts: [file] } }) });
  expect(response.status).toBe(400);
}));
it('conserve les références en historique et transmet les octets JPEG au modèle', async () => withAccount(a, async () => {
  const agent = await createAgent({ name: 'Images' }), conversation = await mainConversationId(agent.id);
  const message: OpenDotsUIMessage = { id: 'image-message', role: 'user', parts: await validateMessageParts([{ type: 'text', text: 'Regarde ceci' }, { type: 'file', url: attachment.url }]) };
  await saveMessage(conversation, message, { author: 'user' });
  const history = (await loadMessages(conversation)).messages;
  expect(JSON.stringify(history)).toContain(attachment.url); expect(JSON.stringify(history)).not.toContain('base64');
  const hydrated = await hydrateMessageImages(history); let payload: any;
  const model = createOpenRouter({ apiKey: 'fixture-not-a-real-key', fetch: async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'fixture', created: 1, model: 'fixture/vision', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Image seen' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
  } }).chat('fixture/vision');
  expect((await generateText({ model, messages: await convertToModelMessages(hydrated) })).text).toBe('Image seen');
  const part = payload.messages.find((m: any) => m.role === 'user').content.find((p: any) => p.type === 'image_url'); expect(part.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  expect((await sharp(Buffer.from(part.image_url.url.split(',')[1], 'base64')).metadata()).width).toBe(30);
  expect(JSON.stringify(message)).not.toContain('base64');
}));
it('borne le contexte visuel et n’effectue aucune lecture HTTP pour des images étrangères', async () => withAccount(a, async () => {
  const history: OpenDotsUIMessage[] = Array.from({ length: 13 }, (_, i) => ({ id: String(i), role: 'user', parts: [{ type: 'file', url: attachment.url, mediaType: 'image/jpeg' }] }));
  const hydrated = await hydrateMessageImages(history); expect(hydrated[0].parts[0].type).toBe('text'); expect(hydrated.slice(1).every((m) => m.parts[0].type === 'file')).toBe(true);
  const foreign: OpenDotsUIMessage = { id: 'external', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'http://127.0.0.1/private' }] };
  expect((await hydrateMessageImages([foreign]))[0].parts[0].type).toBe('text');
  const legacy: OpenDotsUIMessage = { id: 'legacy', role: 'assistant', parts: [{ type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${image.toString('base64')}` }] };
  expect((await hydrateMessageImages([legacy]))[0].parts[0]).toEqual(legacy.parts[0]);
}));
