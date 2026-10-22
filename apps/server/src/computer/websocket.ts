import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { parse } from 'hono/utils/cookie';
import { config } from '../config.ts';
import { sessionAccount, sessionExpiresAt, onSessionRevoked } from '../auth/store.ts';
import { withAccount, type AccountContext } from '../auth/context.ts';
import { activateAccount } from '../auth/runtime.ts';
import { desktopEnabled, desktopStatus, startDesktop, desktopVncStream } from './desktop.ts';
import { getAgent } from '../agents/repo.ts';
import { withDesktopAgent, desktopAgentId } from './session.ts';
import { leaseComputer } from './shell.ts';
import { getShellSettings } from '../settings.ts';
import { subscribe } from '../bus.ts';

/** Authenticated, same-origin WebSocket → private loopback VNC. No public VNC. */
export function attachDesktopWebSocket(server: HttpServer, activate: (account: AccountContext) => Promise<void> = activateAccount) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); };
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); }
    catch { return refuse(400); }
    if (url.pathname !== '/api/computer/vnc') return refuse(404);
    const agentId = url.searchParams.get('agentId');
    socket.pause();
    const timeout = setTimeout(() => socket.destroy(), 15_000);
    void (async () => {
      const expected = new URL(config.publicUrl ?? `${(req.socket as any).encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
      if (!req.headers.origin || req.headers.origin !== expected) return refuse(403);
      const token = parse(req.headers.cookie ?? '').opendots_session;
      const account = await sessionAccount(token);
      if (!account || !token) return refuse(401);
      await withAccount(account, async () => {
        await activate(account);
        if (!agentId || !/^ag_[a-zA-Z0-9_]+$/.test(agentId)) return refuse(400);
        const agent = await getAgent(agentId);
        if (!agent || agent.archived) return refuse(404);
        return withDesktopAgent(agentId, async () => {
        if (!await desktopEnabled() || !(await desktopStatus()).running) return refuse(409);
        const port = await startDesktop(), expires = await sessionExpiresAt(token);
        if (socket.destroyed || !await sessionAccount(token)) return refuse(401);
        wss.handleUpgrade(req, socket, head, (ws) => relay(ws, req, port, token, expires, account));
        socket.resume();
        });
      });
    })().catch(() => refuse(503)).finally(() => clearTimeout(timeout));
  });
  function relay(ws: WebSocket, req: IncomingMessage, port: number, token: string, expires: number, account: AccountContext) {
    const botId = desktopAgentId();
    const release = leaseComputer();
    const upstream = desktopVncStream(port);
    let closed = false;
    const close = () => { if (closed) return; closed = true; clearTimeout(expiry); clearInterval(heartbeat); offSession(); offEvents(); upstream.kill(); release(); ws.terminate(); };
    const expiry = setTimeout(close, Math.min(2 ** 31 - 1, Math.max(0, expires - Date.now())));
    const offSession = onSessionRevoked(token, close);
    const offEvents = withAccount(account, () => subscribe((event) => {
      if (event.type === 'settings.changed') void withAccount(account, () => withDesktopAgent(botId, async () => {
        const shell = await getShellSettings();
        if (!await desktopEnabled() || shell.mode === 'off' || !shell.network) close();
      })).catch(close);
    }));
    let alive = true;
    const heartbeat = setInterval(() => { if (!alive || Date.now() >= expires) return close(); alive = false; ws.ping(); }, 30_000);
    ws.on('pong', () => { alive = true; });
    upstream.stdout.on('data', (chunk) => {
      if (ws.readyState !== WebSocket.OPEN) return close();
      upstream.stdout.pause();
      ws.send(chunk, { binary: true }, (error) => { if (error) close(); else if (!closed) upstream.stdout.resume(); });
    });
    upstream.stdin.on('error', close); upstream.stderr.resume();
    upstream.on('error', close); upstream.on('close', close);
    ws.on('message', (data, binary) => {
      if (!binary || closed || upstream.stdin.writableLength > 2_000_000) return close();
      const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      upstream.stdin.write(buffer);
    });
    ws.on('error', close); ws.on('close', close); req.on('aborted', close);
    // Logout may have raced with registering the listener above.
    void sessionAccount(token).then((actor) => { if (!actor || actor.id !== account.id) close(); }).catch(close);
  }
  return () => { for (const ws of wss.clients) ws.terminate(); wss.close(); };
}
