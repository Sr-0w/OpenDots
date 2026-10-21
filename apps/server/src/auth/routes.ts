import { sessionStream } from './stream.ts';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../config.ts';
import { withAccount, type AccountContext } from './context.ts';
import { accountById, authenticate, AuthError, createSession, publicAccount, registerUser, revokeSession, sessionAccount } from './store.ts';

const COOKIE = 'opendots_session';
const attempts = new Map<string, { count: number; until: number }>();
const credentials = z.object({ email: z.string().max(254), password: z.string().max(256) });
export function appOrigin(c: Context) { return new URL(config.publicUrl ?? c.req.url).origin; }
export function sameOriginMutation(c: Context) {
  return c.req.header('x-opendots-client') === '1' && (!c.req.header('origin') || c.req.header('origin') === appOrigin(c));
}
function throttle(key: string, limit: number, duration: number) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const item = attempts.get(key) ?? { count: 0, until: now + duration };
  item.count++; attempts.set(key, item);
  return item.count > limit;
}
export function authRoutes() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'GET' && !sameOriginMutation(c)) return c.json({ error: 'Origine non autorisée.' }, 403);
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > 4096) return c.json({ error: 'Requête trop volumineuse.' }, 413);
    return next();
  });
  app.onError((error, c) => c.json({ error: error instanceof AuthError || error instanceof z.ZodError ? error.message : 'Connexion impossible.' }, 400));
  app.get('/me', async (c) => {
    const account = await sessionAccount(getCookie(c, COOKIE));
    return c.json({ account: account ? publicAccount(account) : null, registrationOpen: process.env.OPENDOTS_REGISTRATION !== 'closed' });
  });
  for (const kind of ['login', 'register'] as const) app.post(`/${kind}`, async (c) => {
    const origin = new URL(appOrigin(c));
    if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return c.json({ error: 'HTTPS est requis pour se connecter ou créer un compte.' }, 403);
    const raw = await c.req.text();
    if (raw.length > 4096) return c.json({ error: 'Requête trop volumineuse.' }, 413);
    const { email, password } = credentials.parse(JSON.parse(raw));
    const ip = (c.env as any)?.incoming?.socket?.remoteAddress ?? 'local';
    if (throttle(`${kind}:ip:${ip}`, kind === 'register' ? 20 : 100, 15 * 60_000) || throttle(`${kind}:email:${email.trim().toLowerCase()}`, 10, 15 * 60_000)) return c.json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' }, 429);
    if (kind === 'register' && process.env.OPENDOTS_REGISTRATION === 'closed') return c.json({ error: 'Les inscriptions sont fermées.' }, 403);
    const account = kind === 'register' ? await registerUser(email, password) : await authenticate(email, password);
    const previous = getCookie(c, COOKIE);
    if (previous) await revokeSession(previous);
    setCookie(c, COOKIE, await createSession(account.id), { httpOnly: true, secure: appOrigin(c).startsWith('https:'), sameSite: 'Lax', path: '/', maxAge: 7 * 86400 });
    return c.json({ account: publicAccount(account) });
  });
  app.post('/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await revokeSession(token);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
  return app;
}

export function requireAccount(activate: (account: AccountContext) => Promise<void>): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, COOKIE);
    let account = await sessionAccount(token);
    const hook = /^\/api\/hooks\/(usr_[a-f0-9]{32})\/[^/]+$/.exec(c.req.path);
    if (hook && c.req.method === 'POST') account = await accountById(hook[1]);
    if (!account) return c.json({ error: 'Connexion requise.' }, 401);
    if (!['GET', 'HEAD'].includes(c.req.method) && !hook && !sameOriginMutation(c)) return c.json({ error: 'Origine non autorisée.' }, 403);
    const actor = account;
    return withAccount(actor, async () => {
      await activate(actor); await next();
      if (token && c.res.body && c.res.headers.get('content-type')?.startsWith('text/event-stream') && c.req.path !== '/api/events') {
        c.res = new Response(await sessionStream(c.res.body, token), { status: c.res.status, headers: c.res.headers });
      }
    });
  };
}
