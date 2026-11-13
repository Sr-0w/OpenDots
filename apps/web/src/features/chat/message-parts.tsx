import { lazy, Suspense, type ReactNode } from "react";
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
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { isActionToolPart, presentAssistantTurn } from "@opendots/shared";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import type { ODMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import { formatDateTime } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { ActivityCreatedCard, AnswerBubble, AskUserCard, ConnectionRequestCard, MailDraftCard, SearchResultsCard, TerminalCard } from "./cards";
import { DotAvatar } from "../dot-avatar";
import { openDialog } from "@/lib/dialogs";
import { ComputerSetupCard, WelcomeSetupCards } from './setup-cards';
import { Worked } from "./worked";
import { DesktopScreenshot } from './desktop-screenshot';
import { MessageActions, MessageQuote, ReactionPills } from './message-actions';

import { t } from "@/lib/i18n";
const LiveComputer = lazy(() => import('./live-computer').then(m => ({ default: m.LiveComputer })));
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
    case 'computer_request_setup': return { title: t('Propose de démarrer son ordinateur'), icon: <TerminalIcon className="size-3.5" /> };
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

type AnyTool = ToolUIPart | DynamicToolUIPart;

function toolNameOf(part: { type: string; toolName?: string }) {
  return part.type === 'dynamic-tool' ? String(part.toolName ?? 'tool') : part.type.replace(/^tool-/, '');
}

function ToolPart({ part }: { part: AnyTool }) {
  const name = toolNameOf(part);
  const output = (part as any).output;
  const failed = part.state === "output-error" || output?.ok === false;
  const { title, icon } = describeTool(name, part.input, output);
  return (
    <Tool>
      <ToolHeader title={title} state={part.state} failed={failed} icon={icon} />
      <ToolContent className="w-[min(36rem,78vw)] max-w-full">
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
function EventChip({ message, agentId }: { message: ODMessage; agentId?: string }) {
  const event = message.metadata?.event;
  if ((event?.type === "agent_reply" || event?.type === "agent_message") && event.fromAgentId && (agentId ?? message.metadata?.agentId))
    return <TeamEventCard message={message} agentId={(agentId ?? message.metadata?.agentId)!} />;
  return <PlainEventChip message={message} />;
}

function TeamEventCard({ message, agentId }: { message: ODMessage; agentId: string }) {
  const event = message.metadata!.event!;
  const peer = useStore((s) => s.agents.find((a) => a.id === event.fromAgentId));
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  // Pour une réponse, le texte de l'événement contient « Sa réponse : … » : on n'affiche que la réponse.
  const preview = event.type === "agent_reply" ? (text.split(/Sa réponse :\n/)[1]?.split(/\n\nPoursuis ta tâche/)[0] ?? text) : text;
  const name = peer?.name ?? t("un compagnon");
  return (
    <TeamCard
      title={event.type === "agent_reply" ? (event.title?.startsWith("Échec") ? event.title : t("Réponse de {v0}", { v0: name })) : event.title?.match(/^(Message envoyé à|Réponse envoyée à|Message traité)/) ? event.title : t("Message reçu de {v0}", { v0: name })}
      color={peer?.color}
      date={message.metadata?.createdAt}
      preview={preview}
      onOpen={() => openDialog({ kind: "team", agentA: agentId, agentB: event.fromAgentId! })}
    />
  );
}

/** Carte d'échange entre compagnons (envoi ou réception) ; ouvre le fil complet au clic. */
function TeamCard({ title, color, date, preview, onOpen }: { title: string; color?: string; date?: string; preview: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mx-auto flex w-full max-w-lg flex-col gap-1.5 rounded-xl border border-dashed bg-card/40 px-3 py-2 text-left text-xs transition-colors hover:bg-card"
    >
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {color ? <DotAvatar color={color} size={14} /> : <MessagesSquareIcon className="size-3.5" />}
        <span className="font-medium text-foreground">{title}</span>
        {date && <span className="opacity-60">· {formatDateTime(date)}</span>}
      </span>
      {preview.trim() && <span className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">{preview.trim()}</span>}
    </button>
  );
}

function SentTeamCard({ part, agentId, date }: { part: ToolUIPart; agentId?: string; date?: string }) {
  const input = (part as any).input ?? {};
  const out = (part as any).output;
  const peer = useStore((s) => s.agents.find((a) => a.id === input.to || a.name.toLowerCase() === String(out?.to ?? input.to ?? "").toLowerCase()));
  const name = out?.to ?? peer?.name ?? input.to ?? t("un compagnon");
  return (
    <TeamCard
      title={t("Message envoyé à {v0}", { v0: name })}
      color={peer?.color}
      date={date}
      preview={String(input.message ?? "")}
      onOpen={() => peer && agentId && openDialog({ kind: "team", agentA: agentId, agentB: peer.id })}
    />
  );
}

function isSentTeam(part: ToolUIPart) {
  const out = (part as any).output;
  return part.type === "tool-team_send_message" && part.state === "output-available" && out?.ok !== false && out?.status === "sent";
}

function PlainEventChip({ message }: { message: ODMessage }) {
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
function ToolCard({ part, agentId, date }: { part: ToolUIPart; agentId?: string; date?: string }) {
  if (part.state !== "output-available") return null;
  const name = part.type.slice(5);
  const out = (part as any).output;
  const input = (part as any).input ?? {};
  if (!out || out.ok === false) return null;
  if (isSentTeam(part)) return <SentTeamCard part={part} agentId={agentId} date={date} />;
  if (name === "ask_user" && out.requestId) return <AskUserCard requestId={out.requestId} title={input.title} questions={input.questions ?? []} />;
  if (name === "connection_request_setup") return <ConnectionRequestCard kind={out.kind} provider={out.provider} permissions={out.permissions} reason={out.reason} agentId={agentId} />;
  if (name === 'computer_request_setup' && agentId) return <ComputerSetupCard agentId={agentId} reason={out.reason} />;
  if (name === "mail_prepare" && out.draftId) return <MailDraftCard draftId={out.draftId} approvalId={out.approvalId} />;
  if (name === "shell_exec" && "exit_code" in out) return <TerminalCard command={input.command} output={out} />;
  if (name === "web_search" && Array.isArray(out.results)) return <SearchResultsCard results={out.results} />;
  if (name === "activity_create" && out.activity) return <ActivityCreatedCard title={out.activity.title} when={out.activity.when} kind={out.activity.kind} />;
  if (out.status === "pending_approval" && out.approvalId) return <ApprovalCard approvalId={out.approvalId} fallbackSummary={out.summary} />;
  return null;
}

function isToolPart(part: { type: string }): part is AnyTool {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

export function MessageView({ message, streaming, agentId, onReply, onReact }: {
  message: ODMessage;
  streaming: boolean;
  agentId?: string;
  onReply?: (target: { messageId: string; preview: string; role: 'user' | 'assistant' }) => void;
  onReact?: (messageId: string, emoji: string) => void;
}) {
  if (message.metadata?.kind === "event") return <EventChip message={message} agentId={agentId} />;
  const reply = (preview: string) => onReply?.({ messageId: message.id, preview: preview.slice(0, 180), role: message.role === 'assistant' ? 'assistant' : 'user' });
  const react = (emoji: string) => onReact?.(message.id, emoji);
  const reactions = message.metadata?.reactions ?? [];
  const quote = message.metadata?.replyTo;

  if (message.role !== 'assistant') {
    const text = message.parts.flatMap((part) => part.type === 'text' && !SILENCE.test(part.text) ? [part.text] : []).join('\n').trim();
    const files = message.parts.filter((part): part is Extract<ODMessage['parts'][number], { type: 'file' }> => part.type === 'file');
    return (
      <div id={`message-${message.id}`} className="scroll-mt-24 rounded-2xl [&[data-flash]]:ring-2 [&[data-flash]]:ring-ring">
        <MessageActions text={text} align="end" onReply={() => reply(text)} onReact={react}>
          <Message from="user">
            <MessageContent>
              {quote && <MessageQuote reply={quote} />}
              {message.metadata?.answer ? <AnswerBubble text={text} /> : text && <p className="whitespace-pre-wrap">{text}</p>}
              {files.map((part, index) => part.mediaType?.startsWith('image/')
                ? <a key={index} href={part.url} target="_blank" rel="noreferrer"><img src={part.url} alt={part.filename ?? t('Image jointe')} className="max-h-64 max-w-full rounded-xl border" loading="lazy" /></a>
                : <span key={index} className="rounded-lg border px-2 py-1 text-xs">{part.filename ?? t('Fichier')}</span>)}
            </MessageContent>
          </Message>
        </MessageActions>
        <div className="flex justify-end"><ReactionPills reactions={reactions} onToggle={react} /></div>
      </div>
    );
  }

  const view = presentAssistantTurn(message.parts);
  const tools = view.work.filter(isToolPart);
  const reasoning = view.work.flatMap((part) => part.type === 'reasoning' && part.text?.trim() ? [part.text.trim()] : []).join('\n\n');
  const owner = message.metadata?.agentId ?? agentId;
  const failures = tools.filter((part) => part.state === 'output-error' || (part as { output?: { ok?: boolean } }).output?.ok === false).length;
  const computerUse = tools.some((part) => /^tool-(computer_(action|screenshot|target|keyboard|inspect)|browser_inspect)$/.test(part.type) || (part.type === 'dynamic-tool' && /^(computer_|browser_inspect)/.test(part.toolName)));
  const lastShot = [...tools].reverse().find((part) => ['tool-computer_screenshot', 'tool-computer_action'].includes(part.type) && (part as { output?: { screenshotId?: string; url?: string } }).output?.screenshotId && (part as { output?: { url?: string } }).output?.url);
  const textBubbles = view.bubbles.filter((bubble): bubble is { key: string; text: string } => 'text' in bubble);
  const lastText = textBubbles.at(-1);
  const setup = Boolean(message.metadata?.setup && owner);
  if (!view.bubbles.length && !view.work.length && !view.actions.length && !streaming && !setup) return null;
  const showWork = view.work.length > 0;

  return (
    <div id={`message-${message.id}`} className="flex scroll-mt-24 flex-col gap-2 rounded-2xl [&[data-flash]]:ring-2 [&[data-flash]]:ring-ring">
      {view.bubbles.map((bubble) => 'text' in bubble ? (
        <MessageActions key={bubble.key} text={bubble.text} onReply={() => reply(bubble.text)} onReact={react}>
          <Message from="assistant" data-bubble={bubble.key} className="max-w-[min(100%,36rem)]">
            <MessageContent className="w-fit rounded-2xl rounded-bl-md bg-muted px-3.5 py-2">
              {quote && bubble.key === textBubbles[0]?.key && <MessageQuote reply={quote} />}
              <MessageResponse isAnimating={streaming && bubble.key === lastText?.key}>{bubble.text}</MessageResponse>
            </MessageContent>
          </Message>
        </MessageActions>
      ) : (
        <a key={bubble.key} data-bubble={bubble.key} href={(bubble.image as { url?: string }).url} target="_blank" rel="noreferrer" className="w-fit">
          <img src={(bubble.image as { url?: string }).url} alt={(bubble.image as { filename?: string }).filename ?? t('Image jointe')} className="max-h-64 max-w-full rounded-xl border" loading="lazy" />
        </a>
      ))}
      {streaming && computerUse && owner && <Suspense fallback={null}><LiveComputer key={owner} agentId={owner} /></Suspense>}
      {showWork && <Worked streaming={streaming} count={tools.length} failures={failures} reasoningOnly={view.work.length > 0 && tools.length === 0} workedMs={message.metadata?.workedMs}>
        {reasoning && <div className="whitespace-pre-wrap text-muted-foreground text-xs"><p className="mb-1 font-medium text-foreground">{t('Raisonnement')}</p>{reasoning}</div>}
        <div className="flex flex-wrap items-start gap-1.5">{tools.filter((part) => !isSentTeam(part as ToolUIPart)).map((part) => <ToolPart key={part.toolCallId} part={part} />)}</div>
        {tools.map((part) => <ToolCard key={`card-${part.toolCallId}`} part={part as ToolUIPart} agentId={owner} date={message.metadata?.createdAt} />)}
        {!streaming && lastShot && <DesktopScreenshot output={(lastShot as { output: { url: string; screenshotId: string } }).output} afterAction={lastShot.type === 'tool-computer_action'} />}
      </Worked>}
      {view.actions.map((part) => <ToolCard key={`action-${(part as AnyTool).toolCallId}`} part={part as ToolUIPart} agentId={owner} date={message.metadata?.createdAt} />)}
      {setup && <WelcomeSetupCards agentId={owner!} />}
      {!textBubbles.length && (view.work.length > 0 || view.actions.length > 0) && (
        <MessageActions text="" onReply={() => reply(t('Travail'))} onReact={react}><span className="sr-only">{t('Actions du message')}</span></MessageActions>
      )}
      <ReactionPills reactions={reactions} onToggle={react} />
    </div>
  );
}
