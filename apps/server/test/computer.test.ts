import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { buildTools } from '../src/agents/tools.ts';
import { buildCapabilityTools } from '../src/agents/capability-tools.ts';
import { dockerAvailable, execShell } from '../src/computer/shell.ts';
import { setSetting } from '../src/settings.ts';
import { resolveApproval } from '../src/approvals/service.ts';

const opts = { toolCallId: 'c1', messages: [] } as any;

beforeAll(async () => {
  await openDatabase({ memory: true });
});
afterAll(async () => {
  await closeDatabase();
});

async function ctxFor(name: string) {
  const agent = (await getAgent((await createAgent({ name })).id))!;
  return { agent, conversationId: await mainConversationId(agent.id), isMain: true, userTurn: true, depth: 0, tz: 'Europe/Paris' };
}

describe('datetime', () => {
  it('donne l’heure locale et calcule des dates relatives', async () => {
    const tools = buildTools(await ctxFor('Horloge'));
    const out: any = await tools.datetime.execute!({ from: '2026-10-21T10:00:00Z', add_days: 3 }, opts);
    expect(out.iso_utc).toBe('2026-10-24T10:00:00.000Z');
    expect(out.weekday).toBe('samedi');
    expect(out.utc_offset).toBe('+02:00');
    const bad: any = await tools.datetime.execute!({ timezone: 'Mars/Olympus' }, opts);
    expect(bad.ok).toBe(false);
  });
});

describe('shell sur la machine hôte', () => {
  it('exécute dans le dossier personnel, avec code de sortie et délai', async () => {
    const ctx = await ctxFor('Hôte');
    const r = await execShell(ctx.agent.id, 'echo bonjour > note.txt && cat note.txt && pwd', {});
    expect(r.backend).toBeDefined();
    if (r.backend === 'host') {
      expect(r.stdout).toContain('bonjour');
      expect(r.stdout).toContain(ctx.agent.id);
    }
    expect(r.exitCode).toBe(0);
  });

  it('demande une validation par défaut sur la machine hôte', async () => {
    await setSetting('shell.config', { mode: 'host', approval: 'default', image: 'debian:stable-slim', network: true, sudo: false });
    const ctx = await ctxFor('Prudent');
    const { tools } = await buildCapabilityTools(ctx);
    const out: any = await tools.shell_exec.execute!({ command: 'echo 42' }, opts);
    expect(out.status).toBe('pending_approval');
    const res = await resolveApproval(out.approvalId, 'approve', { by: 'ui', notifyAgent: false });
    expect(res.status).toBe('executed');
    expect((res.result as any).stdout.trim()).toBe('42');
  });

  it('interrompt une commande trop longue', async () => {
    const ctx = await ctxFor('Lent');
    const r = await execShell(ctx.agent.id, 'sleep 30', { timeoutSeconds: 1 });
    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(10_000);
  });

  it('respecte la permission et le mode désactivé', async () => {
    await setSetting('shell.config', { mode: 'off', approval: 'default', image: 'debian:stable-slim', network: true, sudo: false });
    const { tools } = await buildCapabilityTools(await ctxFor('Off'));
    expect(tools.shell_exec).toBeUndefined();
    await setSetting('shell.config', { mode: 'host', approval: 'auto', image: 'debian:stable-slim', network: true, sudo: false });
    const ctx = await ctxFor('SansShell');
    ctx.agent.permissions = { ...ctx.agent.permissions, shell: false };
    expect((await buildCapabilityTools(ctx)).tools.shell_exec).toBeUndefined();
  });
});

describe('ordinateur partagé (Docker)', () => {
  it('isole chaque compagnon et partage un dossier commun', async (t) => {
    if (!(await dockerAvailable())) return t.skip();
    await setSetting('shell.config', { mode: 'docker', approval: 'auto', image: 'debian:stable-slim', network: false, sudo: false });
    const a = await ctxFor('Alpha');
    const b = await ctxFor('Beta');
    const ra = await execShell(a.agent.id, 'whoami && pwd && echo secret > prive.txt && echo bonjour > /workspaces/shared/commun.txt');
    expect(ra.backend).toBe('docker');
    expect(ra.exitCode).toBe(0);
    expect(ra.stdout).toContain(`/workspaces/${a.agent.id}`);
    const rb = await execShell(b.agent.id, `cat /workspaces/shared/commun.txt; cat /workspaces/${a.agent.id}/prive.txt`);
    expect(rb.stdout).toContain('bonjour');
    expect(rb.stderr).toMatch(/Permission denied/);
    const net = await execShell(b.agent.id, 'getent hosts example.com || echo sans-reseau', { timeoutSeconds: 10 });
    expect(net.stdout).toContain('sans-reseau');
  }, 120_000);
});
