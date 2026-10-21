import { useCallback, useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type ODMessage } from "@/lib/api";
import { useServerEvent, useStore } from "@/lib/store";
import { cn, formatDateTime } from "@/lib/utils";
import { DotAvatar } from "../dot-avatar";
import { t } from "@/lib/i18n";

const SILENCE = /^\s*<silence\s*\/?>\s*$/i;

/** Fil complet (lecture seule) des échanges entre deux compagnons, mis en forme comme le chat. */
export function TeamThreadDialog({ agentA, agentB, onClose }: { agentA: string; agentB: string; onClose: () => void }) {
  const agents = useStore((s) => s.agents);
  const me = agents.find((a) => a.id === agentA);
  const peer = agents.find((a) => a.id === agentB);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ODMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.teamPair(agentA, agentB).then((r) => setConversationId(r.conversationId)).catch((e) => setError(e.message));
  }, [agentA, agentB]);
  const reload = useCallback(() => {
    if (!conversationId) return;
    api.conversation(conversationId).then((r) => setMessages(r.messages)).catch((e) => setError(e.message));
  }, [conversationId]);
  useEffect(reload, [reload]);
  useServerEvent((e) => (e.type === "message.created" || e.type === "turn.finished") && e.conversationId === conversationId && reload(), [reload, conversationId]);

  const items = (messages ?? [])
    .map((m) => ({ m, text: m.parts.map((p) => (p.type === "text" && !SILENCE.test(p.text) ? p.text : "")).join("\n").trim() }))
    .filter((x) => x.text);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            {me && <DotAvatar color={me.color} size={20} />}
            {peer && <DotAvatar color={peer.color} size={20} />}
            <span>
              {me?.name ?? t("Compagnon")} ↔ {peer?.name ?? t("Compagnon")}
            </span>
          </DialogTitle>
          <DialogDescription>{t("Échange avec {v0}", { v0: peer?.name ?? t("un compagnon") })}</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="p-6 text-destructive text-sm">{error}</div>
        ) : !messages ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <LoaderIcon className="size-5 animate-spin" />
          </div>
        ) : !items.length ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">{t("Aucun message pour l’instant")}</div>
        ) : (
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full gap-6 px-4 py-6 sm:px-6">
              {items.map(({ m, text }) => {
                const author = agents.find((a) => a.id === m.metadata?.agentId);
                const mine = m.metadata?.agentId === agentA;
                return (
                  <div key={m.id} className={cn("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
                    <div className={cn("flex items-center gap-2 text-muted-foreground text-xs", mine && "flex-row-reverse")}>
                      <DotAvatar color={author?.color ?? "#999"} size={20} />
                      <span className="font-medium text-foreground">{author?.name ?? t("Compagnon")}</span>
                      <span className="opacity-60">{formatDateTime(m.metadata?.createdAt)}</span>
                    </div>
                    <Message from={mine ? "user" : "assistant"} className={cn(!mine && "max-w-full")}>
                      <MessageContent>
                        <MessageResponse>{text}</MessageResponse>
                      </MessageContent>
                    </Message>
                  </div>
                );
              })}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </DialogContent>
    </Dialog>
  );
}
