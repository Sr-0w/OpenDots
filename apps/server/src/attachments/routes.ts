import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { IMAGE_MAX_BYTES } from '@opendots/shared';
import { AttachmentError, readAttachment, storeImage } from './service.ts';
export function attachmentRoutes() {
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error instanceof AttachmentError ? error.message : 'Impossible de joindre cette image.' }, 400));
  app.post('/', bodyLimit({ maxSize: IMAGE_MAX_BYTES + 64 * 1024, onError: (c) => c.json({ error: 'Une image ne peut pas dépasser 10 Mo.' }, 413) }), async (c) => {
    const body = await c.req.parseBody();
    if (!(body.file instanceof File)) return c.json({ error: 'Choisis une image.' }, 400);
    return c.json(await storeImage(new Uint8Array(await body.file.arrayBuffer()), body.file.name));
  });
  app.get('/:id', async (c) => {
    const found = await readAttachment(c.req.param('id'));
    if (!found) return c.json({ error: 'Image introuvable.' }, 404);
    c.header('Content-Type', 'image/jpeg'); c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(found.attachment.filename)}`);
    return c.body(new Uint8Array(found.bytes));
  });
  return app;
}
