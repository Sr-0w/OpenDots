import type { ReactNode } from "react";
import {
  BellRingIcon,
  BotIcon,
  BrainIcon,
  CalendarClockIcon,
  ClockIcon,
  SearchIcon,
  TerminalIcon,
  ClipboardListIcon,
  MailIcon,
  PlugIcon,
  EyeIcon,
  GlobeIcon,
  KeyRoundIcon,
  MessagesSquareIcon,
  SparklesIcon,
  UserCogIcon,
  WebhookIcon,
} from "lucide-react";
import type { ToolUIPart } from "ai";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import type { ODMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn, formatDateTime } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { ActivityCreatedCard, AnswerBubble, AskUserCard, ConnectionRequestCard, MailDraftCard, SearchResultsCard, TerminalCard } from "./cards";
import { DotAvatar } from "../dot-avatar";

import { t } from "@/lib/i18n";
const SILENCE = /^\s*<silence\s*\/?>\s*$/i;

function host(url: unknown) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return t("une page");
  }
}

/** Libellé lisible d'un appel d'outil, pour que l'utilisateur comprenne sans jargon. */
function describeTool(name: string, input: any, output: any): { title: string; icon: ReactNode } {
  const i = input ?? {};
  switch (name) {
    case "agent_get_profile":
      return { title: t("Consulte son profil"), icon: <UserCogIcon className="size-3.5" /> };
    case "agent_update_profile":
      return { title: i.name ? t("Prend le nom « {v0} »", { v0: i.name }) : t("Met à jour son identité"), icon: <SparklesIcon className="size-3.5" /> };
    case "agent_update_instructions":
      return { title: t("Enregistre tes consignes"), icon: <UserCogIcon className="size-3.5" /> };
    case "agent_configure_model":
      return { title: i.model ? t("Modèle : {v0}", { v0: i.model }) : t("Change de modèle"), icon: <BrainIcon className="size-3.5" /> };
    case "agent_update_permissions":
      return { title: t("Modifie des permissions"), icon: <KeyRoundIcon className="size-3.5" /> };
    case "agent_list":
      return { title: t("Consulte l’équipe"), icon: <BotIcon className="size-3.5" /> };
    case "agent_create":
      return { title: i.name ? t("Crée {v0}", { v0: i.name }) : t("Crée un compagnon"), icon: <BotIcon className="size-3.5" /> };
    case "team_send_message":
      return { title: i.to ? t("Écrit à {v0}", { v0: i.to }) : t("Contacte un compagnon"), icon: <MessagesSquareIcon className="size-3.5" /> };
    case "memory_remember":
      return { title: t("Mémorise"), icon: <BrainIcon className="size-3.5" /> };
    case "memory_update":
      return { title: t("Corrige un souvenir"), icon: <BrainIcon className="size-3.5" /> };
    case "memory_forget":
      return { title: t("Oublie un souvenir"), icon: <BrainIcon className="size-3.5" /> };
    case "memory_search":
      return { title: t("Cherche dans sa mémoire"), icon: <BrainIcon className="size-3.5" /> };
    case "activity_create":
      return {
        title: i.title ? t(i.kind === "watch" ? "Surveillance : {title}" : i.kind === "webhook" ? "Webhook : {title}" : "Planification : {title}", { title: i.title }) : t("Crée une activité"),
        icon: i.kind === "watch" ? <EyeIcon className="size-3.5" /> : i.kind === "webhook" ? <WebhookIcon className="size-3.5" /> : <CalendarClockIcon className="size-3.5" />,
      };
    case "activity_list":
      return { title: t("Consulte ses activités"), icon: <CalendarClockIcon className="size-3.5" /> };
    case "activity_update":
      return { title: t("Modifie une activité"), icon: <CalendarClockIcon className="size-3.5" /> };
    case "activity_delete":
      return { title: t("Supprime une activité"), icon: <CalendarClockIcon className="size-3.5" /> };
    case "web_search":
      return { title: i.query ? t("Cherche « {v0} »", { v0: String(i.query).slice(0, 50) }) : t("Cherche sur le web"), icon: <SearchIcon className="size-3.5" /> };
    case "datetime":
      return { title: t("Consulte la date et l’heure"), icon: <ClockIcon className="size-3.5" /> };
    case "computer_screenshot": return { title: t("Observe le bureau graphique"), icon: <EyeIcon className="size-3.5" /> };
    case "computer_action": return { title: t("Prépare une action sur le bureau"), icon: <TerminalIcon className="size-3.5" /> };
    case "shell_exec":
      return { title: `$ ${String(i.command ?? "").split("\n")[0].slice(0, 60)}`, icon: <TerminalIcon className="size-3.5" /> };
    case "web_fetch":
      return { title: output?.title ? t("Lit « {title} »", { title: String(output.title).slice(0, 40) }) : t("Lit {host}", { host: host(i.url) }), icon: <GlobeIcon className="size-3.5" /> };
    case "ask_user":
      return { title: t("Te pose des questions"), icon: <ClipboardListIcon className="size-3.5" /> };
    case "connection_request_setup":
      return { title: i.kind === "mail" ? t("Demande une connexion mail") : t("Demande un connecteur"), icon: <PlugIcon className="size-3.5" /> };
    case "skill_use":
      return { title: t("Applique le skill « {v0} »", { v0: i.name ?? "" }), icon: <SparklesIcon className="size-3.5" /> };
    case "skill_save":
      return { title: t("Enregistre le skill « {v0} »", { v0: i.name ?? "" }), icon: <SparklesIcon className="size-3.5" /> };
    case "mail_list_accounts":
      return { title: t("Consulte les comptes mail"), icon: <MailIcon className="size-3.5" /> };
    case "mail_search":
      return { title: i.from ? t("Cherche les e-mails de {v0}", { v0: i.from }) : t("Cherche dans les e-mails"), icon: <MailIcon className="size-3.5" /> };
    case "mail_read":
      return { title: output?.subject ? t("Lit « {v0} »", { v0: String(output.subject).slice(0, 40) }) : t("Lit un e-mail"), icon: <MailIcon className="size-3.5" /> };
    case "mail_prepare":
      return { title: t("Prépare un e-mail"), icon: <MailIcon className="size-3.5" /> };
    case "approval_respond":
      return { title: i.decision === "reject" ? t("Transmet ton refus") : t("Transmet ton accord"), icon: <KeyRoundIcon className="size-3.5" /> };
    default:
      if (name.startsWith("mcp_")) return { title: name.replace(/^mcp_/, "").replace(/_/g, " "), icon: <PlugIcon className="size-3.5" /> };
      return { title: name, icon: null };
  }
}

function ToolPart({ part }: { part: ToolUIPart }) {
  const name = part.type.slice(5);
  const output = (part as any).output;
  const failed = part.state === "output-error" || output?.ok === false;
  const { title, icon } = describeTool(name, part.input, output);
  return (
    <Tool>
      <ToolHeader title={title} state={part.state} failed={failed} icon={icon} />
      <ToolContent className="w-[min(36rem,78vw)]">
        <ToolInput input={part.input} />
        <ToolOutput output={output} errorText={part.errorText ?? (output?.ok === false ? output.error : undefined)} />
      </ToolContent>
    </Tool>
  );
}

const EVENT_ICONS: Record<string, ReactNode> = {
  schedule: <CalendarClockIcon className="size-3.5" />,
  watch: <EyeIcon className="size-3.5" />,
  webhook: <WebhookIcon className="size-3.5" />,
  agent_reply: <MessagesSquareIcon className="size-3.5" />,
  approval: <KeyRoundIcon className="size-3.5" />,
  system: <BellRingIcon className="size-3.5" />,
};

/** Événement ayant réveillé le compagnon : affiché discrètement, détails au clic. */
function EventChip({ message }: { message: ODMessage }) {
  const event = message.metadata?.event;
  const from = useStore((s) => s.agents.find((a) => a.id === event?.fromAgentId));
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  return (
    <details className="group/event mx-auto w-full max-w-lg text-center">
      <summary className="mx-auto inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground">
        {from ? <DotAvatar color={from.color} size={14} /> : EVENT_ICONS[event?.type ?? "system"]}
        <span>{event?.title ?? t("Événement")}</span>
        <span className="opacity-60">· {formatDateTime(message.metadata?.createdAt)}</span>
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border bg-card/60 p-3 text-left font-sans text-muted-foreground text-xs">
        {text}
      </pre>
    </details>
  );
}

/** Rendu riche de certains outils, directement dans la conversation. */
function ToolCard({ part, agentId }: { part: ToolUIPart; agentId?: string }) {
  if (part.state !== "output-available") return null;
  const name = part.type.slice(5);
  const out = (part as any).output;
  const input = (part as any).input ?? {};
  if (!out || out.ok === false) return null;
  if (name === "ask_user" && out.requestId) return <AskUserCard requestId={out.requestId} title={input.title} questions={input.questions ?? []} />;
  if (name === "connection_request_setup") return <ConnectionRequestCard kind={input.kind} provider={input.provider} reason={input.reason} agentId={agentId} />;
  if (name === "mail_prepare" && out.draftId) return <MailDraftCard draftId={out.draftId} approvalId={out.approvalId} />;
  if (name === "computer_screenshot" && out.screenshotId) return <a href={out.url} target="_blank" rel="noreferrer" className="block max-w-xl"><img src={out.url} alt={t("Capture du bureau privé")} className="rounded-xl border" loading="lazy" /></a>;
  if (name === "shell_exec" && "exit_code" in out) return <TerminalCard command={input.command} output={out} />;
  if (name === "web_search" && Array.isArray(out.results)) return <SearchResultsCard results={out.results} />;
  if (name === "activity_create" && out.activity) return <ActivityCreatedCard title={out.activity.title} when={out.activity.when} kind={out.activity.kind} />;
  if (out.status === "pending_approval" && out.approvalId) return <ApprovalCard approvalId={out.approvalId} fallbackSummary={out.summary} />;
  return null;
}

type Group =
  | { kind: "text"; index: number; text: string }
  | { kind: "file"; index: number; part: Extract<ODMessage["parts"][number], { type: "file" }> }
  | { kind: "steps"; index: number; reasoning: string; tools: ToolUIPart[]; open: boolean };

/** Regroupe réflexions et appels d'outils consécutifs en une seule ligne d'étapes. */
function groupParts(parts: ODMessage["parts"], streaming: boolean): Group[] {
  const groups: Group[] = [];
  parts.forEach((part, index) => {
    const last = groups[groups.length - 1];
    if (part.type === "text") {
      if (!SILENCE.test(part.text) && part.text.trim()) groups.push({ kind: "text", index, text: part.text });
    } else if (part.type === "file") {
      groups.push({ kind: "file", index, part });
    } else if (part.type === "reasoning" || part.type.startsWith("tool-")) {
      const steps = last?.kind === "steps" ? last : null;
      const g = steps ?? { kind: "steps" as const, index, reasoning: "", tools: [], open: false };
      if (part.type === "reasoning") g.reasoning += (g.reasoning ? "\n\n" : "") + part.text;
      else g.tools.push(part as ToolUIPart);
      g.open = streaming && index === parts.length - 1 && part.type === "reasoning";
      if (!steps) groups.push(g);
    }
  });
  return groups;
}

export function MessageView({ message, streaming }: { message: ODMessage; streaming: boolean }) {
  if (message.metadata?.kind === "event") return <EventChip message={message} />;

  const groups = groupParts(message.parts, streaming);
  if (!groups.length && !streaming) return null;
  const lastGroup = groups[groups.length - 1];

  return (
    <Message from={message.role} className={cn(message.role === "assistant" && "max-w-full")}>
      <MessageContent>
        {groups.map((g) => {
          const key = `${message.id}-${g.index}`;
          if (g.kind === "text") {
            if (message.role === "user" && message.metadata?.answer) return <AnswerBubble key={key} text={g.text} />;
            return message.role === "user" ? (
              <p key={key} className="whitespace-pre-wrap">{g.text}</p>
            ) : (
              <MessageResponse key={key} isAnimating={streaming && g === lastGroup}>
                {g.text}
              </MessageResponse>
            );
          }
          if (g.kind === "file") {
            return g.part.mediaType?.startsWith("image/") ? (
              <img key={key} src={g.part.url} alt={g.part.filename ?? ""} className="max-h-64 rounded-xl border" />
            ) : (
              <span key={key} className="rounded-lg border px-2 py-1 text-xs">{g.part.filename ?? t("Fichier")}</span>
            );
          }
          const thinking = streaming && g === lastGroup && g.open;
          return (
            <div key={key} className="flex flex-col gap-2">
              {(g.reasoning.trim() || thinking) && (
                <Reasoning isStreaming={thinking} defaultOpen={false}>
                  <ReasoningTrigger />
                  <ReasoningContent>{g.reasoning}</ReasoningContent>
                </Reasoning>
              )}
              {g.tools.length > 0 && (
                <div className="flex flex-wrap items-start gap-1.5">
                  {g.tools.map((t) => (
                    <ToolPart key={t.toolCallId} part={t} />
                  ))}
                </div>
              )}
              {g.tools.map((t) => (
                <ToolCard key={`card-${t.toolCallId}`} part={t} agentId={message.metadata?.agentId} />
              ))}
            </div>
          );
        })}
      </MessageContent>
    </Message>
  );
}
