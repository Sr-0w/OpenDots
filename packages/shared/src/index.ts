// Contrats partagés entre le backend et le frontend d'OpenDots.

export type AgentState =
  | 'available'
  | 'sleeping'
  | 'awake'
  | 'thinking'
  | 'working'
  | 'collaborating'
  | 'waiting'
  | 'done'
  | 'error';

export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  available: 'Disponible',
  sleeping: 'En veille',
  awake: 'Réveillé',
  thinking: 'En réflexion',
  working: 'Au travail',
  collaborating: 'En collaboration',
  waiting: 'En attente',
  done: 'Terminé',
  error: 'En erreur',
};

export type ModelProvider = 'openrouter' | 'ollama';
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  reasoning?: ReasoningEffort | null;
  /** Fournisseurs OpenRouter préférés, dans l'ordre (ex. ["Cerebras"]). */
  providerOrder?: string[] | null;
}

export type CreateAgentsPolicy = 'allow' | 'ask' | 'deny';

export interface AgentPermissions {
  /** Lire des pages web publiques. */
  web: boolean;
  /** Créer / modifier ses propres activités (planifications, surveillances). */
  manageActivities: boolean;
  /** Échanger avec les autres compagnons. */
  messageAgents: boolean;
  /** Créer de nouveaux compagnons. */
  createAgents: CreateAgentsPolicy;
  /** Gérer sa mémoire. */
  manageMemory: boolean;
  /** Lire les e-mails des comptes connectés (l'envoi demande toujours une validation). */
  mail: boolean;
  /** Utiliser les connecteurs MCP. */
  connectors: boolean;
  /** Exécuter des commandes sur l'ordinateur des compagnons. */
  shell: boolean;
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  web: true,
  manageActivities: true,
  messageAgents: true,
  createAgents: 'ask',
  manageMemory: true,
  mail: true,
  connectors: true,
  shell: true,
};

export interface AgentDTO {
  id: string;
  name: string;
  named: boolean;
  color: string;
  description: string;
  personality: string;
  instructions: string;
  model: ModelConfig | null;
  effectiveModel: ModelConfig;
  permissions: AgentPermissions;
  state: AgentState;
  stateDetail: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  mainConversationId: string;
  archived: boolean;
}

export type ActivityKind = 'schedule' | 'watch' | 'webhook' | 'mail';

/** Filtre d'une activité déclenchée par la réception d'un e-mail. */
export interface ActivityMailFilter {
  connectorId?: string | null;
  from?: string | null;
  subject?: string | null;
}

export type ActivitySchedule =
  | { type: 'once'; at: string }
  | { type: 'interval'; minutes: number }
  | { type: 'cron'; expr: string; tz?: string };

export type WatchMode = 'changed' | 'contains' | 'not_contains' | 'regex';

export interface ActivityWatch {
  url: string;
  mode: WatchMode;
  value?: string | null;
}

export interface ActivityDTO {
  id: string;
  agentId: string;
  title: string;
  kind: ActivityKind;
  instructions: string;
  schedule: ActivitySchedule | null;
  watch: ActivityWatch | null;
  filter: ActivityMailFilter | null;
  webhookUrl: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastResult: string | null;
  runCount: number;
  createdAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired';

export interface ApprovalDTO {
  id: string;
  agentId: string;
  conversationId: string;
  action: string;
  summary: string;
  input: unknown;
  status: ApprovalStatus;
  result: unknown;
  error: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface MemoryDTO {
  id: string;
  agentId: string | null;
  content: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntryDTO {
  id: string;
  agentId: string | null;
  kind: string;
  summary: string;
  data: unknown;
  createdAt: string;
}

export interface TeamThreadDTO {
  conversationId: string;
  agentIds: [string, string];
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
}

/** Métadonnées attachées à chaque UIMessage. */
export interface MessageMetadata {
  kind?: 'chat' | 'event' | 'team';
  /** Compagnon auteur (messages d'agent ou messages inter-agents). */
  agentId?: string;
  /** Type d'événement pour les messages "event". */
  event?: {
    type: 'schedule' | 'watch' | 'webhook' | 'mail' | 'agent_reply' | 'agent_message' | 'approval' | 'system';
    title: string;
    activityId?: string;
    approvalId?: string;
    fromAgentId?: string;
  };
  model?: string;
  createdAt?: string;
  autonomous?: boolean;
  hidden?: boolean;
  /** Réponse de l'utilisateur à une demande d'information (ask_user). */
  answer?: { requestId: string; answers: Record<string, unknown> };
}

export interface BootstrapDTO {
  onboarded: boolean;
  openrouterConfigured: boolean;
  defaultModel: ModelConfig | null;
  ollamaUrl: string | null;
  paused: boolean;
}

export type ServerEvent =
  | { type: 'agent.updated'; agent: AgentDTO }
  | { type: 'agent.created'; agent: AgentDTO }
  | { type: 'agent.state'; agentId: string; state: AgentState; detail: string | null }
  | { type: 'turn.started'; agentId: string; conversationId: string; autonomous: boolean }
  | { type: 'turn.finished'; agentId: string; conversationId: string }
  | {
      type: 'message.created';
      conversationId: string;
      agentId: string | null;
      messageId: string;
      hidden: boolean;
      author: 'user' | 'agent' | 'event';
      preview: string;
    }
  | { type: 'activity.changed'; agentId: string }
  | { type: 'approval.changed'; approval: ApprovalDTO }
  | { type: 'memory.changed'; agentId: string | null }
  | { type: 'journal.created'; entry: JournalEntryDTO }
  | { type: 'team.changed'; conversationId: string }
  | { type: 'settings.changed' }
  | { type: 'skills.changed' }
  | { type: 'connectors.changed' }
  | { type: 'request.changed'; request: UserRequestDTO }
  | { type: 'draft.changed'; draft: MailDraftDTO };

// --- Skills, connecteurs, plugins -------------------------------------------

export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  pluginId: string | null;
  createdBy: string;
  updatedAt: string;
}

export type ConnectorKind = 'mcp' | 'mail' | 'integration';
export type IntegrationProvider = 'google-drive' | 'google-calendar' | 'gmail' | 'outlook' | 'github';
export type OAuthProvider = 'google' | 'microsoft' | 'github';

export interface IntegrationConfig {
  provider: IntegrationProvider;
  account: { id: string; label: string; email?: string };
  permissions: string[];
  grantedScopes: string[];
}

export interface IntegrationCatalogEntry {
  id: IntegrationProvider | 'imap-smtp';
  name: string;
  description: string;
  category: 'files' | 'calendar' | 'mail' | 'development';
  oauth: OAuthProvider | null;
  permissions: { id: string; label: string; description: string; scopes: string[]; default: boolean }[];
}

export interface OAuthAppDTO {
  provider: OAuthProvider;
  configured: boolean;
  clientId: string;
  hasSecret: boolean;
  source: 'environment' | 'local';
  callbackUrl: string;
}

export interface McpConfig {
  transport: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export interface MailConfig {
  email: string;
  displayName?: string;
  username: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  /** Fréquence de relève, en minutes. */
  pollMinutes?: number;
}

export interface ConnectorDTO {
  id: string;
  name: string;
  kind: ConnectorKind;
  config: McpConfig | MailConfig | IntegrationConfig;
  /** Noms des secrets enregistrés (valeurs jamais renvoyées). */
  secretKeys: string[];
  enabled: boolean;
  approval: 'ask' | 'auto';
  status: 'unknown' | 'ok' | 'error';
  lastError: string | null;
  tools: { name: string; description: string }[];
  pluginId: string | null;
  createdAt: string;
}

export interface PluginManifest {
  name: string;
  description?: string;
  version?: string;
  skills?: { name: string; description: string; instructions: string }[];
  connectors?: { name: string; config: McpConfig; approval?: 'ask' | 'auto'; secrets?: string[] }[];
}

export interface PluginDTO {
  id: string;
  name: string;
  description: string;
  version: string;
  skills: number;
  connectors: number;
  installedAt: string;
}

// --- Demandes à l'utilisateur ----------------------------------------------

export interface AskQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'single_choice' | 'multi_choice' | 'confirm' | 'number' | 'date';
  options?: string[];
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
}

export interface UserRequestDTO {
  id: string;
  agentId: string;
  conversationId: string;
  title: string;
  questions: AskQuestion[];
  status: 'pending' | 'answered' | 'cancelled';
  answers: Record<string, unknown> | null;
  createdAt: string;
}

export interface MailDraftDTO {
  id: string;
  agentId: string;
  connectorId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'discarded' | 'failed';
  approvalId: string | null;
  error: string | null;
  sentAt: string | null;
}

/**
 * Certains modèles (gpt-oss) laissent parfois fuiter des appels d'outils au
 * format brut dans leur texte (« to=functions.x {…} », jetons <|…|>). On les
 * retire avant affichage et persistance.
 */
export function cleanModelText(text: string): string {
  return text
    .replace(/(?:\{[^{}]*\}\s*)?(?:<\|[a-z_]+\|>\s*)*to=functions\.[\w.-]+(?:\s*<\|[a-z_]+\|>[\w ]*)*\s*(?:\{[^{}]*\})?/gi, ' ')
    .replace(/<\|(?:start|end|message|channel|constrain|call|return)\|>/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,])/g, '$1')
    .trim();
}
