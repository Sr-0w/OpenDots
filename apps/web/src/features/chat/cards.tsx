import { createContext, useContext, useEffect, useState } from "react";
import { CheckIcon, ClipboardListIcon, LoaderIcon, MailIcon, PencilIcon, PlugIcon, SendIcon, XIcon } from "lucide-react";
import type { AskQuestion, MailDraftDTO, UserRequestDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { openDialog } from "@/lib/dialogs";
import { useServerEvent, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Actions de la conversation accessibles aux cartes (réponses aux formulaires). */
export const ChatActionsContext = createContext<{
  sendAnswer: (requestId: string, answers: Record<string, unknown>, summary: string) => void;
  busy: boolean;
} | null>(null);

const cardClass = "not-prose w-full max-w-lg rounded-2xl border bg-card p-4 shadow-xs";

// --- Formulaire : informations et choix -------------------------------------------

function summarize(title: string, questions: AskQuestion[], answers: Record<string, unknown>) {
  return [
    title,
    ...questions.map((q) => {
      const v = answers[q.id];
      const shown = Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "oui" : "non") : String(v ?? "");
      return `- ${q.label} : ${shown || "(sans réponse)"}`;
    }),
  ].join("\n");
}

export function AskUserCard({ requestId, title, questions }: { requestId: string; title: string; questions: AskQuestion[] }) {
  const actions = useContext(ChatActionsContext);
  const [request, setRequest] = useState<UserRequestDTO | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  useEffect(() => {
    api.userRequest(requestId).then(setRequest).catch(() => {});
  }, [requestId]);
  useServerEvent((e) => e.type === "request.changed" && e.request.id === requestId && setRequest(e.request), [requestId]);

  const status = request?.status ?? "pending";
  const answered = status === "answered";
  const shownValues = answered ? (request?.answers ?? {}) : values;
  const set = (id: string, v: unknown) => setValues((p) => ({ ...p, [id]: v }));

  const final = () => {
    const out: Record<string, unknown> = { ...values };
    for (const q of questions) {
      if (q.allowOther && other[q.id]?.trim()) {
        if (q.type === "multi_choice") out[q.id] = [...((out[q.id] as string[]) ?? []), other[q.id].trim()];
        else if (q.type === "single_choice" && (!out[q.id] || out[q.id] === "__other")) out[q.id] = other[q.id].trim();
      }
      if (out[q.id] === "__other") out[q.id] = "";
      if (q.type === "confirm" && out[q.id] === undefined) out[q.id] = false;
    }
    return out;
  };
  const missing = questions.some((q) => {
    if (!q.required || q.type === "confirm") return false;
    const v = final()[q.id];
    return v === undefined || v === "" || (Array.isArray(v) && !v.length);
  });

  function submit() {
    const answers = final();
    actions?.sendAnswer(requestId, answers, summarize(title, questions, answers));
  }

  return (
    <div className={cn(cardClass, status === "pending" && "border-foreground/30 ring-4 ring-foreground/5")}>
      <div className="mb-3 flex items-start gap-2.5">
        <ClipboardListIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-snug">{title}</p>
          <p className="text-muted-foreground text-xs">{answered ? "Réponses envoyées" : status === "cancelled" ? "Remplacé par une nouvelle demande" : "Ta réponse est attendue"}</p>
        </div>
      </div>
      <fieldset disabled={status !== "pending"} className="space-y-4">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <p className="font-medium text-[13px]">
              {q.label}
              {q.required && q.type !== "confirm" && <span className="text-destructive"> *</span>}
            </p>
            <QuestionInput q={q} value={shownValues[q.id]} onChange={(v) => set(q.id, v)} />
            {q.allowOther && (q.type === "single_choice" || q.type === "multi_choice") && !answered && (
              <Input
                className="h-8 text-sm"
                placeholder="Autre…"
                value={other[q.id] ?? ""}
                onChange={(e) => {
                  setOther({ ...other, [q.id]: e.target.value });
                  if (q.type === "single_choice") set(q.id, "__other");
                }}
              />
            )}
          </div>
        ))}
      </fieldset>
      {status === "pending" && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={submit} disabled={missing || !actions || actions.busy}>
            <SendIcon /> Envoyer
          </Button>
        </div>
      )}
    </div>
  );
}

function QuestionInput({ q, value, onChange }: { q: AskQuestion; value: unknown; onChange: (v: unknown) => void }) {
  if (q.type === "single_choice") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {q.options?.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-default",
              value === o ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === "multi_choice") {
    const list = (Array.isArray(value) ? value : []) as string[];
    return (
      <div className="space-y-1.5">
        {q.options?.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <Checkbox checked={list.includes(o)} onCheckedChange={(c) => onChange(c ? [...list, o] : list.filter((x) => x !== o))} />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === "confirm") {
    return (
      <div className="flex gap-1.5">
        {[
          { v: true, l: "Oui" },
          { v: false, l: "Non" },
        ].map((o) => (
          <button
            key={o.l}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn("rounded-full border px-4 py-1 text-sm transition-colors", value === o.v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            {o.l}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === "textarea") return <Textarea rows={3} value={String(value ?? "")} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Input
      type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
      value={String(value ?? "")}
      placeholder={q.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Message de l'utilisateur contenant ses réponses à un formulaire. */
export function AnswerBubble({ text }: { text: string }) {
  const [title, ...lines] = text.split("\n");
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <CheckIcon className="size-3" /> {title}
      </p>
      {lines.map((l, i) => {
        const [label, ...rest] = l.replace(/^- /, "").split(" : ");
        return (
          <p key={i} className="text-sm">
            <span className="text-muted-foreground">{label} :</span> {rest.join(" : ")}
          </p>
        );
      })}
    </div>
  );
}

// --- Demande de connexion ------------------------------------------------------------

export function ConnectionRequestCard({ kind, reason, agentId }: { kind: "mail" | "mcp"; reason: string; agentId?: string }) {
  const Icon = kind === "mail" ? MailIcon : PlugIcon;
  const [connected, setConnected] = useState<string[]>([]);
  const reload = () =>
    api
      .connectors()
      .then((list) => setConnected(list.filter((c) => c.kind === kind && c.enabled && c.status !== "error").map((c) => c.name)))
      .catch(() => {});
  useEffect(() => {
    void reload();
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useServerEvent((e) => e.type === "connectors.changed" && void reload(), [kind]);
  return (
    <div className={cardClass}>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{kind === "mail" ? "Connecter une boîte mail" : "Ajouter un connecteur"}</p>
          <p className="text-muted-foreground text-xs">{reason}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {connected.length > 0 && (
          <span className="mr-auto flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
            <CheckIcon className="size-3.5 shrink-0" /> <span className="truncate">Connecté : {connected.join(", ")}</span>
          </span>
        )}
        <Button size="sm" variant={connected.length ? "outline" : "default"} onClick={() => openDialog({ kind, requestedBy: agentId })}>
          {connected.length ? "Ajouter un autre" : kind === "mail" ? "Connecter" : "Configurer"}
        </Button>
      </div>
    </div>
  );
}

// --- Brouillon d'e-mail « prêt à envoyer » -------------------------------------------------

export function MailDraftCard({ draftId, approvalId }: { draftId: string; approvalId: string }) {
  const [draft, setDraft] = useState<MailDraftDTO | null>(null);
  const approval = useStore((s) => s.approvals.find((a) => a.id === approvalId));
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    api.draft(draftId).then(setDraft).catch(() => {});
  }, [draftId]);
  useServerEvent((e) => e.type === "draft.changed" && e.draft.id === draftId && setDraft(e.draft), [draftId]);

  const status = draft?.status ?? "pending";
  const label =
    status === "sent"
      ? "Envoyé"
      : status === "discarded"
        ? "Abandonné"
        : status === "failed"
          ? "Échec de l’envoi"
          : approval?.status === "approved"
            ? "Envoi en cours…"
            : "Prêt à envoyer";

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const res = await api.decide(approvalId, decision);
      if (res.status === "failed") toast.error(res.error ?? "Échec de l’envoi");
      else if (decision === "approve") toast.success("E-mail envoyé");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!draft) return <div className={cn(cardClass, "h-32 animate-pulse")} />;

  return (
    <div className={cn(cardClass, "p-0", status === "pending" && "border-foreground/30")}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <MailIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">Nouvel e-mail</span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px]",
            status === "sent" && "bg-muted text-foreground",
            status === "pending" && "bg-foreground text-background",
            (status === "failed" || status === "discarded") && "bg-muted text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 border-b px-4 py-2.5 text-sm">
        <dt className="text-muted-foreground">De</dt>
        <dd className="truncate">{draft.from}</dd>
        <dt className="text-muted-foreground">À</dt>
        <dd className="truncate">{draft.to.join(", ")}</dd>
        {draft.cc.length > 0 && (
          <>
            <dt className="text-muted-foreground">Cc</dt>
            <dd className="truncate">{draft.cc.join(", ")}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Objet</dt>
        <dd className="font-medium">{draft.subject}</dd>
      </dl>
      <p className="max-h-72 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">{draft.body}</p>
      {draft.error && <p className="px-4 pb-3 text-destructive text-xs">{draft.error}</p>}
      {status === "pending" && approval?.status === "pending" && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5">
          <Button size="sm" onClick={() => decide("approve")} disabled={!!busy}>
            {busy === "approve" ? <LoaderIcon className="animate-spin" /> : <SendIcon />} Envoyer
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDialog({ kind: "draft", draftId })} disabled={!!busy}>
            <PencilIcon /> Modifier
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => decide("reject")} disabled={!!busy}>
            <XIcon /> Abandonner
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Tâche créée --------------------------------------------------------------------------

export function ActivityCreatedCard({ title, when, kind }: { title: string; when: string; kind: string }) {
  return (
    <button
      type="button"
      onClick={() => (window.location.hash = "/tasks")}
      className="not-prose flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-accent/60"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        <ClipboardListIcon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px]">{kind === "watch" ? "Surveillance créée" : kind === "mail" ? "Règle mail créée" : kind === "webhook" ? "Webhook créé" : "Tâche planifiée créée"}</p>
        <p className="truncate font-medium text-sm">{title}</p>
        <p className="truncate text-muted-foreground text-xs">{when}</p>
      </div>
    </button>
  );
}

// --- Terminal ------------------------------------------------------------------------------

export function TerminalCard({
  command,
  output,
}: {
  command: string;
  output: { exit_code: number | null; stdout: string; stderr: string; timed_out?: boolean; duration_ms?: number };
}) {
  const [open, setOpen] = useState(false);
  const text = [output.stdout, output.stderr].filter((x) => x?.trim()).join("\n").trimEnd();
  const lines = text.split("\n");
  const long = lines.length > 12;
  return (
    <div className="not-prose w-full max-w-2xl overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100">
      <div className="flex items-center gap-2 border-white/10 border-b px-3 py-1.5 font-mono text-[11px] opacity-70">
        <span className="truncate">$ {command.split("\n")[0]}</span>
        <span className="ml-auto shrink-0">
          {output.timed_out ? "délai dépassé" : `code ${output.exit_code}`}
          {output.duration_ms !== undefined && ` · ${(output.duration_ms / 1000).toFixed(1)} s`}
        </span>
      </div>
      {text && (
        <pre className={cn("overflow-x-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed", !open && long && "max-h-56 overflow-y-hidden")}>
          {text}
        </pre>
      )}
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="w-full border-white/10 border-t py-1 text-[11px] opacity-70 hover:opacity-100">
          {open ? "Réduire" : `Afficher les ${lines.length} lignes`}
        </button>
      )}
    </div>
  );
}

// --- Résultats de recherche ---------------------------------------------------------------

export function SearchResultsCard({ results }: { results: { title: string; url: string; snippet: string }[] }) {
  if (!results.length) return null;
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  };
  return (
    <div className="not-prose flex w-full max-w-2xl flex-wrap gap-1.5">
      {results.slice(0, 6).map((r) => (
        <a
          key={r.url}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          title={r.snippet}
          className="flex max-w-[15rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors hover:bg-accent"
        >
          <span className="truncate">{r.title}</span>
          <span className="shrink-0 text-muted-foreground">{host(r.url)}</span>
        </a>
      ))}
    </div>
  );
}
