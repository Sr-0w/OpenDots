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
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  web: true,
  manageActivities: true,
  messageAgents: true,
  createAgents: 'ask',
  manageMemory: true,
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

export type ActivityKind = 'schedule' | 'watch' | 'webhook';

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
    type: 'schedule' | 'watch' | 'webhook' | 'agent_reply' | 'approval' | 'system';
    title: string;
    activityId?: string;
    approvalId?: string;
    fromAgentId?: string;
  };
  model?: string;
  createdAt?: string;
  autonomous?: boolean;
  hidden?: boolean;
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
  | { type: 'message.created'; conversationId: string; agentId: string | null; messageId: string; hidden: boolean }
  | { type: 'activity.changed'; agentId: string }
  | { type: 'approval.changed'; approval: ApprovalDTO }
  | { type: 'memory.changed'; agentId: string | null }
  | { type: 'journal.created'; entry: JournalEntryDTO }
  | { type: 'team.changed'; conversationId: string }
  | { type: 'settings.changed' };
