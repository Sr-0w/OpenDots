import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { IntegrationConfig, IntegrationProvider } from '@opendots/shared';
import { ConnectorError, getConnector, updateConnector, type ConnectorRow } from '../connectors/repo.ts';
import { oauth, type OAuthManager } from './oauth.ts';
import { htmlToText } from '../tools/web.ts';

const id = z.string().min(1).max(512).refine((s) => s !== '.' && s !== '..' && !/[\r\n]/.test(s));
const limit = z.number().int().min(1).max(25).default(10);
const mail = z.object({ to: z.array(z.string().email()).min(1).max(30), subject: z.string().max(300).refine((s) => !/[\r\n]/.test(s)), body: z.string().min(1).max(200_000) }).strict();
const event = z.object({ calendar_id: id.optional(), title: z.string().min(1).max(300), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), description: z.string().max(10_000).optional(), attendees: z.array(z.string().email()).max(30).optional() }).strict().refine((v) => Date.parse(v.end) > Date.parse(v.start), 'La fin doit être après le début.');
const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).refine((s) => s.split('/').every((v) => v !== '.' && v !== '..'));
export interface Operation { id: string; provider: IntegrationProvider; permission: string; name: string; write: boolean; mail: boolean; schema: z.ZodType<any> }
const op = (provider: IntegrationProvider, id: string, permission: string, name: string, schema: z.ZodType<any>, write = false, isMail = false): Operation => ({ provider, id, permission, name, schema, write, mail: isMail });
export const OPERATIONS: Operation[] = [
  op('google-drive', 'drive_search', 'read', 'Rechercher des fichiers Drive', z.object({ query: z.string().max(500).default(''), limit, page_token: z.string().max(2000).optional() }).strict()),
  op('google-drive', 'drive_read', 'read', 'Lire un fichier Drive', z.object({ file_id: id }).strict()),
  op('google-drive', 'drive_create', 'create', 'Créer un fichier texte Drive', z.object({ name: z.string().min(1).max(200), content: z.string().max(200_000), folder_id: id.optional() }).strict(), true),
  op('google-calendar', 'calendar_list', 'read', 'Lister les agendas Google', z.object({}).strict()),
  op('google-calendar', 'calendar_events', 'read', 'Consulter les événements Google', z.object({ calendar_id: id.default('primary'), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), limit }).strict()),
  op('google-calendar', 'calendar_create', 'create', 'Créer un événement Google', event, true),
  op('gmail', 'gmail_search', 'read', 'Rechercher des e-mails Gmail', z.object({ query: z.string().max(1000).default('in:inbox'), limit }).strict(), false, true),
  op('gmail', 'gmail_read', 'read', 'Lire un e-mail Gmail', z.object({ message_id: id }).strict(), false, true),
  op('gmail', 'gmail_labels', 'read', 'Lister les libellés Gmail', z.object({}).strict(), false, true),
  op('gmail', 'gmail_draft', 'send', 'Créer un brouillon Gmail', mail, true, true),
  op('gmail', 'gmail_send', 'send', 'Envoyer un e-mail Gmail', mail, true, true),
  op('gmail', 'gmail_label_create', 'labels', 'Créer un libellé Gmail', z.object({ name: z.string().min(1).max(200) }).strict(), true, true),
  op('outlook', 'outlook_search', 'read', 'Rechercher des e-mails Outlook', z.object({ query: z.string().max(500).default(''), limit }).strict(), false, true),
  op('outlook', 'outlook_read', 'read', 'Lire un e-mail Outlook', z.object({ message_id: id }).strict(), false, true),
  op('outlook', 'outlook_send', 'send', 'Envoyer un e-mail Outlook', mail, true, true),
  op('outlook', 'outlook_draft', 'draft', 'Créer un brouillon Outlook', mail, true, true),
  op('outlook', 'outlook_calendars', 'calendar_read', 'Lister les agendas Outlook', z.object({}).strict()),
  op('outlook', 'outlook_events', 'calendar_read', 'Consulter les événements Outlook', z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), limit }).strict()),
  op('outlook', 'outlook_event_create', 'calendar_create', 'Créer un événement Outlook', event, true),
  op('github', 'github_repos', 'read', 'Lister les dépôts GitHub', z.object({ limit }).strict()),
  op('github', 'github_search', 'read', 'Rechercher des issues et pull requests', z.object({ query: z.string().min(1).max(1000), limit }).strict()),
  op('github', 'github_issue', 'read', 'Lire une issue ou pull request GitHub', z.object({ repo, number: z.number().int().positive() }).strict()),
  op('github', 'github_pulls', 'read', 'Lister les pull requests GitHub', z.object({ repo, state: z.enum(['open', 'closed', 'all']).default('open'), limit }).strict()),
  op('github', 'github_issue_create', 'write', 'Créer une issue GitHub', z.object({ repo, title: z.string().min(1).max(200), body: z.string().max(50_000) }).strict(), true),
  op('github', 'github_comment', 'write', 'Publier un commentaire GitHub', z.object({ repo, number: z.number().int().positive(), body: z.string().min(1).max(50_000) }).strict(), true),
];
export function availableOperations(config: IntegrationConfig) { return OPERATIONS.filter((o) => o.provider === config.provider && (config.permissions.includes(o.permission) || config.provider === 'github' && o.permission === 'read' && config.permissions.includes('private'))); }
export function operationFor(row: ConnectorRow, operation: string) {
  if (row.kind !== 'integration' || !row.enabled) throw new ConnectorError('Connexion indisponible.');
  const found = availableOperations(row.config as IntegrationConfig).find((o) => o.id === operation);
  if (!found) throw new ConnectorError('Opération non autorisée pour cette connexion.');
  return found;
}
const encode = encodeURIComponent;
const query = (base: string, args: Record<string, string | number | undefined>) => {
  const url = new URL(base); for (const [key, value] of Object.entries(args)) if (value !== undefined) url.searchParams.set(key, String(value)); return url.href;
};
function gmailText(payload: any): string {
  const parts = payload?.parts?.length ? payload.parts : [payload];
  const text = parts.flatMap((p: any) => p.parts?.length ? [gmailText(p)] : p.body?.data && ['text/plain', 'text/html'].includes(p.mimeType) ? [p.mimeType === 'text/html' ? htmlToText(Buffer.from(p.body.data, 'base64url').toString()).text : Buffer.from(p.body.data, 'base64url').toString()] : []);
  return text.join('\n').slice(0, 30_000);
}
function gmailMessage(value: any, full = false) {
  const header = (name: string) => value.payload?.headers?.find((h: any) => h.name?.toLowerCase() === name)?.value ?? '';
  return { id: value.id, threadId: value.threadId, subject: header('subject'), from: header('from'), to: header('to'), date: header('date'), snippet: value.snippet, ...(full ? { untrusted_content: gmailText(value.payload) } : {}) };
}

export class IntegrationExecutor {
  constructor(private manager: OAuthManager = oauth, private transport: typeof fetch = (...args) => fetch(...args)) {}
  private async request(row: ConnectorRow, url: string, method = 'GET', body?: unknown, contentType = 'application/json') {
    const expected = row.config.provider === 'outlook' ? 'https://graph.microsoft.com' : row.config.provider === 'github' ? 'https://api.github.com' : 'https://www.googleapis.com';
    if (new URL(url).origin !== expected) throw new ConnectorError('Destination du connecteur invalide.');
    const token = await this.manager.accessToken(row);
    const response = await this.transport(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': contentType } : {}), ...(row.config.provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      if (response.status === 401) await updateConnector(row.id, { status: 'error', lastError: 'La connexion a été refusée. Reconnecte ce compte.' });
      throw new ConnectorError(`Le service a refusé l’opération (${response.status}). ${response.status === 403 ? 'Vérifie les permissions accordées.' : response.status === 429 ? 'Réessaie plus tard : limite du fournisseur.' : ''}`);
    }
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body?.getReader();
    if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_000_000) { await reader.cancel(); throw new ConnectorError('Réponse trop volumineuse : affine la demande.'); } chunks.push(part.value); }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? /json/i.test(response.headers.get('content-type') ?? '') ? JSON.parse(text) : text : { accepted: true };
  }
  async execute(connectorId: string, operationId: string, args: unknown): Promise<any> {
    const row = await getConnector(connectorId);
    if (!row) throw new ConnectorError('Connexion introuvable.');
    const operation = operationFor(row, operationId), a = operation.schema.parse(args);
    const get = (url: string) => this.request(row, url), post = (url: string, body: unknown) => this.request(row, url, 'POST', body);
    const drive = 'https://www.googleapis.com/drive/v3', calendar = 'https://www.googleapis.com/calendar/v3', gmail = 'https://www.googleapis.com/gmail/v1/users/me', graph = 'https://graph.microsoft.com/v1.0/me', github = 'https://api.github.com';
    switch (operationId) {
      case 'drive_search': return get(query(`${drive}/files`, { q: `trashed = false${a.query ? ` and name contains '${a.query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : ''}`, fields: 'files(id,name,mimeType,webViewLink,modifiedTime),nextPageToken', pageSize: a.limit, pageToken: a.page_token }));
      case 'drive_read': {
        const file = await get(query(`${drive}/files/${encode(a.file_id)}`, { fields: 'id,name,mimeType,size,webViewLink' }));
        const exports: Record<string, string> = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv', 'application/vnd.google-apps.presentation': 'text/plain' };
        let text: unknown;
        if (exports[file.mimeType]) text = await get(query(`${drive}/files/${encode(a.file_id)}/export`, { mimeType: exports[file.mimeType] }));
        else if (/^text\/|application\/(json|xml)/.test(file.mimeType)) text = await get(query(`${drive}/files/${encode(a.file_id)}`, { alt: 'media' }));
        return { ...file, ...(text !== undefined ? { untrusted_content: (typeof text === 'string' ? text : JSON.stringify(text)).slice(0, 30_000) } : { notice: 'Métadonnées uniquement : ce format binaire ne peut pas être lu comme du texte.' }) };
      }
      case 'drive_create': {
        const boundary = `opendots_${randomBytes(16).toString('hex')}`;
        const metadata = { name: a.name, mimeType: 'text/plain', ...(a.folder_id ? { parents: [a.folder_id] } : {}) };
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${a.content}\r\n--${boundary}--\r\n`;
        return this.request(row, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', 'POST', body, `multipart/related; boundary=${boundary}`);
      }
      case 'calendar_list': return get(`${calendar}/users/me/calendarList`);
      case 'calendar_events': return get(query(`${calendar}/calendars/${encode(a.calendar_id)}/events`, { timeMin: a.start, timeMax: a.end, singleEvents: 'true', orderBy: 'startTime', maxResults: a.limit }));
      case 'calendar_create': return post(`${calendar}/calendars/${encode(a.calendar_id ?? 'primary')}/events?sendUpdates=all`, { summary: a.title, description: a.description, start: { dateTime: a.start }, end: { dateTime: a.end }, attendees: a.attendees?.map((email: string) => ({ email })) });
      case 'gmail_search': {
        const found = await get(query(`${gmail}/messages`, { q: a.query, maxResults: a.limit }));
        const messages = await Promise.all((found.messages ?? []).map(async (m: any) => gmailMessage(await get(`${gmail}/messages/${encode(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`))));
        return { messages, nextPageToken: found.nextPageToken };
      }
      case 'gmail_read': return gmailMessage(await get(`${gmail}/messages/${encode(a.message_id)}?format=full`), true);
      case 'gmail_labels': return get(`${gmail}/labels`);
      case 'gmail_label_create': return post(`${gmail}/labels`, { name: a.name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
      case 'gmail_draft': case 'gmail_send': {
        const raw = Buffer.from(`To: ${a.to.join(', ')}\r\nSubject: =?UTF-8?B?${Buffer.from(a.subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(a.body).toString('base64').match(/.{1,76}/g)?.join('\r\n')}\r\n`).toString('base64url');
        return post(`${gmail}/${operationId === 'gmail_send' ? 'messages/send' : 'drafts'}`, operationId === 'gmail_send' ? { raw } : { message: { raw } });
      }
      case 'outlook_search': return get(query(`${graph}/messages`, { '$top': a.limit, '$select': 'id,subject,from,receivedDateTime,isRead,bodyPreview,webLink', ...(a.query ? { '$search': `"${a.query.replace(/["\\]/g, '\\$&')}"` } : { '$orderby': 'receivedDateTime desc' }) }));
      case 'outlook_read': {
        const result = await get(`${graph}/messages/${encode(a.message_id)}?$select=id,subject,from,toRecipients,receivedDateTime,body,webLink`);
        const { body, ...rest } = result;
        return { ...rest, untrusted_content: (body?.contentType?.toLowerCase() === 'html' ? htmlToText(body.content).text : body?.content ?? '').slice(0, 30_000) };
      }
      case 'outlook_send': case 'outlook_draft': {
        const message = { subject: a.subject, body: { contentType: 'Text', content: a.body }, toRecipients: a.to.map((address: string) => ({ emailAddress: { address } })) };
        return post(`${graph}/${operationId === 'outlook_send' ? 'sendMail' : 'messages'}`, operationId === 'outlook_send' ? { message, saveToSentItems: true } : message);
      }
      case 'outlook_calendars': return get(`${graph}/calendars?$select=id,name,owner,canEdit`);
      case 'outlook_events': return get(query(`${graph}/calendarView`, { startDateTime: a.start, endDateTime: a.end, '$top': a.limit, '$select': 'id,subject,start,end,organizer,location,webLink' }));
      case 'outlook_event_create': return post(a.calendar_id ? `${graph}/calendars/${encode(a.calendar_id)}/events` : `${graph}/events`, { subject: a.title, body: { contentType: 'Text', content: a.description ?? '' }, start: { dateTime: new Date(a.start).toISOString().slice(0, -1), timeZone: 'UTC' }, end: { dateTime: new Date(a.end).toISOString().slice(0, -1), timeZone: 'UTC' }, attendees: a.attendees?.map((address: string) => ({ emailAddress: { address }, type: 'required' })) });
      case 'github_repos': return get(query(`${github}/user/repos`, { per_page: a.limit, sort: 'updated' }));
      case 'github_search': return get(query(`${github}/search/issues`, { q: a.query, per_page: a.limit }));
      case 'github_issue': return get(`${github}/repos/${a.repo.split('/').map(encode).join('/')}/issues/${a.number}`);
      case 'github_pulls': return get(query(`${github}/repos/${a.repo.split('/').map(encode).join('/')}/pulls`, { state: a.state, per_page: a.limit }));
      case 'github_issue_create': return post(`${github}/repos/${a.repo.split('/').map(encode).join('/')}/issues`, { title: a.title, body: a.body });
      case 'github_comment': return post(`${github}/repos/${a.repo.split('/').map(encode).join('/')}/issues/${a.number}/comments`, { body: a.body });
      default: throw new ConnectorError('Opération inconnue.');
    }
  }
}
export const integrations = new IntegrationExecutor();
