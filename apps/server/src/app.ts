import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config.ts';
import { createApi } from './api/routes.ts';
import { authRoutes, requireAccount } from './auth/routes.ts';
import { activateAccount } from './auth/runtime.ts';
import type { AccountContext } from './auth/context.ts';

/** One guarded entry point, also used by integration tests. */
export function createApplication(activate: (account: AccountContext) => Promise<void> = activateAccount) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
    await next();
  });
  app.route('/api/auth', authRoutes());
  app.use('/api/*', requireAccount(activate));
  app.route('/api', createApi());
  if (existsSync(config.webDist)) {
    app.use('/*', serveStatic({ root: config.webDist.replace(process.cwd() + '/', './') }));
    app.get('*', serveStatic({ path: `${config.webDist}/index.html`.replace(process.cwd() + '/', './') }));
  }
  return app;
}
