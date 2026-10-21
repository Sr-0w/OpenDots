import { t } from "./i18n";
import type { ServerEvent } from "@opendots/shared";
import { getState } from "./store";

/**
 * Notifications du navigateur, limitées à ce qui mérite l'attention (15.4) :
 * message d'un compagnon, validation ou réponse attendue — seulement quand
 * l'onglet n'est pas au premier plan.
 */
const KEY = "od-notify";

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled() {
  try {
    return notificationsSupported() && Notification.permission === "granted" && localStorage.getItem(KEY) !== "off";
  } catch {
    return false;
  }
}

export async function setNotifications(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // stockage indisponible
  }
  if (on && notificationsSupported() && Notification.permission === "default") await Notification.requestPermission();
  return notificationsEnabled();
}

function show(title: string, body: string, agentId?: string) {
  const n = new Notification(title, { body, icon: "/favicon.svg", tag: agentId });
  n.onclick = () => {
    window.focus();
    if (agentId) window.location.hash = `/agent/${agentId}`;
    n.close();
  };
}

export function notifyFromEvent(e: ServerEvent) {
  if (!notificationsEnabled() || document.visibilityState === "visible") return;
  const agentName = (id?: string | null) => getState().agents.find((a) => a.id === id)?.name ?? t("Un compagnon");
  if (e.type === "message.created" && e.author === "agent" && !e.hidden && e.agentId) {
    const agent = getState().agents.find((a) => a.mainConversationId === e.conversationId);
    if (agent) show(agent.name, e.preview.replace(/[*_`#]/g, "").slice(0, 140), agent.id);
  } else if (e.type === "approval.changed" && e.approval.status === "pending") {
    show(t("{name} attend ta validation", { name: agentName(e.approval.agentId) }), e.approval.summary, e.approval.agentId);
  } else if (e.type === "request.changed" && e.request.status === "pending") {
    show(t("{name} a une question", { name: agentName(e.request.agentId) }), e.request.title, e.request.agentId);
  }
}
