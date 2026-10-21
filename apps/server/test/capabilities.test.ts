import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SMTPServer } from 'smtp-server';
// @ts-expect-error module CommonJS sans types
import hoodiecrow from 'hoodiecrow-imap';
import { ImapFlow } from 'imapflow';
import { closeDatabase, db, openDatabase, schema } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { buildCapabilityTools } from '../src/agents/capability-tools.ts';
import { buildTools } from '../src/agents/tools.ts';
import { createConnector, getConnector, toConnectorDTO } from '../src/connectors/repo.ts';
import { closeAllMcpClients, refreshMcpConnector } from '../src/connectors/mcp.ts';
import { installPlugin, listPlugins, parseManifest, uninstallPlugin } from '../src/connectors/plugins.ts';
import { listSkills } from '../src/skills/repo.ts';
import { getApproval, resolveApproval } from '../src/approvals/service.ts';
import { getDraft, pollAccount, testMailAccount } from '../src/mail/service.ts';
import { createActivity } from '../src/activities/repo.ts';
import { answerRequest, getRequest } from '../src/requests/service.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mcpFixture = join(here, 'fixtures/mcp-server.ts');
const tsxLoader = join(here, '../node_modules/tsx/dist/loader.mjs');
const stdio = { transport: 'stdio' as const, command: process.execPath, args: ['--import', tsxLoader, mcpFixture] };
const opts = { toolCallId: 'call-1', messages: [] } as any;

let smtp: SMTPServer;
let smtpPort = 0;
const sent: { from: string; to: string[]; raw: string }[] = [];
let imap: any;
let imapPort = 0;

beforeAll(async () => {
  await openDatabase({ memory: true });
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (_auth, _session, cb) => cb(null, { user: 'testuser' }),
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c) => (raw += c));
      stream.on('end', () => {
        sent.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
  smtpPort = (smtp.server.address() as AddressInfo).port;
  imap = hoodiecrow({
    storage: {
      INBOX: { messages: [{ raw: 'From: ancien@exemple.com\r\nSubject: Ancien message\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nD=C3=A9j=C3=A0 l=C3=A0.', flags: ['\\Seen'] }] },
      '': { separator: '/', folders: { Sent: {} } },
    },
  });
  await new Promise<void>((r) => imap.listen(0, '127.0.0.1', () => r()));
  imapPort = imap.server?.address?.().port ?? imap.address?.().port;
});

afterAll(async () => {
  await closeAllMcpClients();
  smtp.close();
  imap.close?.();
  await closeDatabase();
});

async function ctxFor(name: string, userTurn = true) {
  const agent = (await getAgent((await createAgent({ name })).id))!;
  return { agent, conversationId: await mainConversationId(agent.id), isMain: true, userTurn, depth: 0, tz: 'UTC' };
}

describe('connecteurs MCP', () => {
  it('se connecte à un serveur stdio et liste ses outils', async () => {
    const row = await createConnector({ name: 'Démo', kind: 'mcp', config: stdio, secrets: { DEMO_SECRET: 'licorne' }, approval: 'auto' });
    const refreshed = await refreshMcpConnector(row.id);
    expect(refreshed.lastError).toBeNull();
    expect(refreshed.status).toBe('ok');
    expect(refreshed.tools?.map((t) => t.name).sort()).toEqual(['add', 'secret_word']);
    // Les secrets ne sont jamais renvoyés au frontend.
    expect(JSON.stringify(toConnectorDTO(refreshed))).not.toContain('licorne');
  });

  it('expose les outils aux compagnons et passe les secrets au serveur', async () => {
    const ctx = await ctxFor('Mcp');
    const { tools } = await buildCapabilityTools(ctx);
    const out: any = await tools.mcp_demo_add.execute!({ a: 2, b: 40 }, opts);
    expect(out).toMatchObject({ ok: true, untrusted_content: '42' });
    const secret: any = await tools.mcp_demo_secret_word.execute!({}, opts);
    expect(secret.untrusted_content).toContain('licorne');
  });

  it('demande une validation en mode « ask » puis exécute', async () => {
    const row = await createConnector({ name: 'Prudent', kind: 'mcp', config: stdio, approval: 'ask' });
    await refreshMcpConnector(row.id);
    const ctx = await ctxFor('Ask');
    const { tools } = await buildCapabilityTools(ctx);
    const out: any = await tools.mcp_prudent_add.execute!({ a: 1, b: 1 }, opts);
    expect(out.status).toBe('pending_approval');
    const res = await resolveApproval(out.approvalId, 'approve', { by: 'ui', notifyAgent: false });
    expect(res.status).toBe('executed');
    expect((res.result as any).untrusted_content).toBe('2');
  });

  it('un connecteur en panne ne bloque pas le tour', async () => {
    const broken = await createConnector({ name: 'Cassé', kind: 'mcp', config: { transport: 'stdio', command: '/nonexistent/bin' }, approval: 'auto' });
    const ctx = await ctxFor('Robust');
    const { tools, info } = await buildCapabilityTools(ctx);
    expect(tools.mcp_demo_add).toBeDefined();
    expect(info.connectors.some((c) => c.includes('Cassé') && c.includes('indisponible'))).toBe(true);
    expect((await getConnector(broken.id))?.status).toBe('error');
  });
});

describe('plugins et skills', () => {
  it('installe et désinstalle un plugin avec skills et connecteurs', async () => {
    const manifest = parseManifest({
      name: 'Rédaction',
      version: '1.0.0',
      skills: [{ name: 'Compte rendu', description: 'Rédiger un compte rendu de réunion', instructions: '1. Décisions\n2. Actions\n3. Questions ouvertes' }],
      connectors: [{ name: 'Calc', config: stdio, approval: 'auto' }],
    });
    const id = await installPlugin(manifest, { source: 'test' });
    expect((await listPlugins()).find((p) => p.id === id)).toMatchObject({ skills: 1, connectors: 1 });
    const ctx = await ctxFor('Skilled');
    const { tools, info } = await buildCapabilityTools(ctx);
    expect(info.skills.map((s) => s.name)).toContain('Compte rendu');
    const loaded: any = await tools.skill_use.execute!({ name: 'compte rendu' }, opts);
    expect(loaded.instructions).toContain('Décisions');
    await uninstallPlugin(id);
    expect((await listSkills()).some((s) => s.name === 'Compte rendu')).toBe(false);
  });

  it('refuse un manifeste invalide', () => {
    expect(() => parseManifest({ skills: [] })).toThrow(/Manifeste invalide/);
  });

  it('enregistre un skill depuis la conversation, pas lors d’un réveil autonome', async () => {
    const auto = await buildCapabilityTools(await ctxFor('AutoSkill', false));
    expect(auto.tools.skill_save).toBeUndefined();
    const { tools } = await buildCapabilityTools(await ctxFor('UserSkill'));
    const out: any = await tools.skill_save.execute!({ name: 'Ton pro', description: 'E-mails professionnels', instructions: 'Vouvoiement, phrases courtes.' }, opts);
    expect(out.ok).toBe(true);
  });
});

describe('demandes à l’utilisateur', () => {
  it('crée un formulaire et valide les réponses', async () => {
    const ctx = await ctxFor('Asker');
    const { tools } = await buildCapabilityTools(ctx);
    const out: any = await tools.ask_user.execute!(
      {
        title: 'Préférences',
        questions: [
          { id: 'ville', label: 'Ville', type: 'single_choice', options: ['Luxembourg', 'Metz'], required: true },
          { id: 'jours', label: 'Jours', type: 'multi_choice', options: ['lun', 'mar', 'mer'] },
          { id: 'ok', label: 'Télétravail ?', type: 'confirm' },
        ],
      },
      opts,
    );
    expect(out.status).toBe('awaiting_user');
    await expect(answerRequest(out.requestId, {})).rejects.toThrow(/requise/);
    const { summary } = await answerRequest(out.requestId, { ville: 'Metz', jours: ['lun', 'mer'], ok: true });
    expect(summary).toContain('Ville : Metz');
    expect(summary).toContain('Jours : lun, mer');
    expect((await getRequest(out.requestId))?.status).toBe('answered');
    await expect(answerRequest(out.requestId, { ville: 'Metz' })).rejects.toThrow(/déjà/);
  });
});

describe('mail', () => {
  const mailConfig = () => ({
    email: 'moi@exemple.com',
    displayName: 'Moi',
    username: 'testuser',
    imap: { host: '127.0.0.1', port: imapPort, secure: false },
    smtp: { host: '127.0.0.1', port: smtpPort, secure: false },
  });

  it('teste la connexion IMAP et SMTP', async () => {
    expect(await testMailAccount(mailConfig(), 'testpass')).toEqual({ ok: true, imap: 'ok', smtp: 'ok' });
    const bad = await testMailAccount(mailConfig(), 'mauvais');
    expect(bad.ok).toBe(false);
  });

  it('recherche, lit, prépare puis envoie après validation', async () => {
    const account = await createConnector({ name: 'Perso', kind: 'mail', config: mailConfig(), secrets: { password: 'testpass' } });
    const ctx = await ctxFor('Venty');
    const { tools, info } = await buildCapabilityTools(ctx);
    expect(info.connectors.some((c) => c.includes('moi@exemple.com'))).toBe(true);

    const search: any = await tools.mail_search.execute!({ from: 'ancien' }, opts);
    expect(search.results).toHaveLength(1);
    const read: any = await tools.mail_read.execute!({ uid: search.results[0].uid }, opts);
    expect(read.untrusted_content).toContain('Déjà là');

    const prep: any = await tools.mail_prepare.execute!(
      { to: ['laurence@venthone.lu'], subject: 'Congés', body: 'Bonjour Laurence,\nMerci !', reply_to_uid: search.results[0].uid },
      opts,
    );
    expect(prep.status).toBe('pending_approval');
    expect(sent).toHaveLength(0);
    const res = await resolveApproval(prep.approvalId, 'approve', { by: 'ui', notifyAgent: false });
    expect(res.status).toBe('executed');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['laurence@venthone.lu']);
    expect(sent[0].raw).toContain('Subject: =?UTF-8?Q?Cong=C3=A9s?=');
    expect(sent[0].raw).toContain('From: Moi <moi@exemple.com>');
    expect((await getDraft(prep.draftId))?.status).toBe('sent');
    expect(account.id).toMatch(/^mail_/);
  });

  it('un refus abandonne le brouillon sans envoyer', async () => {
    const ctx = await ctxFor('Refus');
    const { tools } = await buildCapabilityTools(ctx);
    const prep: any = await tools.mail_prepare.execute!({ to: ['x@exemple.com'], subject: 'Non', body: 'Test' }, opts);
    const before = sent.length;
    await resolveApproval(prep.approvalId, 'reject', { by: 'ui', notifyAgent: false });
    expect(sent.length).toBe(before);
    expect((await getDraft(prep.draftId))?.status).toBe('discarded');
    expect((await getApproval(prep.approvalId))?.status).toBe('rejected');
  });

  it('réveille le compagnon concerné à la réception d’un e-mail filtré', async () => {
    const ctx = await ctxFor('Courrier');
    const [account] = (await db().select().from(schema.connectors).where(eq(schema.connectors.kind, 'mail')));
    await createActivity({ agentId: ctx.agent.id, title: 'Venthone', kind: 'mail', instructions: 'Prépare une réponse', filter: { from: 'venthone.lu' }, tz: 'UTC' });
    // Première relève : on mémorise la position sans traiter l'historique.
    expect(await pollAccount(account)).toBe(0);
    const client = new ImapFlow({ host: '127.0.0.1', port: imapPort, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
    await client.connect();
    await client.append('INBOX', 'From: Laurence <laurence@venthone.lu>\r\nSubject: Vos congés\r\n\r\nPouvez-vous confirmer ?');
    await client.append('INBOX', 'From: pub@promo.com\r\nSubject: Soldes\r\n\r\n-50%');
    await client.logout();
    const fresh = (await getConnector(account.id))!;
    expect(await pollAccount(fresh)).toBe(2);
    const wakes = (await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, ctx.agent.id))).filter((j) => j.type === 'agent.wake');
    expect(wakes).toHaveLength(1);
    expect((wakes[0].payload as any).text).toContain('Vos congés');
    expect((wakes[0].payload as any).text).toContain('non fiable');
  });

  it('ne perd pas le premier e-mail quand la boîte était vide à la connexion', async () => {
    const empty = hoodiecrow({ storage: { INBOX: { messages: [] } } });
    await new Promise<void>((r) => empty.listen(0, '127.0.0.1', () => r()));
    const port = empty.server?.address?.().port ?? empty.address?.().port;
    const account = await createConnector({
      name: 'Vide',
      kind: 'mail',
      config: { ...mailConfig(), email: 'vide@exemple.com', imap: { host: '127.0.0.1', port, secure: false } },
      secrets: { password: 'testpass' },
    });
    expect(await pollAccount(account)).toBe(0);
    expect(await pollAccount((await getConnector(account.id))!)).toBe(0);
    const client = new ImapFlow({ host: '127.0.0.1', port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
    await client.connect();
    await client.append('INBOX', 'From: a@b.com\r\nSubject: Premier\r\n\r\nBonjour');
    await client.logout();
    expect(await pollAccount((await getConnector(account.id))!)).toBe(1);
    empty.close?.();
  });

  it('les outils mail suivent la permission du compagnon', async () => {
    const ctx = await ctxFor('SansMail');
    ctx.agent.permissions = { ...ctx.agent.permissions, mail: false };
    const { tools } = await buildCapabilityTools(ctx);
    expect(tools.mail_search).toBeUndefined();
    expect(buildTools(ctx).activity_create).toBeDefined();
  });
});
