import { useEffect, useSyncExternalStore } from "react";
import type { AgentDTO, ApprovalDTO, ServerEvent } from "@opendots/shared";
import { api } from "./api";
import { closeDialog } from "./dialogs";
import { notifyFromEvent } from "./notify";

/** État global minimal, alimenté par le flux SSE du backend. */
interface State {
  agents: AgentDTO[];
  approvals: ApprovalDTO[];
  connected: boolean;
  paused: boolean;
}

let generation = 0;
let state: State = { agents: [], approvals: [], connected: false, paused: false };
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: ServerEvent) => void>();

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

export function getState() {
  return state;
}

/** Abonnement aux événements bruts (rafraîchissement des panneaux). */
export function useServerEvent(fn: (e: ServerEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    eventListeners.add(fn);
    return () => {
      eventListeners.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function upsertAgent(agent: AgentDTO) {
  set((s) => {
    const exists = s.agents.some((a) => a.id === agent.id);
    return { agents: exists ? s.agents.map((a) => (a.id === agent.id ? agent : a)) : [...s.agents, agent] };
  });
}

const refreshTimers = new Map<string, number>();
function refreshAgent(id: string) {
  const requestGeneration = generation;
  window.clearTimeout(refreshTimers.get(id));
  refreshTimers.set(
    id,
    window.setTimeout(() => {
      api.agent(id).then((a) => requestGeneration === generation && !a.archived && upsertAgent(a)).catch(() => {});
    }, 250),
  );
}

export async function loadInitial() {
  const requestGeneration = generation;
  const [agents, approvals, settings] = await Promise.all([api.agents(), api.approvals(), api.settings()]);
  if (requestGeneration === generation) set({ agents, approvals, paused: settings.paused });
}

function handle(e: ServerEvent) {
  switch (e.type) {
    case "agent.created":
    case "agent.updated":
      if (e.agent.archived) set((s) => ({ agents: s.agents.filter((a) => a.id !== e.agent.id) }));
      else upsertAgent(e.agent);
      break;
    case "agent.state":
      set((s) => ({ agents: s.agents.map((a) => (a.id === e.agentId ? { ...a, state: e.state, stateDetail: e.detail } : a)) }));
      break;
    case "approval.changed":
      set((s) => {
        const exists = s.approvals.some((a) => a.id === e.approval.id);
        return {
          approvals: exists ? s.approvals.map((a) => (a.id === e.approval.id ? e.approval : a)) : [e.approval, ...s.approvals],
        };
      });
      break;
    case "message.created":
      if (e.agentId) refreshAgent(e.agentId);
      else {
        const owner = state.agents.find((a) => a.mainConversationId === e.conversationId);
        if (owner) refreshAgent(owner.id);
      }
      break;
    case "settings.changed": {
      const requestGeneration = generation;
      api.settings().then((s) => requestGeneration === generation && set({ paused: s.paused })).catch(() => {});
      break;
    }
  }
  for (const l of eventListeners) l(e);
  try {
    notifyFromEvent(e);
  } catch {
    // notifications indisponibles
  }
}

let source: EventSource | null = null;
export function clearAccountState() {
  generation++;
  closeDialog();
  source?.close(); source = null;
  for (const timer of refreshTimers.values()) window.clearTimeout(timer);
  refreshTimers.clear();
  set({ agents: [], approvals: [], connected: false, paused: false });
}

export function connectEvents() {
  if (source) return;
  source = new EventSource("/api/events");
  const connectedSource = source;
  source.onopen = () => {
    if (source !== connectedSource) return;
    set({ connected: true });
    // Après une reconnexion, on resynchronise l'état.
    loadInitial().catch(() => {});
  };
  source.onerror = () => { if (source === connectedSource) set({ connected: false }); };
  source.onmessage = (msg) => {
    if (source !== connectedSource) return;
    try {
      const e = JSON.parse(msg.data) as ServerEvent | { type: "hello" };
      if (e.type !== "hello") handle(e as ServerEvent);
    } catch {
      // ignoré
    }
  };
}

export function removeAgentLocally(id: string) {
  set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
}
