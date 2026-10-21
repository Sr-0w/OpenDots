import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IntegrationConfig, IntegrationProvider, OAuthAppDTO, OAuthProvider } from '@opendots/shared';
import { getAgent } from '../agents/repo.ts';
import { authStore } from '../auth/store.ts';
import { accountKey, currentAccount, withAccount } from '../auth/context.ts';
import { decryptSecret, encryptSecret } from '../secrets.ts';
import { ConnectorError, createConnector, getConnector, listConnectors, readSecrets, replaceConnectorSecrets, updateConnector, type ConnectorRow } from '../connectors/repo.ts';
import { hasGrantedScopes, integrationSpec, selectedScopes } from './catalog.ts';

const ENDPOINTS = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', identity: 'https://openidconnect.googleapis.com/v1/userinfo' },
  microsoft: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', identity: 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName' },
  github: { authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', identity: 'https://api.github.com/user' },
} satisfies Record<OAuthProvider, { authorize: string; token: string; identity: string }>;
type Client = { clientId: string; clientSecret: string };
type Pending = { owner: string; provider: IntegrationProvider; permissions: string[]; scopes: string[]; client: Client; verifier: string; cookie: string; redirect: string; origin: string; expires: number; connectorId?: string; requestedBy?: string };
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const splitScopes = (s: string) => s.split(/[\s,]+/).filter(Boolean);

export async function oauthClient(provider: OAuthProvider): Promise<Client> {
  const prefix = `OPENDOTS_${provider.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  if (clientId) return { clientId, clientSecret: process.env[`${prefix}_CLIENT_SECRET`] ?? '' };
  const result = await (await authStore()).query<{ value: string }>('SELECT value FROM instance_settings WHERE key=$1', [`oauth:${provider}`]);
  return result.rows[0] ? withAccount(undefined, () => JSON.parse(decryptSecret(result.rows[0].value))) : { clientId: '', clientSecret: '' };
}
export async function oauthApps(origin: string): Promise<OAuthAppDTO[]> {
  return Promise.all((Object.keys(ENDPOINTS) as OAuthProvider[]).map(async (provider) => {
    const client = await oauthClient(provider);
    return { provider, configured: Boolean(client.clientId && client.clientSecret), clientId: currentAccount()?.role === 'admin' ? client.clientId : '', hasSecret: Boolean(client.clientSecret), source: process.env[`OPENDOTS_${provider.toUpperCase()}_CLIENT_ID`] ? 'environment' : 'local', callbackUrl: `${origin}/api/integrations/oauth/callback/${provider}` };
  }));
}
export async function saveOAuthApp(provider: OAuthProvider, input: { clientId: string; clientSecret?: string }) {
  if (currentAccount()?.role !== 'admin') throw new ConnectorError('Configuration réservée à l’administrateur.');
  if (process.env[`OPENDOTS_${provider.toUpperCase()}_CLIENT_ID`]) throw new ConnectorError('Cette application est configurée par les variables du déploiement.');
  const previous = await oauthClient(provider);
  const client = { clientId: input.clientId.trim(), clientSecret: input.clientSecret || (previous.clientId === input.clientId.trim() ? previous.clientSecret : '') };
  if (!client.clientId || !client.clientSecret) throw new ConnectorError('Client ID et secret de l’application requis.');
  const encrypted = withAccount(undefined, () => encryptSecret(JSON.stringify(client)));
  await (await authStore()).query('INSERT INTO instance_settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [`oauth:${provider}`, encrypted]);
}

export class OAuthManager {
  private pending = new Map<string, Pending>();
  private refreshing = new Map<string, Promise<string>>();
  constructor(private transport: typeof fetch = (...args) => fetch(...args), private now = () => Date.now()) {}

  async begin(provider: IntegrationProvider, permissions: string[], origin: string, connectorId?: string, requestedBy?: string) {
    const urlOrigin = new URL(origin);
    if (urlOrigin.origin !== origin || (urlOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(urlOrigin.hostname))) throw new ConnectorError('OAuth nécessite HTTPS, sauf sur localhost.');
    const spec = integrationSpec(provider);
    const scopes = selectedScopes(provider, permissions);
    const client = await oauthClient(spec.oauth);
    if (!client.clientId || !client.clientSecret) throw new ConnectorError('L’administrateur doit d’abord configurer cette application OAuth. Tu n’as pas à créer ta propre application.');
    if (requestedBy && !(await getAgent(requestedBy))) throw new ConnectorError('Compagnon introuvable.');
    if (connectorId) {
      const existing = await getConnector(connectorId);
      if (!existing || existing.kind !== 'integration' || existing.config.provider !== provider) throw new ConnectorError('Connexion introuvable.');
    }
    for (const [key, entry] of this.pending) if (entry.expires <= this.now()) this.pending.delete(key);
    if (this.pending.size >= 100) throw new ConnectorError('Trop de connexions en cours. Réessaie plus tard.');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url'), cookie = randomBytes(32).toString('base64url');
    const redirect = `${origin}/api/integrations/oauth/callback/${spec.oauth}`;
    this.pending.set(hash(state), { owner: accountKey(), provider, permissions: [...new Set(permissions)], scopes, client, verifier, cookie: hash(cookie), redirect, origin, expires: this.now() + 600_000, connectorId, requestedBy });
    const url = new URL(ENDPOINTS[spec.oauth].authorize);
    for (const [k, v] of Object.entries({ client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), state, code_challenge: hash(verifier), code_challenge_method: 'S256' })) url.searchParams.set(k, v);
    if (spec.oauth === 'google') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
    if (spec.oauth === 'microsoft') url.searchParams.set('prompt', 'select_account');
    return { url: url.href, cookie, cookieName: `od_oauth_${hash(state).slice(0, 16)}`, expiresAt: this.now() + 600_000 };
  }

  async complete(provider: OAuthProvider, input: { state: string; cookie?: string; code?: string; error?: string }) {
    const key = hash(input.state), entry = this.pending.get(key);
    if (!entry || entry.expires <= this.now() || entry.owner !== accountKey() || integrationSpec(entry.provider).oauth !== provider) throw new ConnectorError('Connexion expirée ou état OAuth invalide. Recommence la connexion.');
    const actual = Buffer.from(hash(input.cookie ?? '')), expected = Buffer.from(entry.cookie);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ConnectorError('Cette connexion doit être terminée dans le navigateur qui l’a commencée.');
    this.pending.delete(key); // one-time, including denied consent
    if (input.error || !input.code) throw new ConnectorError('Autorisation refusée ou annulée. Aucun compte n’a été connecté.');
    const tokens = await this.token(provider, new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: entry.redirect, client_id: entry.client.clientId, client_secret: entry.client.clientSecret, code_verifier: entry.verifier }));
    const granted = tokens.scope ? splitScopes(tokens.scope) : entry.scopes;
    const spec = integrationSpec(entry.provider);
    if (spec.permissions.filter((p) => entry.permissions.includes(p.id)).some((p) => !hasGrantedScopes(p.scopes, granted))) throw new ConnectorError('Les permissions demandées n’ont pas toutes été accordées. Reconnecte ce service avec les permissions choisies.');
    const account = await this.identity(provider, tokens.access_token);
    let row = entry.connectorId ? await getConnector(entry.connectorId) : (await listConnectors('integration')).find((r) => r.config.provider === entry.provider && r.config.account?.id === account.id);
    if (entry.connectorId && (!row || row.config.account?.id !== account.id)) throw new ConnectorError('Le compte choisi ne correspond pas à la connexion à renouveler. Ajoute-le comme nouvelle connexion.');
    const old = row ? readSecrets(row) : {};
    const config: IntegrationConfig = { provider: entry.provider, account, permissions: entry.permissions, grantedScopes: granted };
    if (!row) row = await createConnector({ name: `${spec.name} — ${account.email ?? account.label}`, kind: 'integration', config, approval: 'ask' });
    await replaceConnectorSecrets(row.id, { access_token: tokens.access_token, ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : old.client_id === entry.client.clientId && old.refresh_token ? { refresh_token: old.refresh_token } : {}), client_id: entry.client.clientId, expires_at: String(tokens.expires_in ? this.now() + tokens.expires_in * 1000 : 0) });
    await updateConnector(row.id, { config, enabled: true, status: 'ok', lastError: null, approval: 'ask' });
    return { connector: (await getConnector(row.id))!, origin: entry.origin, requestedBy: entry.requestedBy };
  }

  async identity(provider: OAuthProvider, token: string) {
    const response = await this.transport(ENDPOINTS[provider].identity, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new ConnectorError(`Le fournisseur n’a pas pu vérifier ce compte (${response.status}).`);
    const value = await response.json() as Record<string, any>;
    const id = provider === 'google' ? value.sub : value.id;
    if (!id) throw new ConnectorError('Identité du compte absente.');
    const email = provider === 'google' ? value.email : provider === 'microsoft' ? value.mail || value.userPrincipalName : value.email;
    return { id: String(id), label: String(value.name || value.displayName || value.login || email || id), ...(email ? { email: String(email) } : {}) };
  }

  private async token(provider: OAuthProvider, body: URLSearchParams) {
    const response = await this.transport(ENDPOINTS[provider].token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new ConnectorError(`Le fournisseur a refusé l’authentification (${response.status}). Reconnecte le compte.`);
    const value = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; token_type?: string };
    if (value.error || typeof value.access_token !== 'string' || !value.access_token || (value.refresh_token !== undefined && typeof value.refresh_token !== 'string') || (value.scope !== undefined && typeof value.scope !== 'string') || (value.expires_in !== undefined && (typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0)) || (value.token_type !== undefined && (typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer'))) throw new ConnectorError('Le fournisseur n’a pas délivré de jeton utilisable.');
    return { ...value, access_token: value.access_token };
  }

  async accessToken(row: ConnectorRow): Promise<string> {
    const key = `${accountKey()}:${row.id}`;
    if (this.refreshing.has(key)) return this.refreshing.get(key)!;
    const pending = (async () => {
      const current = await getConnector(row.id);
      if (!current || current.kind !== 'integration' || !current.enabled) throw new ConnectorError('Connexion désactivée ou supprimée.');
      const secret = readSecrets(current);
      if (secret.access_token && (!Number(secret.expires_at) || Number(secret.expires_at) > this.now() + 60_000)) return secret.access_token;
      if (!secret.refresh_token) throw new ConnectorError('La connexion a expiré. Reconnecte ce compte.');
      const spec = integrationSpec(current.config.provider);
      const client = await oauthClient(spec.oauth);
      if (client.clientId !== secret.client_id || !client.clientSecret) throw new ConnectorError('L’application OAuth a changé. Reconnecte ce compte.');
      const token = await this.token(spec.oauth, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: secret.refresh_token, client_id: client.clientId, client_secret: client.clientSecret }));
      if (token.scope && spec.permissions.filter((p) => current.config.permissions.includes(p.id)).some((p) => !hasGrantedScopes(p.scopes, splitScopes(token.scope!)))) throw new ConnectorError('Les permissions ont changé. Reconnecte ce compte.');
      await replaceConnectorSecrets(current.id, { ...secret, access_token: token.access_token, refresh_token: token.refresh_token ?? secret.refresh_token, expires_at: String(token.expires_in ? this.now() + token.expires_in * 1000 : 0) });
      return token.access_token;
    })();
    this.refreshing.set(key, pending);
    try { return await pending; }
    catch (error) { await updateConnector(row.id, { status: 'error', lastError: 'Réauthentification nécessaire. Reconnecte ce compte.' }); throw error; }
    finally { this.refreshing.delete(key); }
  }

  async revoke(row: ConnectorRow): Promise<string | null> {
    const provider = integrationSpec(row.config.provider).oauth, secret = readSecrets(row);
    if (provider === 'microsoft') return 'Connexion supprimée dans OpenDots. Pour retirer aussi le consentement Microsoft, ouvre les applications autorisées de ton compte Microsoft.';
    try {
      let response: Response;
      if (provider === 'google') response = await this.transport('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: secret.refresh_token ?? secret.access_token }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
      else {
        const client = await oauthClient('github');
        if (client.clientId !== secret.client_id) return 'Application OAuth modifiée : retire aussi l’autorisation dans GitHub → Applications.';
        response = await this.transport(`https://api.github.com/applications/${encodeURIComponent(client.clientId)}/grant`, { method: 'DELETE', headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' }, body: JSON.stringify({ access_token: secret.access_token }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
      }
      return response.ok || response.status === 404 ? null : 'La révocation distante a échoué. Retire aussi l’accès dans les applications autorisées du fournisseur.';
    } catch { return 'Fournisseur indisponible : retire aussi l’accès dans ses applications autorisées.'; }
  }
}
export const oauth = new OAuthManager();
export const oauthCookieName = (state: string) => `od_oauth_${hash(state).slice(0, 16)}`;
