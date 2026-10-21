import type {
  ActivityDTO,
  ActivityMailFilter,
  ActivitySchedule,
  ActivityWatch,
  ConnectorDTO,
  MailConfig,
  MailDraftDTO,
  McpConfig,
  PluginDTO,
  PluginManifest,
  SkillDTO,
  UserRequestDTO,
  AgentDTO,
  ApprovalDTO,
  BootstrapDTO,
  JournalEntryDTO,
  MemoryDTO,
  ModelConfig,
  TeamThreadDTO,
} from "@opendots/shared";
import type { UIMessage } from "ai";
import type { MessageMetadata } from "@opendots/shared";

export type ODMessage = UIMessage<MessageMetadata>;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", "x-opendots-client": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status);
  return data as T;
}

export interface ActivityInput {
  title: string;
  kind: ActivityDTO["kind"];
  instructions: string;
  schedule?: ActivitySchedule | null;
  watch?: ActivityWatch | null;
  filter?: ActivityMailFilter | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: "openrouter" | "ollama";
  contextLength: number | null;
  tools: boolean;
  reasoning: boolean;
  promptPrice: number | null;
  completionPrice: number | null;
}

export interface ShellSettingsDTO {
  mode: "auto" | "docker" | "host" | "off";
  approval: "ask" | "auto" | "default";
  image: string;
  network: boolean;
  sudo: boolean;
}

export interface SettingsDTO {
  openrouterKey: string | null;
  defaultModel: ModelConfig;
  ollamaUrl: string | null;
  timezone: string;
  paused: boolean;
  search: { provider: "auto" | "duckduckgo" | "bing" | "brave" | "tavily" | "searxng"; hasKey: boolean; url: string | null };
  shell: ShellSettingsDTO;
}

export interface ComputerStatus {
  settings: ShellSettingsDTO;
  dockerAvailable: boolean;
  backend: "docker" | "host" | null;
  container: { name: string; running: boolean; image: string; network: boolean } | null;
  approvalRequired: boolean;
  workspaces: string;
}

export const api = {
  bootstrap: () => request<BootstrapDTO>("GET", "/bootstrap"),
  saveKey: (key: string) => request<{ ok: boolean }>("POST", "/onboarding/key", { key }),
  completeOnboarding: (model: ModelConfig, timezone: string) =>
    request<{ ok: boolean; warning?: string }>("POST", "/onboarding/complete", { model, timezone }),

  openrouterModels: () => request<ModelInfo[]>("GET", "/models/openrouter"),
  openrouterEndpoints: (id: string) => request<string[]>("GET", `/models/openrouter/endpoints?id=${encodeURIComponent(id)}`),
  ollamaModels: (url?: string) => request<ModelInfo[]>("GET", `/models/ollama${url ? `?url=${encodeURIComponent(url)}` : ""}`),

  settings: () => request<SettingsDTO>("GET", "/settings"),
  updateSettings: (
    patch: Partial<Omit<SettingsDTO, "openrouterKey" | "search" | "shell">> & {
      openrouterKey?: string;
      search?: { provider: SettingsDTO["search"]["provider"]; apiKey?: string | null; url?: string | null };
      shell?: Partial<ShellSettingsDTO>;
    },
  ) => request<{ ok: boolean }>("PUT", "/settings", patch),
  computer: () => request<ComputerStatus>("GET", "/computer"),
  resetComputer: () => request<ComputerStatus>("POST", "/computer/reset"),

  agents: () => request<AgentDTO[]>("GET", "/agents"),
  agent: (id: string) => request<AgentDTO>("GET", `/agents/${id}`),
  updateAgent: (id: string, patch: Partial<Pick<AgentDTO, "name" | "description" | "personality" | "instructions" | "color" | "model" | "permissions">>) =>
    request<AgentDTO>("PATCH", `/agents/${id}`, patch),
  archiveAgent: (id: string) => request<{ ok: boolean }>("DELETE", `/agents/${id}`),
  markRead: (id: string) => request<{ ok: boolean }>("POST", `/agents/${id}/read`),
  messages: (id: string, before?: number) =>
    request<{ conversationId: string; messages: ODMessage[]; cursor: number | null; active: boolean }>(
      "GET",
      `/agents/${id}/messages${before ? `?before=${before}` : ""}`,
    ),
  stop: (id: string) => request<{ ok: boolean }>("POST", `/agents/${id}/stop`),
  conversation: (id: string) =>
    request<{ conversation: { id: string; agentA: string; agentB: string }; messages: ODMessage[]; active: boolean }>(
      "GET",
      `/conversations/${id}/messages`,
    ),
  teamThreads: () => request<TeamThreadDTO[]>("GET", "/team/threads"),

  activities: (agentId?: string) => request<ActivityDTO[]>("GET", `/activities${agentId ? `?agentId=${agentId}` : ""}`),
  createActivity: (input: ActivityInput & { agentId: string }) => request<ActivityDTO>("POST", "/activities", input),
  updateActivity: (id: string, patch: Partial<ActivityInput> & { enabled?: boolean }) => request<ActivityDTO>("PATCH", `/activities/${id}`, patch),
  deleteActivity: (id: string) => request<{ ok: boolean }>("DELETE", `/activities/${id}`),
  runActivity: (id: string) => request<unknown>("POST", `/activities/${id}/run`),

  approvals: (status?: string) => request<ApprovalDTO[]>("GET", `/approvals${status ? `?status=${status}` : ""}`),
  decide: (id: string, decision: "approve" | "reject") =>
    request<{ ok: boolean; status: string; error: string | null }>("POST", `/approvals/${id}`, { decision }),

  memories: (agentId: string) => request<MemoryDTO[]>("GET", `/agents/${agentId}/memories`),
  sharedMemories: () => request<MemoryDTO[]>("GET", "/memories/shared"),
  deleteMemory: (id: string) => request<{ ok: boolean }>("DELETE", `/memories/${id}`),

  skills: () => request<SkillDTO[]>("GET", "/skills"),
  createSkill: (input: { name: string; description: string; instructions: string }) => request<SkillDTO>("POST", "/skills", input),
  updateSkill: (id: string, patch: Partial<{ name: string; description: string; instructions: string; enabled: boolean }>) =>
    request<SkillDTO>("PATCH", `/skills/${id}`, patch),
  deleteSkill: (id: string) => request<{ ok: boolean }>("DELETE", `/skills/${id}`),

  connectors: () => request<ConnectorDTO[]>("GET", "/connectors"),
  testMail: (config: MailConfig, password: string, connectorId?: string) =>
    request<{ ok: boolean; imap: string; smtp: string }>("POST", "/connectors/mail/test", { config, password, connectorId }),
  createConnector: (input: {
    name: string;
    kind: "mcp" | "mail";
    config: McpConfig | MailConfig;
    secrets?: Record<string, string>;
    approval?: "ask" | "auto";
    requestedBy?: string;
  }) => request<ConnectorDTO>("POST", "/connectors", input),
  updateConnector: (
    id: string,
    patch: Partial<{ name: string; enabled: boolean; approval: "ask" | "auto"; config: McpConfig | MailConfig; secrets: Record<string, string> }>,
  ) => request<ConnectorDTO>("PATCH", `/connectors/${id}`, patch),
  refreshConnector: (id: string) => request<ConnectorDTO & { newMessages?: number }>("POST", `/connectors/${id}/refresh`),
  deleteConnector: (id: string) => request<{ ok: boolean }>("DELETE", `/connectors/${id}`),

  plugins: () => request<PluginDTO[]>("GET", "/plugins"),
  previewPlugin: (source: { manifest?: unknown; url?: string }) => request<PluginManifest>("POST", "/plugins/preview", source),
  installPlugin: (source: { manifest?: unknown; url?: string; secrets?: Record<string, Record<string, string>> }) =>
    request<{ ok: boolean; id: string }>("POST", "/plugins", source),
  uninstallPlugin: (id: string) => request<{ ok: boolean }>("DELETE", `/plugins/${id}`),

  draft: (id: string) => request<MailDraftDTO>("GET", `/mail/drafts/${id}`),
  updateDraft: (id: string, patch: { to?: string[]; cc?: string[]; subject?: string; body?: string }) =>
    request<MailDraftDTO>("PATCH", `/mail/drafts/${id}`, patch),
  userRequest: (id: string) => request<UserRequestDTO>("GET", `/requests/${id}`),

  journal: (agentId?: string) => request<JournalEntryDTO[]>("GET", `/journal${agentId ? `?agentId=${agentId}` : ""}`),
};
