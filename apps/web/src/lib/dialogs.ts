import { useSyncExternalStore } from "react";
import type { ActivityDTO, ConnectorDTO, IntegrationProvider, SkillDTO } from "@opendots/shared";

/** Modales globales, ouvrables depuis n'importe où (cartes de conversation, pages…). */
export type DialogState =
  | { kind: "mail"; initialPreset?: "custom"; requestedBy?: string; connector?: ConnectorDTO }
  | { kind: "mcp"; requestedBy?: string; connector?: ConnectorDTO }
  | { kind: 'integration'; requestedBy?: string; provider?: IntegrationProvider; connector?: ConnectorDTO }
  | { kind: "plugin" }
  | { kind: "skill"; skill?: SkillDTO }
  | { kind: "activity"; activity?: ActivityDTO; agentId?: string }
  | { kind: "draft"; draftId: string }
  | null;

let current: DialogState = null;
const listeners = new Set<() => void>();

export function openDialog(d: Exclude<DialogState, null>) {
  current = d;
  for (const l of listeners) l();
}

export function closeDialog() {
  current = null;
  for (const l of listeners) l();
}

export function useDialog(): DialogState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
