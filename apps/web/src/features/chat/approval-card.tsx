import { useState } from "react";
import { CheckIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import type { ApprovalDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { t } from "@/lib/i18n";
const STATUS: Record<ApprovalDTO["status"], { label: string; className: string }> = {
  pending: { label: t("En attente de ta validation"), className: "text-foreground" },
  approved: { label: t("Approuvé — exécution…"), className: "text-muted-foreground" },
  executed: { label: t("Approuvé et exécuté"), className: "text-foreground" },
  failed: { label: t("Approuvé, mais l’exécution a échoué"), className: "text-destructive" },
  rejected: { label: t("Refusé"), className: "text-muted-foreground" },
  expired: { label: t("Expiré"), className: "text-muted-foreground" },
};

/**
 * Un résumé d'approbation arrive en une ligne (« Service — compte · action · commit … · {json} »).
 * On le découpe : le contexte, l'action en titre, et la charge utile en détails repliés.
 */
export function splitApprovalSummary(summary: string): { context: string | null; title: string; details: [string, string][]; extra: string[] } {
  const parts = summary.split(" · ").map((part) => part.trim()).filter(Boolean);
  const details: [string, string][] = [];
  const extra: string[] = [];
  const text: string[] = [];
  for (const part of parts) {
    if (/^[{[]/.test(part)) {
      try {
        const value = JSON.parse(part) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          for (const [key, v] of Object.entries(value)) details.push([key, typeof v === "string" ? v : JSON.stringify(v)]);
        } else extra.push(part);
      } catch {
        extra.push(part);
      }
    } else if (/^commit [0-9a-f]{7,}$/i.test(part)) details.push(["commit", part.slice(7, 19)]);
    else text.push(part);
  }
  if (!text.length) return { context: null, title: summary, details: [], extra: [] };
  const context = text.length > 1 && text[0].length <= 80 ? text[0] : null;
  const rest = context ? text.slice(1) : text;
  return { context, title: rest[0], details, extra: [...rest.slice(1), ...extra] };
}

/** Carte de validation liée à une opération précise du backend (8.2). */
export function ApprovalCard({ approvalId, fallbackSummary }: { approvalId: string; fallbackSummary?: string }) {
  const approval = useStore((s) => s.approvals.find((a) => a.id === approvalId));
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const status = approval?.status ?? "pending";
  const meta = STATUS[status];
  const summary = splitApprovalSummary(approval?.summary ?? fallbackSummary ?? t("Action à valider"));
  const hasDetails = summary.details.length > 0 || summary.extra.length > 0;

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const res = await api.decide(approvalId, decision);
      if (res.status === "failed") toast.error(res.error ?? t("L’exécution a échoué"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        "not-prose w-full max-w-md rounded-2xl border bg-card p-4 shadow-xs",
        status === "pending" && "border-foreground/30 ring-4 ring-foreground/5",
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldQuestionIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          {summary.context && <p className="truncate text-muted-foreground text-xs">{summary.context}</p>}
          <p className="font-medium text-sm leading-snug [overflow-wrap:anywhere]">{summary.title}</p>
          <p className={cn("text-xs", meta.className)}>{meta.label}</p>
          {hasDetails && (
            <details className="group/details pt-1 text-xs">
              <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">{t("Détails")}</summary>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-muted/60 p-2">
                {summary.details.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="break-words font-mono text-[11px]">{value.length > 400 ? `${value.slice(0, 400)}…` : value}</dd>
                  </div>
                ))}
                {summary.extra.map((line, index) => <dd key={index} className="col-span-2 break-words text-muted-foreground">{line}</dd>)}
              </dl>
            </details>
          )}
          {approval?.action === "computer.action" && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs">{JSON.stringify((approval.input as {action?: unknown})?.action, null, 2)}</pre>}
          {approval?.error && <p className="text-destructive text-xs">{approval.error}</p>}
        </div>
      </div>
      {status === "pending" && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => decide("reject")} disabled={!!busy}>
            <XIcon /> {t("Refuser")}
          </Button>
          <Button size="sm" onClick={() => decide("approve")} disabled={!!busy}>
            <CheckIcon /> {t("Approuver")}
          </Button>
        </div>
      )}
    </div>
  );
}
