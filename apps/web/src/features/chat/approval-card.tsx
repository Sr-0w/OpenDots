import { useState } from "react";
import { CheckIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import type { ApprovalDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS: Record<ApprovalDTO["status"], { label: string; className: string }> = {
  pending: { label: "En attente de ta validation", className: "text-amber-600 dark:text-amber-400" },
  approved: { label: "Approuvé — exécution…", className: "text-sky-600" },
  executed: { label: "Approuvé et exécuté", className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Approuvé, mais l’exécution a échoué", className: "text-destructive" },
  rejected: { label: "Refusé", className: "text-muted-foreground" },
  expired: { label: "Expiré", className: "text-muted-foreground" },
};

/** Carte de validation liée à une opération précise du backend (8.2). */
export function ApprovalCard({ approvalId, fallbackSummary }: { approvalId: string; fallbackSummary?: string }) {
  const approval = useStore((s) => s.approvals.find((a) => a.id === approvalId));
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const status = approval?.status ?? "pending";
  const meta = STATUS[status];

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const res = await api.decide(approvalId, decision);
      if (res.status === "failed") toast.error(res.error ?? "L’exécution a échoué");
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
        status === "pending" && "border-amber-500/40 ring-4 ring-amber-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldQuestionIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-sm leading-snug">{approval?.summary ?? fallbackSummary ?? "Action à valider"}</p>
          <p className={cn("text-xs", meta.className)}>{meta.label}</p>
          {approval?.error && <p className="text-destructive text-xs">{approval.error}</p>}
        </div>
      </div>
      {status === "pending" && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => decide("reject")} disabled={!!busy}>
            <XIcon /> Refuser
          </Button>
          <Button size="sm" onClick={() => decide("approve")} disabled={!!busy}>
            <CheckIcon /> Approuver
          </Button>
        </div>
      )}
    </div>
  );
}
