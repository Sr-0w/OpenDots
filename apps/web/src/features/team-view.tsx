import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, MessagesSquareIcon } from "lucide-react";
import type { TeamThreadDTO } from "@opendots/shared";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { api, type ODMessage } from "@/lib/api";
import { useServerEvent, useStore } from "@/lib/store";
import { cn, plainPreview, relativeTime } from "@/lib/utils";
import { DotAvatar } from "./dot-avatar";

import { t } from "@/lib/i18n";
/** Consultation des échanges entre compagnons (lecture seule, traçabilité). */
export function TeamView() {
  const [threads, setThreads] = useState<TeamThreadDTO[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const agents = useStore((s) => s.agents);
  const byId = (id: string) => agents.find((a) => a.id === id);

  const reload = useCallback(() => {
    api.teamThreads().then(setThreads).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  useServerEvent((e) => (e.type === "team.changed" || e.type === "message.created") && reload(), [reload]);

  useEffect(() => {
    if (!selected && threads?.length && window.matchMedia("(min-width: 768px)").matches) setSelected(threads[0].conversationId);
  }, [threads, selected]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn("flex w-full flex-col border-r md:w-72", selected && "hidden md:flex")}>
        <div className="px-4 pt-5 pb-3">
          <h2 className="font-semibold">{t("Échanges de l’équipe")}</h2>
          <p className="text-muted-foreground text-xs">{t("Ce que les compagnons se disent entre eux.")}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {threads?.length === 0 && (
            <p className="px-2 py-6 text-center text-muted-foreground text-sm">
              {t("Aucun échange pour l’instant. Demande par exemple à un compagnon de consulter un autre.")}
            </p>
          )}
          {threads?.map((t) => {
            const [a, b] = t.agentIds.map(byId);
            return (
              <button
                key={t.conversationId}
                onClick={() => setSelected(t.conversationId)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-accent", selected === t.conversationId && "bg-accent")}
              >
                <div className="relative h-8 w-11 shrink-0">
                  <DotAvatar color={a?.color ?? "#999"} size={26} className="absolute top-0 left-0" />
                  <DotAvatar color={b?.color ?? "#999"} size={26} className="absolute right-0 bottom-0 ring-2 ring-background" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">
                      {a?.name ?? "?"} · {b?.name ?? "?"}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(t.lastMessageAt)}</span>
                  </div>
                  <p className="truncate text-muted-foreground text-xs">{plainPreview(t.lastMessagePreview)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
        {selected ? (
          <Thread conversationId={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessagesSquareIcon className="size-6" />
            <p className="text-sm">{t("Sélectionne un échange")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<ODMessage[]>([]);
  const agents = useStore((s) => s.agents);
  const reload = useCallback(() => {
    api.conversation(conversationId).then((r) => setMessages(r.messages)).catch(() => {});
  }, [conversationId]);
  useEffect(reload, [reload]);
  useServerEvent((e) => (e.type === "message.created" || e.type === "turn.finished") && e.conversationId === conversationId && reload(), [reload]);

  const first = messages[0]?.metadata?.agentId;
  return (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
      </div>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-4 py-6">
          {messages.map((m) => {
            const author = agents.find((a) => a.id === m.metadata?.agentId);
            const right = m.metadata?.agentId !== first;
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();
            const tools = m.parts.filter((p) => p.type.startsWith("tool-")).length;
            if (!text && !tools) return null;
            return (
              <div key={m.id} className={cn("flex gap-3", right && "flex-row-reverse")}>
                <DotAvatar color={author?.color ?? "#999"} size={28} />
                <div className={cn("min-w-0 max-w-[80%] space-y-1", right && "items-end text-right")}>
                  <p className="text-muted-foreground text-xs">
                    {author?.name ?? t("Compagnon")} · {relativeTime(m.metadata?.createdAt)}
                    {tools > 0 && ` · ${t(tools > 1 ? "{n} actions" : "{n} action", { n: tools })}`}
                  </p>
                  {text && (
                    <div className={cn("rounded-2xl border bg-card px-3.5 py-2.5 text-left text-sm", right ? "rounded-tr-md" : "rounded-tl-md")}>
                      <MessageResponse>{text}</MessageResponse>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </>
  );
}
