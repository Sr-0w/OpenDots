import { useMemo } from "react";
import type { AgentDTO } from "@opendots/shared";
import { useWork } from "@/lib/work-store";
import { formatDateTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { turnWork, TurnWork } from "../chat/message-parts";
import { Worked } from "../chat/worked";

/**
 * Le travail du compagnon, tour par tour : raisonnement, outils et sorties.
 * Chaque tour est replié par défaut ; le fil ne garde que les messages.
 */
export function WorkTab({ agent }: { agent: AgentDTO }) {
  const { messages, streamingId } = useWork(agent.id);
  const turns = useMemo(
    () => messages
      .filter((message) => message.role === "assistant" && message.metadata?.kind !== "event")
      .map((message) => ({ message, work: turnWork(message) }))
      .filter(({ message, work }) => work.hasWork || message.id === streamingId)
      .reverse(),
    [messages, streamingId],
  );
  if (!turns.length) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center">
        <p className="font-medium text-sm">{t("Aucun travail récent")}</p>
        <p className="mt-1 text-muted-foreground text-xs">{t("Le raisonnement et les outils utilisés par {v0} apparaîtront ici, pas dans la conversation.", { v0: agent.named ? agent.name : t("ton compagnon") })}</p>
      </div>
    );
  }
  return (
    <ol className="space-y-1">
      {turns.map(({ message, work }) => {
        const streaming = message.id === streamingId;
        return (
          <li key={message.id} className="rounded-xl border bg-card/60 px-3 py-1.5" data-work-turn>
            {message.metadata?.createdAt && <p className="pt-1 text-[11px] text-muted-foreground">{formatDateTime(message.metadata.createdAt)}</p>}
            <Worked streaming={streaming} count={work.tools.length} failures={work.failures} reasoningOnly={work.hasWork && work.tools.length === 0} workedMs={message.metadata?.workedMs}>
              <TurnWork message={message} agentId={agent.id} streaming={streaming} />
            </Worked>
          </li>
        );
      })}
    </ol>
  );
}
