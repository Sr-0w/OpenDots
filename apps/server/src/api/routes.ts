import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createUIMessageStreamResponse } from 'ai';
import { z } from 'zod';
import type { BootstrapDTO, ModelConfig } from '@opendots/shared';
import { subscribe } from '../bus.ts';
import { getAgent, listAgentRows, listAgents, mainConversationId, toAgentDTO, updateAgent, createAgent } from '../agents/repo.ts';
import { runTurn } from '../agents/turn.ts';
import { getActiveStream } from '../agents/streams.ts';
import { getConversation, listTeamThreads, loadMessages, type OpenDotsUIMessage } from '../conversations/repo.ts';
import {
  checkModel,
  listOllamaModels,
  listOpenRouterEndpoints,
  listOpenRouterModels,
  validateOpenRouterKey,
} from '../models/gateway.ts';
import {
  getDefaultModel,
  getOpenRouterKey,
  getSetting,
  getTimezone,
  isPaused,
  setOpenRouterKey,
  setSetting,
} from '../settings.ts';
import { maskSecret } from '../secrets.ts';
import { deleteActivity, findActivityByWebhook, getActivity, listActivities, toActivityDTO, updateActivity, ActivityError } from '../activities/repo.ts';
import { checkWatch, ingestWebhook } from '../life/engine.ts';
import { enqueue } from '../jobs/queue.ts';
import { ApprovalError, listApprovals, resolveApproval } from '../approvals/service.ts';
import { forget, listMemories, listSharedMemories, remember, updateMemory } from '../memory/repo.ts';
import { listJournal, log } from '../journal.ts';
import { errorMessage } from '../util.ts';
import { createSkill, deleteSkill, listSkills, SkillError, toSkillDTO, updateSkill } from '../skills/repo.ts';
import { ConnectorError, createConnector, deleteConnector, getConnector, listConnectors, toConnectorDTO, updateConnector } from '../connectors/repo.ts';
import { closeMcpClient, refreshMcpConnector } from '../connectors/mcp.ts';
import { fetchManifest, installPlugin, listPlugins, parseManifest, PluginError, uninstallPlugin } from '../connectors/plugins.ts';
import { getDraft, MailError, pollAccount, testMailAccount, toDraftDTO, updateDraft } from '../mail/service.ts';
import { answerRequest, getRequest, RequestError, toRequestDTO } from '../requests/service.ts';
import { createActivity } from '../activities/repo.ts';
import type { MailConfig } from '@opendots/shared';
import { computerStatus, resetContainer } from '../computer/shell.ts';
import { getSearchSettings, getShellSettings, setSearchSettings } from '../settings.ts';

const modelSchema = z.object({
  provider: z.enum(['openrouter', 'ollama']),
  model: z.string().min(1),
  reasoning: z.enum(['low', 'medium', 'high']).nullable().optional(),
  providerOrder: z.array(z.string()).nullable().optional(),
});

export function createApi() {
  const api = new Hono();

  api.onError((err, c) => {
    console.error('[api]', err);
    const status =
      err instanceof z.ZodError ||
      err instanceof ActivityError ||
      err instanceof ApprovalError ||
      err instanceof SkillError ||
      err instanceof ConnectorError ||
      err instanceof PluginError ||
      err instanceof MailError ||
      err instanceof RequestError
        ? 400
        : 500;
    return c.json({ error: err instanceof z.ZodError ? 'Requête invalide' : errorMessage(err) }, status);
  });

  // Les requêtes de modification doivent provenir du client OpenDots (en-tête
  // personnalisé => pré-vérification CORS obligatoire pour un site tiers).
  api.use('*', async (c, next) => {
    const token = process.env.OPENDOTS_TOKEN;
    if (c.req.path.startsWith('/api/hooks/')) return next();
    if (token && c.req.header('authorization') !== `Bearer ${token}` && c.req.query('token') !== token) {
      return c.json({ error: 'Non autorisé' }, 401);
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-opendots-client') !== '1') {
      return c.json({ error: 'Client non reconnu' }, 403);
    }
    return next();
  });

  // --- Démarrage & onboarding ---------------------------------------------

  api.get('/bootstrap', async (c) => {
    const dto: BootstrapDTO = {
      onboarded: Boolean(await getSetting('onboarding.done')) && (await listAgentRows()).length > 0,
      openrouterConfigured: Boolean(await getOpenRouterKey()),
      defaultModel: await getSetting('models.default'),
      ollamaUrl: await getSetting('ollama.url'),
      paused: await isPaused(),
    };
    return c.json(dto);
  });

  api.post('/onboarding/key', async (c) => {
    const { key } = z.object({ key: z.string().min(10) }).parse(await c.req.json());
    const res = await validateOpenRouterKey(key.trim());
    if (!res.ok) return c.json({ ok: false, error: res.error }, 400);
    await setOpenRouterKey(key.trim());
    return c.json({ ok: true });
  });

  api.post('/onboarding/complete', async (c) => {
    const body = z.object({ model: modelSchema, timezone: z.string().optional() }).parse(await c.req.json());
    if (!(await getOpenRouterKey())) return c.json({ error: "La clé OpenRouter n'est pas configurée." }, 400);
    const check = await checkModel(body.model as ModelConfig);
    if (!check.ok) return c.json({ error: check.error }, 400);
    await setSetting('models.default', body.model as ModelConfig);
    if (body.timezone) await setSetting('user.timezone', body.timezone);
    if ((await listAgentRows()).length === 0) {
      const agent = await createAgent({ named: false, permissions: { createAgents: 'ask' } });
      await log(agent.id, 'agent.created', 'Premier compagnon prêt');
    }
    await setSetting('onboarding.done', true);
    return c.json({ ok: true, warning: check.warning });
  });

  // --- Modèles -------------------------------------------------------------

  api.get('/models/openrouter', async (c) => c.json(await listOpenRouterModels()));
  api.get('/models/openrouter/endpoints', async (c) => c.json(await listOpenRouterEndpoints(c.req.query('id') ?? '')));
  api.get('/models/ollama', async (c) => {
    try {
      return c.json(await listOllamaModels(c.req.query('url') || undefined));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502);
    }
  });

  // --- Paramètres ------------------------------------------------------------

  api.get('/settings', async (c) => {
    const key = await getOpenRouterKey();
    return c.json({
      openrouterKey: key ? maskSecret(key) : null,
      defaultModel: await getDefaultModel(),
      ollamaUrl: await getSetting('ollama.url'),
      timezone: await getTimezone(),
      paused: await isPaused(),
      search: await getSearchSettings(),
      shell: await getShellSettings(),
    });
  });

  api.put('/settings', async (c) => {
    const body = z
      .object({
        openrouterKey: z.string().optional(),
        defaultModel: modelSchema.optional(),
        ollamaUrl: z.string().nullable().optional(),
        timezone: z.string().optional(),
        paused: z.boolean().optional(),
        search: z
          .object({
            provider: z.enum(['auto', 'mwmbl', 'searxng']),
            url: z.string().url().nullable().optional(),
          })
          .optional(),
        shell: z
          .object({
            mode: z.enum(['auto', 'docker', 'host', 'off']),
            approval: z.enum(['ask', 'auto', 'default']),
            image: z.string().min(1).max(200),
            network: z.boolean(),
            sudo: z.boolean(),
          })
          .partial()
          .optional(),
      })
      .parse(await c.req.json());
    if (body.search) await setSearchSettings(body.search);
    if (body.shell) {
      const next = { ...(await getShellSettings()), ...body.shell };
      await setSetting('shell.config', next);
      await log(null, 'computer.settings', `Ordinateur : mode ${next.mode}, validation ${next.approval}`);
    }
    if (body.openrouterKey) {
      const res = await validateOpenRouterKey(body.openrouterKey.trim());
      if (!res.ok) return c.json({ error: res.error }, 400);
      await setOpenRouterKey(body.openrouterKey.trim());
    }
    if (body.defaultModel) {
      const check = await checkModel(body.defaultModel as ModelConfig);
      if (!check.ok) return c.json({ error: check.error }, 400);
      await setSetting('models.default', body.defaultModel as ModelConfig);
    }
    if (body.ollamaUrl !== undefined) await setSetting('ollama.url', body.ollamaUrl?.trim() || null);
    if (body.timezone) await setSetting('user.timezone', body.timezone);
    if (body.paused !== undefined) {
      await setSetting('engine.paused', body.paused);
      await log(null, 'engine.paused', body.paused ? 'Activités autonomes suspendues' : 'Activités autonomes reprises');
    }
    return c.json({ ok: true });
  });

  // --- Ordinateur ------------------------------------------------------------

  api.get('/computer', async (c) => c.json(await computerStatus()));
  api.post('/computer/reset', async (c) => {
    await resetContainer();
    await log(null, 'computer.reset', 'Ordinateur des compagnons réinitialisé');
    return c.json(await computerStatus());
  });

  // --- Compagnons ------------------------------------------------------------

  api.get('/agents', async (c) => c.json(await listAgents()));

  api.get('/agents/:id', async (c) => {
    const agent = await getAgent(c.req.param('id'));
    return agent ? c.json(await toAgentDTO(agent)) : c.json({ error: 'Introuvable' }, 404);
  });

  api.patch('/agents/:id', async (c) => {
    const agent = await getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Introuvable' }, 404);
    const body = z
      .object({
        name: z.string().min(1).max(40).optional(),
        description: z.string().optional(),
        personality: z.string().optional(),
        instructions: z.string().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        model: modelSchema.nullable().optional(),
        permissions: z
          .object({
            web: z.boolean(),
            manageActivities: z.boolean(),
            messageAgents: z.boolean(),
            manageMemory: z.boolean(),
            mail: z.boolean(),
            connectors: z.boolean(),
            shell: z.boolean(),
            createAgents: z.enum(['allow', 'ask', 'deny']),
          })
          .partial()
          .optional(),
      })
      .parse(await c.req.json());
    if (body.model) {
      const check = await checkModel(body.model as ModelConfig);
      if (!check.ok) return c.json({ error: check.error }, 400);
    }
    const { permissions, ...rest } = body;
    const patch: Record<string, unknown> = { ...rest };
    if (rest.name) patch.named = true;
    if (permissions) patch.permissions = { ...agent.permissions, ...permissions };
    const updated = await updateAgent(agent.id, patch);
    await log(agent.id, 'agent.settings', 'Paramètres modifiés depuis l’interface', Object.keys(body));
    return c.json(await toAgentDTO(updated));
  });

  api.delete('/agents/:id', async (c) => {
    const agent = await getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Introuvable' }, 404);
    if ((await listAgentRows()).length <= 1) return c.json({ error: 'Impossible de retirer le dernier compagnon.' }, 400);
    await updateAgent(agent.id, { archived: true });
    for (const a of await listActivities(agent.id)) await updateActivity(a.id, null, { enabled: false }, await getTimezone());
    await log(agent.id, 'agent.archived', `${agent.name} a été retiré`);
    return c.json({ ok: true });
  });

  api.post('/agents/:id/read', async (c) => {
    const agent = await getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Introuvable' }, 404);
    await updateAgent(agent.id, { lastReadAt: new Date() });
    return c.json({ ok: true });
  });

  // --- Conversation ----------------------------------------------------------

  api.get('/agents/:id/messages', async (c) => {
    const agent = await getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Introuvable' }, 404);
    const conversationId = await mainConversationId(agent.id);
    const before = c.req.query('before');
    const { messages, rows } = await loadMessages(conversationId, { limit: 80, beforeSeq: before ? Number(before) : undefined });
    return c.json({ conversationId, messages, cursor: rows.length === 80 ? rows[0].seq : null, active: Boolean(getActiveStream(conversationId)) });
  });

  api.post('/agents/:id/chat', async (c) => {
    const agent = await getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Introuvable' }, 404);
    const body = (await c.req.json()) as { message?: OpenDotsUIMessage };
    const message = body.message;
    if (!message || message.role !== 'user' || !Array.isArray(message.parts) || !message.id) {
      return c.json({ error: 'Message invalide' }, 400);
    }
    // Seules les parties texte et fichiers sont acceptées depuis le client.
    const parts = message.parts.filter((p) => p.type === 'text' || p.type === 'file');
    if (!parts.length) return c.json({ error: 'Message vide' }, 400);
    const conversationId = await mainConversationId(agent.id);
    let finalParts = parts;
    const metadata: OpenDotsUIMessage['metadata'] = {};
    const answer = (message.metadata as { answer?: { requestId: string; answers: Record<string, unknown> } } | undefined)?.answer;
    if (answer?.requestId) {
      // Réponse à un formulaire : validée et résumée côté serveur.
      const req = await getRequest(answer.requestId);
      if (!req || req.agentId !== agent.id) return c.json({ error: 'Demande introuvable' }, 400);
      const { row, summary } = await answerRequest(answer.requestId, answer.answers ?? {});
      finalParts = [{ type: 'text', text: summary }];
      metadata.answer = { requestId: row.id, answers: row.answers ?? {} };
    }
    const { stream } = runTurn(agent.id, conversationId, {
      kind: 'user',
      message: { id: String(message.id).slice(0, 64), role: 'user', parts: finalParts, metadata },
    });
    return createUIMessageStreamResponse({ stream: stream.readable() });
  });

  api.get('/agents/:id/stream', async (c) => {
    const conversationId = await mainConversationId(c.req.param('id'));
    const active = getActiveStream(conversationId);
    if (!active) return c.body(null, 204);
    return createUIMessageStreamResponse({ stream: active.readable() });
  });

  api.post('/agents/:id/stop', async (c) => {
    const conversationId = await mainConversationId(c.req.param('id'));
    const active = getActiveStream(conversationId);
    active?.abort.abort();
    return c.json({ ok: true, stopped: Boolean(active) });
  });

  api.get('/conversations/:id/messages', async (c) => {
    const conv = await getConversation(c.req.param('id'));
    if (!conv) return c.json({ error: 'Introuvable' }, 404);
    const { messages } = await loadMessages(conv.id, { limit: 200, includeHidden: conv.kind === 'pair' });
    return c.json({ conversation: conv, messages, active: Boolean(getActiveStream(conv.id)) });
  });

  api.get('/team/threads', async (c) => c.json(await listTeamThreads()));

  // --- Activités ---------------------------------------------------------------

  api.get('/activities', async (c) => {
    const rows = await listActivities(c.req.query('agentId') || undefined);
    return c.json(rows.map(toActivityDTO));
  });

  const scheduleSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('once'), at: z.string() }),
    z.object({ type: z.literal('interval'), minutes: z.number().min(1) }),
    z.object({ type: z.literal('cron'), expr: z.string(), tz: z.string().optional() }),
  ]);
  const watchSchema = z.object({ url: z.string().url(), mode: z.enum(['changed', 'contains', 'not_contains', 'regex']), value: z.string().nullable().optional() });
  const filterSchema = z.object({ connectorId: z.string().nullable().optional(), from: z.string().nullable().optional(), subject: z.string().nullable().optional() });

  api.post('/activities', async (c) => {
    const body = z
      .object({
        agentId: z.string(),
        title: z.string().min(1),
        kind: z.enum(['schedule', 'watch', 'webhook', 'mail']),
        instructions: z.string().min(1),
        schedule: scheduleSchema.nullable().optional(),
        watch: watchSchema.nullable().optional(),
        filter: filterSchema.nullable().optional(),
      })
      .parse(await c.req.json());
    if (!(await getAgent(body.agentId))) return c.json({ error: 'Compagnon introuvable' }, 404);
    const row = await createActivity({ ...body, createdBy: 'user', tz: await getTimezone() });
    await log(row.agentId, 'activity.created', `Tâche créée depuis l’interface : ${row.title}`, { activityId: row.id });
    return c.json(toActivityDTO(row));
  });

  api.patch('/activities/:id', async (c) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        title: z.string().min(1).optional(),
        instructions: z.string().min(1).optional(),
        schedule: scheduleSchema.optional(),
        watch: watchSchema.optional(),
        filter: filterSchema.optional(),
      })
      .parse(await c.req.json());
    const row = await updateActivity(c.req.param('id'), null, body, await getTimezone());
    await log(row.agentId, 'activity.updated', `Activité modifiée depuis l’interface : ${row.title}`, body);
    return c.json(toActivityDTO(row));
  });

  api.delete('/activities/:id', async (c) => {
    const act = await getActivity(c.req.param('id'));
    if (!act) return c.json({ error: 'Introuvable' }, 404);
    await deleteActivity(act.id, null);
    await log(act.agentId, 'activity.deleted', `Activité supprimée : ${act.title}`);
    return c.json({ ok: true });
  });

  api.post('/activities/:id/run', async (c) => {
    const act = await getActivity(c.req.param('id'));
    if (!act) return c.json({ error: 'Introuvable' }, 404);
    if (act.kind === 'watch') return c.json(await checkWatch(act));
    await enqueue(
      'agent.wake',
      {
        agentId: act.agentId,
        event: { type: act.kind === 'webhook' ? 'webhook' : 'schedule', title: act.title, activityId: act.id },
        text: `Exécution manuelle demandée par l'utilisateur pour « ${act.title} ».\n\nTes instructions : ${act.instructions}`,
        depth: 0,
      },
      { agentId: act.agentId },
    );
    return c.json({ ok: true });
  });

  // --- Approbations ----------------------------------------------------------

  api.get('/approvals', async (c) => {
    const status = c.req.query('status') as any;
    return c.json(await listApprovals({ agentId: c.req.query('agentId') || undefined, status: status || undefined }));
  });

  api.post('/approvals/:id', async (c) => {
    const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).parse(await c.req.json());
    const row = await resolveApproval(c.req.param('id'), decision, { by: 'ui', notifyAgent: true });
    return c.json({ ok: true, status: row.status, error: row.error });
  });

  // --- Mémoire -----------------------------------------------------------------

  api.get('/agents/:id/memories', async (c) => c.json(await listMemories(c.req.param('id'))));
  api.get('/memories/shared', async (c) => c.json(await listSharedMemories()));
  api.post('/agents/:id/memories', async (c) => {
    const { content, shared } = z.object({ content: z.string().min(1), shared: z.boolean().optional() }).parse(await c.req.json());
    return c.json({ id: await remember(shared ? null : c.req.param('id'), content, 'note', 'user') });
  });
  api.patch('/memories/:id', async (c) => {
    const { content, agentId } = z.object({ content: z.string().min(1), agentId: z.string() }).parse(await c.req.json());
    return c.json({ ok: await updateMemory(c.req.param('id'), agentId, content) });
  });
  api.delete('/memories/:id', async (c) => c.json({ ok: await forget(c.req.param('id'), null) }));

  // --- Journal -----------------------------------------------------------------

  api.get('/journal', async (c) => c.json(await listJournal(c.req.query('agentId') || undefined, 150)));

  // --- Skills --------------------------------------------------------------------

  const skillSchema = z.object({ name: z.string().min(1).max(60), description: z.string().max(500), instructions: z.string().min(1) });
  api.get('/skills', async (c) => c.json((await listSkills()).map(toSkillDTO)));
  api.post('/skills', async (c) => c.json(toSkillDTO(await createSkill({ ...skillSchema.parse(await c.req.json()), createdBy: 'user' }))));
  api.patch('/skills/:id', async (c) => {
    const body = skillSchema.partial().extend({ enabled: z.boolean().optional() }).parse(await c.req.json());
    return c.json(toSkillDTO(await updateSkill(c.req.param('id'), body)));
  });
  api.delete('/skills/:id', async (c) => c.json({ ok: await deleteSkill(c.req.param('id')) }));

  // --- Connecteurs (MCP, mail) ------------------------------------------------------

  const mcpConfigSchema = z.object({
    transport: z.enum(['http', 'sse', 'stdio']),
    url: z.string().url().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
  });
  const mailConfigSchema = z.object({
    email: z.string().email(),
    displayName: z.string().optional(),
    username: z.string().min(1),
    imap: z.object({ host: z.string().min(1), port: z.number(), secure: z.boolean() }),
    smtp: z.object({ host: z.string().min(1), port: z.number(), secure: z.boolean() }),
    pollMinutes: z.number().min(1).max(1440).optional(),
  });

  /** Réveille le compagnon qui avait demandé la connexion. */
  async function notifyRequester(agentId: string | undefined, text: string) {
    if (!agentId || !(await getAgent(agentId))) return;
    await enqueue(
      'agent.wake',
      { agentId, event: { type: 'system', title: 'Nouvelle connexion' }, text: `${text}\nReprends la tâche qui nécessitait cette connexion et confirme en une ou deux phrases à l'utilisateur ce que tu vas faire.`, depth: 0 },
      { agentId },
    );
  }

  api.get('/connectors', async (c) => c.json((await listConnectors()).map(toConnectorDTO)));

  api.post('/connectors/mail/test', async (c) => {
    const body = z.object({ config: mailConfigSchema, password: z.string().optional(), connectorId: z.string().optional() }).parse(await c.req.json());
    let pass = body.password ?? '';
    if (!pass && body.connectorId) {
      const existing = await getConnector(body.connectorId);
      pass = existing ? ((await import('../connectors/repo.ts')).readSecrets(existing).password ?? '') : '';
    }
    return c.json(await testMailAccount(body.config as MailConfig, pass));
  });

  api.post('/connectors', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        kind: z.enum(['mcp', 'mail']),
        config: z.unknown(),
        secrets: z.record(z.string(), z.string()).optional(),
        approval: z.enum(['ask', 'auto']).optional(),
        requestedBy: z.string().optional(),
      })
      .parse(await c.req.json());
    if (body.kind === 'mail') {
      const config = mailConfigSchema.parse(body.config);
      if (!body.secrets?.password) return c.json({ error: 'Mot de passe requis' }, 400);
      const test = await testMailAccount(config as MailConfig, body.secrets.password);
      if (!test.ok) return c.json({ error: `Connexion impossible — IMAP : ${test.imap} · SMTP : ${test.smtp}` }, 400);
      const row = await createConnector({ name: body.name, kind: 'mail', config, secrets: { password: body.secrets.password }, approval: 'ask' });
      await updateConnector(row.id, { status: 'ok' });
      void pollAccount((await getConnector(row.id))!).catch(() => {});
      await log(null, 'connector.created', `Compte mail connecté : ${config.email}`);
      await notifyRequester(body.requestedBy, `L'utilisateur a connecté le compte mail ${config.email} (id ${row.id}).`);
      return c.json(toConnectorDTO((await getConnector(row.id))!));
    }
    const config = mcpConfigSchema.parse(body.config);
    if (config.transport === 'stdio' ? !config.command : !config.url) return c.json({ error: 'Configuration incomplète' }, 400);
    const row = await createConnector({ name: body.name, kind: 'mcp', config, secrets: body.secrets, approval: body.approval ?? 'ask' });
    const refreshed = await refreshMcpConnector(row.id);
    await log(null, 'connector.created', `Connecteur ajouté : ${row.name}`);
    if (refreshed.status === 'ok') await notifyRequester(body.requestedBy, `L'utilisateur a ajouté le connecteur MCP « ${row.name} ».`);
    return c.json(toConnectorDTO(refreshed));
  });

  api.patch('/connectors/:id', async (c) => {
    const row = await getConnector(c.req.param('id'));
    if (!row) return c.json({ error: 'Introuvable' }, 404);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        enabled: z.boolean().optional(),
        approval: z.enum(['ask', 'auto']).optional(),
        config: z.unknown().optional(),
        secrets: z.record(z.string(), z.string()).optional(),
      })
      .parse(await c.req.json());
    const patch: Parameters<typeof updateConnector>[1] = { name: body.name, enabled: body.enabled, approval: body.approval, secrets: body.secrets };
    if (body.config !== undefined) patch.config = row.kind === 'mail' ? mailConfigSchema.parse(body.config) : mcpConfigSchema.parse(body.config);
    let updated = await updateConnector(row.id, patch);
    if (row.kind === 'mcp' && (body.config !== undefined || body.secrets || body.enabled)) updated = await refreshMcpConnector(row.id);
    if (row.kind === 'mcp' && body.enabled === false) await closeMcpClient(row.id);
    return c.json(toConnectorDTO(updated));
  });

  api.post('/connectors/:id/refresh', async (c) => {
    const row = await getConnector(c.req.param('id'));
    if (!row) return c.json({ error: 'Introuvable' }, 404);
    if (row.kind === 'mcp') return c.json(toConnectorDTO(await refreshMcpConnector(row.id)));
    const count = await pollAccount(row);
    return c.json({ ...toConnectorDTO((await getConnector(row.id))!), newMessages: count });
  });

  api.delete('/connectors/:id', async (c) => {
    await closeMcpClient(c.req.param('id'));
    return c.json({ ok: await deleteConnector(c.req.param('id')) });
  });

  // --- Plugins ------------------------------------------------------------------------

  const pluginSource = z.object({ manifest: z.unknown().optional(), url: z.string().url().optional() });
  async function loadManifest(body: z.infer<typeof pluginSource>) {
    if (body.url) return fetchManifest(body.url);
    const raw = typeof body.manifest === 'string' ? JSON.parse(body.manifest) : body.manifest;
    return parseManifest(raw);
  }
  api.get('/plugins', async (c) => c.json(await listPlugins()));
  api.post('/plugins/preview', async (c) => {
    try {
      return c.json(await loadManifest(pluginSource.parse(await c.req.json())));
    } catch (err) {
      return c.json({ error: err instanceof SyntaxError ? 'JSON invalide' : errorMessage(err) }, 400);
    }
  });
  api.post('/plugins', async (c) => {
    const body = pluginSource.extend({ secrets: z.record(z.string(), z.record(z.string(), z.string())).optional() }).parse(await c.req.json());
    let manifest;
    try {
      manifest = await loadManifest(body);
    } catch (err) {
      return c.json({ error: err instanceof SyntaxError ? 'JSON invalide' : errorMessage(err) }, 400);
    }
    const id = await installPlugin(manifest, { source: body.url ?? 'manual', secrets: body.secrets });
    return c.json({ ok: true, id });
  });
  api.delete('/plugins/:id', async (c) => {
    await uninstallPlugin(c.req.param('id'));
    return c.json({ ok: true });
  });

  // --- Brouillons d'e-mails --------------------------------------------------------------

  api.get('/mail/drafts/:id', async (c) => {
    const d = await getDraft(c.req.param('id'));
    return d ? c.json(toDraftDTO(d, await getConnector(d.connectorId))) : c.json({ error: 'Introuvable' }, 404);
  });
  api.patch('/mail/drafts/:id', async (c) => {
    const body = z
      .object({ to: z.array(z.string()).optional(), cc: z.array(z.string()).optional(), subject: z.string().optional(), body: z.string().optional() })
      .parse(await c.req.json());
    const d = await updateDraft(c.req.param('id'), body);
    await log(d.agentId, 'mail.draft_edited', `Brouillon modifié par l’utilisateur : ${d.subject}`);
    return c.json(toDraftDTO(d, await getConnector(d.connectorId)));
  });

  // --- Demandes à l'utilisateur --------------------------------------------------------------

  api.get('/requests/:id', async (c) => {
    const r = await getRequest(c.req.param('id'));
    return r ? c.json(toRequestDTO(r)) : c.json({ error: 'Introuvable' }, 404);
  });

  // --- Temps réel ----------------------------------------------------------------

  api.get('/events', (c) =>
    streamSSE(c, async (sse) => {
      let open = true;
      const unsubscribe = subscribe((event) => {
        if (open) void sse.writeSSE({ data: JSON.stringify(event) }).catch(() => (open = false));
      });
      sse.onAbort(() => {
        open = false;
        unsubscribe();
      });
      await sse.writeSSE({ data: JSON.stringify({ type: 'hello' }) });
      while (open) {
        await sse.sleep(20_000);
        if (open) await sse.writeSSE({ event: 'ping', data: '{}' }).catch(() => (open = false));
      }
      unsubscribe();
    }),
  );

  // --- Webhooks entrants (publics, protégés par un jeton secret) ---------------

  api.post('/hooks/:token', async (c) => {
    const act = await findActivityByWebhook(c.req.param('token'));
    if (!act) return c.json({ error: 'Introuvable' }, 404);
    const raw = await c.req.text();
    if (raw.length > 200_000) return c.json({ error: 'Contenu trop volumineux' }, 413);
    let payload: unknown = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // texte brut
    }
    const res = await ingestWebhook(act, payload, c.req.header('x-event-id') ?? c.req.header('x-github-delivery'));
    return c.json(res, res.accepted ? 202 : 200);
  });

  return api;
}
