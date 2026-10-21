import type { IntegrationCatalogEntry, IntegrationProvider, OAuthProvider } from '@opendots/shared';
import { ConnectorError } from '../connectors/repo.ts';

const google = 'https://www.googleapis.com/auth/';
export const CATALOG: IntegrationCatalogEntry[] = [
  { id: 'google-drive', name: 'Google Drive', category: 'files', oauth: 'google', description: 'Rechercher et lire tes fichiers, créer des documents texte.', permissions: [
    { id: 'read', label: 'Rechercher et lire les fichiers', description: 'Accès en lecture à tes fichiers Drive, y compris les documents Google.', scopes: [google + 'drive.readonly'], default: true },
    { id: 'create', label: 'Créer des fichiers', description: 'Créer des fichiers avec OpenDots. Chaque création attend ta validation.', scopes: [google + 'drive.file'], default: false },
  ] },
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', oauth: 'google', description: 'Consulter tes agendas et préparer de nouveaux événements.', permissions: [
    { id: 'read', label: 'Consulter les agendas et événements', description: 'Lire les agendas accessibles et leurs événements.', scopes: [google + 'calendar.readonly'], default: true },
    { id: 'create', label: 'Créer des événements', description: 'Créer un rendez-vous et inviter des personnes après ta validation.', scopes: [google + 'calendar.events'], default: false },
  ] },
  { id: 'gmail', name: 'Gmail', category: 'mail', oauth: 'google', description: 'Rechercher et lire des messages, préparer des brouillons et envoyer après validation.', permissions: [
    { id: 'read', label: 'Rechercher et lire les e-mails', description: 'Lire les messages et leurs libellés.', scopes: [google + 'gmail.readonly'], default: true },
    { id: 'send', label: 'Créer des brouillons et envoyer des e-mails', description: 'Les brouillons et envois attendent ta validation dans OpenDots.', scopes: [google + 'gmail.compose'], default: false },
    { id: 'labels', label: 'Créer des libellés', description: 'Créer de nouveaux libellés après validation.', scopes: [google + 'gmail.labels'], default: false },
  ] },
  { id: 'outlook', name: 'Outlook / Microsoft 365', category: 'mail', oauth: 'microsoft', description: 'Connecter une boîte Microsoft et ses agendas via Microsoft Graph.', permissions: [
    { id: 'read', label: 'Rechercher et lire les e-mails', description: 'Lire les messages de ta boîte Outlook.', scopes: ['Mail.Read'], default: true },
    { id: 'send', label: 'Envoyer des e-mails', description: 'Les envois attendent toujours ta validation.', scopes: ['Mail.Send'], default: false },
    { id: 'draft', label: 'Créer des brouillons', description: 'Microsoft demande aussi la permission de modifier les messages ; OpenDots expose seulement la création de brouillons.', scopes: ['Mail.ReadWrite'], default: false },
    { id: 'calendar_read', label: 'Consulter les agendas', description: 'Lire les agendas et les rendez-vous.', scopes: ['Calendars.Read'], default: false },
    { id: 'calendar_create', label: 'Créer des événements', description: 'Microsoft accorde aussi la modification ; OpenDots expose seulement la création avec validation.', scopes: ['Calendars.ReadWrite'], default: false },
  ] },
  { id: 'github', name: 'GitHub', category: 'development', oauth: 'github', description: 'Parcourir les dépôts, issues et pull requests ; préparer des issues et commentaires.', permissions: [
    { id: 'read', label: 'Lire les dépôts publics, issues et pull requests', description: 'Accéder à ton identité GitHub et aux dépôts publics.', scopes: ['read:user'], default: true },
    { id: 'private', label: 'Accéder aux dépôts privés', description: 'Le scope GitHub repo inclut aussi l’écriture. OpenDots ne publie rien sans validation.', scopes: ['repo'], default: false },
    { id: 'write', label: 'Créer des issues et commentaires', description: 'Le scope public_repo inclut l’écriture sur les dépôts publics. Chaque publication attend ta validation.', scopes: ['public_repo'], default: false },
  ] },
  { id: 'imap-smtp', name: 'IMAP / SMTP', category: 'mail', oauth: null, description: 'Boîte mail standard : lecture IMAP, relève automatique et envoi SMTP après validation.', permissions: [] },
];

export function integrationSpec(id: string) {
  const spec = CATALOG.find((s) => s.id === id && s.oauth);
  if (!spec) throw new ConnectorError('Intégration inconnue.');
  return spec as IntegrationCatalogEntry & { id: IntegrationProvider; oauth: OAuthProvider };
}

export function selectedScopes(id: string, permissions: string[]) {
  const spec = integrationSpec(id);
  if (!permissions.length || permissions.some((p) => !spec.permissions.some((v) => v.id === p))) throw new ConnectorError('Choisis au moins une permission valide.');
  const base = spec.oauth === 'google' ? ['openid', 'email'] : spec.oauth === 'microsoft' ? ['openid', 'email', 'offline_access', 'User.Read'] : ['read:user'];
  return [...new Set([...base, ...spec.permissions.filter((p) => permissions.includes(p.id)).flatMap((p) => p.scopes)])];
}

export function hasGrantedScopes(required: string[], granted: string[]) {
  const normalized = new Set(granted.map((s) => s.replace(/^https:\/\/graph.microsoft.com\//i, '').toLowerCase()));
  // Providers collapse narrower grants into their encompassing scope.
  const implies: Record<string, string[]> = {
    repo: ['public_repo'], user: ['read:user', 'user:email', 'user:follow'],
    'mail.readwrite': ['mail.read'], 'calendars.readwrite': ['calendars.read'],
    [google + 'drive']: [google + 'drive.readonly', google + 'drive.file'],
    [google + 'calendar']: [google + 'calendar.readonly', google + 'calendar.events'],
    [google + 'gmail.modify']: [google + 'gmail.readonly', google + 'gmail.compose', google + 'gmail.labels'],
  };
  for (const scope of [...normalized]) for (const child of implies[scope] ?? []) normalized.add(child);
  return required.every((s) => normalized.has(s.toLowerCase()));
}
