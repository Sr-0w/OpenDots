import type {
  ActivityDTO,
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

export interface SettingsDTO {
  openrouterKey: string | null;
  defaultModel: ModelConfig;
  ollamaUrl: string | null;
  timezone: string;
  paused: boolean;
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
  updateSettings: (patch: Partial<Omit<SettingsDTO, "openrouterKey">> & { openrouterKey?: string }) =>
    request<{ ok: boolean }>("PUT", "/settings", patch),

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
  updateActivity: (id: string, patch: { enabled?: boolean }) => request<ActivityDTO>("PATCH", `/activities/${id}`, patch),
  deleteActivity: (id: string) => request<{ ok: boolean }>("DELETE", `/activities/${id}`),
  runActivity: (id: string) => request<unknown>("POST", `/activities/${id}/run`),

  approvals: (status?: string) => request<ApprovalDTO[]>("GET", `/approvals${status ? `?status=${status}` : ""}`),
  decide: (id: string, decision: "approve" | "reject") =>
    request<{ ok: boolean; status: string; error: string | null }>("POST", `/approvals/${id}`, { decision }),

  memories: (agentId: string) => request<MemoryDTO[]>("GET", `/agents/${agentId}/memories`),
  sharedMemories: () => request<MemoryDTO[]>("GET", "/memories/shared"),
  deleteMemory: (id: string) => request<{ ok: boolean }>("DELETE", `/memories/${id}`),

  journal: (agentId?: string) => request<JournalEntryDTO[]>("GET", `/journal${agentId ? `?agentId=${agentId}` : ""}`),
};
