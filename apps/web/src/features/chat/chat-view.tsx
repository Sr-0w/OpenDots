import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertCircleIcon } from "lucide-react";
import { AGENT_STATE_LABELS, type AgentDTO } from "@opendots/shared";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { api, type ODMessage } from "@/lib/api";
import { useServerEvent } from "@/lib/store";
import { DotAvatar } from "../dot-avatar";
import { Composer } from "./composer";
import { MessageView } from "./message-parts";
import { ChatActionsContext } from "./cards";

import { t } from "@/lib/i18n";
const FIRST_SUGGESTIONS = [t("Salut !"), t("Comment devrais-je t’appeler ?"), t("Qu’est-ce que tu sais faire ?")];
const SUGGESTIONS = [
  t("Tous les matins à 8 h, fais-moi un point sur ma journée"),
  t("Souviens-toi que je préfère des réponses courtes"),
  t("Crée un compagnon pour m’aider avec mes projets"),
];

export function ChatView({ agent }: { agent: AgentDTO }) {
  const [initial, setInitial] = useState<ODMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInitial(null);
    api
      .messages(agent.id)
      .then((r) => setInitial(r.messages))
      .catch((e) => setError(e.message));
  }, [agent.id]);

  if (error) return <div className="p-6 text-destructive text-sm">{error}</div>;
  if (!initial) return <div className="flex-1" />;
  return <ChatInner key={agent.id} agent={agent} initial={initial} />;
}

function ChatInner({ agent, initial }: { agent: AgentDTO; initial: ODMessage[] }) {
  const uploaded = useRef(new WeakMap<File, { type: 'file'; url: string; filename: string; mediaType: string }>());
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ODMessage>({
        api: `/api/agents/${agent.id}/chat`,
        headers: { "x-opendots-client": "1" },
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages[messages.length - 1] } }),
        prepareReconnectToStreamRequest: () => ({ api: `/api/agents/${agent.id}/stream` }),
      }),
    [agent.id],
  );

  const chat = useChat<ODMessage>({ id: agent.id, messages: initial, transport, resume: true });
  const { messages, status, setMessages, resumeStream, sendMessage, error, clearError } = chat;
  const statusRef = useRef(status);
  statusRef.current = status;

  const resync = useCallback(async () => {
    const res = await api.messages(agent.id);
    if (statusRef.current === "ready" || statusRef.current === "error") setMessages(res.messages);
    return res;
  }, [agent.id, setMessages]);

  useServerEvent(
    (e) => {
      if (e.type === "turn.started" && e.conversationId === agent.mainConversationId && e.autonomous) {
        if (statusRef.current === "ready" || statusRef.current === "error") {
          // Un réveil autonome : on récupère l'événement déclencheur puis on suit le flux.
          resync().then(() => resumeStream()).catch(() => {});
        }
      }
      if (e.type === "turn.finished" && e.conversationId === agent.mainConversationId) {
        window.setTimeout(() => void resync().catch(() => {}), 300);
      }
    },
    [agent.id, agent.mainConversationId, resync, resumeStream],
  );

  // Marque la conversation comme lue.
  useEffect(() => {
    if (status === "ready") void api.markRead(agent.id).catch(() => {});
  }, [agent.id, status, messages.length]);

  const busy = status === "submitted" || status === "streaming";
  const actions = useMemo(
    () => ({
      busy,
      sendAnswer: (requestId: string, answers: Record<string, unknown>, summary: string) =>
        void sendMessage({ text: summary, metadata: { kind: "chat", answer: { requestId, answers } } }),
    }),
    [busy, sendMessage],
  );
  const last = messages[messages.length - 1];
  const waiting = status === "submitted" || (status === "streaming" && last?.role === "user");
  const empty = messages.length === 0;

  return (
    <ChatActionsContext.Provider value={actions}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-6 pb-10 sm:px-6">
          {empty && <EmptyState agent={agent} onPick={(t) => sendMessage({ text: t })} />}
          {messages.map((m, i) => (
            <MessageView key={m.id} message={m} agentId={agent.id} streaming={busy && i === messages.length - 1 && m.role === "assistant"} />
          ))}
          {waiting && (
            <div className="flex items-center gap-2.5 text-sm">
              <DotAvatar color={agent.color} state="thinking" size={18} />
              <Shimmer>{agent.stateDetail ?? (agent.state === "available" ? t("En réflexion…") : `${t(AGENT_STATE_LABELS[agent.state])}…`)}</Shimmer>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="flex-1">
                <p className="font-medium">{t("{name} n’a pas pu répondre.", { name: agent.name })}</p>
                <p className="text-muted-foreground text-xs">{error.message}</p>
              </div>
              <button className="text-muted-foreground text-xs hover:text-foreground" onClick={() => clearError()}>
                {t("Fermer")}
              </button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-5">
        {!empty && messages.length < 6 && !busy && (
          <Suggestions className="mb-2 px-1">
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={(t) => sendMessage({ text: t })} className="h-7 text-xs" />
            ))}
          </Suggestions>
        )}
        <Composer
          busy={busy}
          autoFocus
          placeholder={agent.named ? t("Écrire à {v0}…", { v0: agent.name }) : t("Dis bonjour à ton compagnon…")}
          onSubmit={async (text, images) => {
            const files = [];
            for (const image of images) {
              let part = uploaded.current.get(image);
              if (!part) { const attachment = await api.uploadImage(image); part = { type: 'file' as const, url: attachment.url, filename: attachment.filename, mediaType: attachment.mediaType }; uploaded.current.set(image, part); }
              files.push(part);
            }
            void sendMessage({ text, files });
          }}
          onStop={() => {
            void api.stop(agent.id);
            chat.stop();
          }}
        />
      </div>
    </div>
    </ChatActionsContext.Provider>
  );
}

function EmptyState({ agent, onPick }: { agent: AgentDTO; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <DotAvatar color={agent.color} size={72} state={agent.state} named={agent.named} />
      <div className="space-y-1.5">
        <h2 className="font-semibold text-xl tracking-tight">
          {agent.named ? t("{v0} est là", { v0: agent.name }) : t("Ton premier compagnon est prêt")}
        </h2>
        <p className="mx-auto max-w-sm text-balance text-muted-foreground text-sm">
          {agent.named
            ? agent.description || t("Parle-lui naturellement : il retient, s’organise et agit pour toi.")
            : t("Il n’a pas encore de nom ni de personnalité. Fais connaissance avec lui : tout se configure en discutant.")}
        </p>
      </div>
      <Suggestions className="justify-center">
        {(agent.named ? SUGGESTIONS : FIRST_SUGGESTIONS).map((s) => (
          <Suggestion key={s} suggestion={s} onClick={onPick} className="h-8 text-xs" />
        ))}
      </Suggestions>
    </div>
  );
}
