import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClockIcon,
  CopyIcon,
  EyeIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import type { ActivityDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { openDialog } from "@/lib/dialogs";
import { useServerEvent, useStore } from "@/lib/store";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { toast } from "sonner";
import { DotAvatar } from "../dot-avatar";
import { PageShell } from "./page-shell";

import { locale, t } from "@/lib/i18n";
const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Description lisible d'un horaire, à la manière « Tous les jours à 8:00 ». */
export function describeActivity(a: ActivityDTO): string {
  if (a.kind === "webhook") return t("À chaque appel du webhook");
  if (a.kind === "mail") {
    const parts = [a.filter?.from && t("de {from}", { from: a.filter.from }), a.filter?.subject && t("objet « {subject} »", { subject: a.filter.subject })].filter(Boolean);
    return t("À chaque e-mail reçu") + (parts.length ? ` (${parts.join(", ")})` : "");
  }
  const s = a.schedule;
  if (!s) return "";
  if (s.type === "once") return t("Le {date}", { date: formatDateTime(s.at) });
  if (s.type === "interval") {
    const every =
      s.minutes % 60 === 0
        ? s.minutes === 60
          ? t("toutes les heures")
          : t("toutes les {n} h", { n: s.minutes / 60 })
        : t("toutes les {n} min", { n: s.minutes });
    const text = a.kind === "watch" ? t("Vérifie {every}", { every }) : every;
    return text.replace(/^./, (c) => c.toUpperCase());
  }
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6](?:,[0-6])*)$/.exec(s.expr.trim());
  if (!m) return t("Cron {expr}", { expr: s.expr });
  const time = `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  if (m[3] === "*") return t("Tous les jours à {v0}", { v0: time });
  if (m[3] === "1-5") return t("En semaine à {v0}", { v0: time });
  return t("Le {days} à {time}", { days: m[3].split(",").map((d) => t(DAY_NAMES[Number(d)])).join(", "), time });
}

export const ACTIVITY_ICONS = { schedule: CalendarClockIcon, watch: EyeIcon, webhook: WebhookIcon, mail: MailIcon };

export const STATUS_LABELS: Record<string, string> = {
  reported: t("message envoyé"),
  silent: t("rien à signaler"),
  checked: t("vérifié"),
  error: t("erreur"),
};

export function TasksPage() {
  const agents = useStore((s) => s.agents);
  const [items, setItems] = useState<ActivityDTO[] | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");

  const reload = useCallback(() => {
    api.activities().then(setItems).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  useServerEvent((e) => e.type === "activity.changed" && reload(), [reload]);

  const groups = useMemo(() => {
    const list = (items ?? []).filter((a) => (filter === "all" ? true : filter === "active" ? a.enabled : !a.enabled));
    return agents.map((agent) => ({ agent, items: list.filter((a) => a.agentId === agent.id) })).filter((g) => g.items.length);
  }, [items, agents, filter]);

  const counts = { all: items?.length ?? 0, active: items?.filter((a) => a.enabled).length ?? 0, paused: items?.filter((a) => !a.enabled).length ?? 0 };

  return (
    <PageShell
      title={t("Tâches planifiées")}
      description={t("Les responsabilités permanentes de tes compagnons : routines, surveillances et déclencheurs. Elles se créent en leur parlant ; ici tu peux les suspendre ou les ajuster.")}
      action={
        <Button size="sm" onClick={() => openDialog({ kind: "activity" })}>
          <PlusIcon /> {t("Nouvelle tâche")}
        </Button>
      }
    >
      <div className="mb-4 flex gap-1">
        {(["all", "active", "paused"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn("rounded-full px-3 py-1 text-xs transition-colors", filter === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}
          >
            {f === "all" ? t("Toutes") : f === "active" ? t("Actives") : t("En pause")} · {counts[f]}
          </button>
        ))}
      </div>

      {items && groups.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <CalendarClockIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="font-medium text-sm">{filter === "paused" ? t("Aucune tâche en pause") : filter === "active" ? t("Aucune tâche active") : t("Aucune tâche pour l’instant")}</p>
          <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-xs">
            {t("Dis par exemple à un compagnon : « Tous les matins à 8 h, fais-moi un point sur mes e-mails importants ».")}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {groups.map(({ agent, items: list }) => (
          <section key={agent.id}>
            <div className="mb-2 flex items-center gap-2">
              <DotAvatar color={agent.color} size={20} state={agent.state} />
              <h2 className="font-medium text-sm">{agent.name}</h2>
              <span className="text-muted-foreground text-xs">{list.length}</span>
            </div>
            <div className="divide-y overflow-hidden rounded-2xl border bg-card/50">
              {list.map((a) => (
                <TaskRow key={a.id} activity={a} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

function TaskRow({ activity: a }: { activity: ActivityDTO }) {
  const Icon = ACTIVITY_ICONS[a.kind];
  const finished = !a.enabled && a.schedule?.type === "once" && a.runCount > 0;
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", !a.enabled && "opacity-60")}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <button className="min-w-0 flex-1 text-left" onClick={() => openDialog({ kind: "activity", activity: a })}>
        <p className="truncate font-medium text-sm">{a.title}</p>
        <p className="truncate text-muted-foreground text-xs">
          {describeActivity(a)}
          {a.enabled && a.nextRunAt && t(" · prochaine {v0}", { v0: relativeTimeFuture(a.nextRunAt) })}
          {finished && t(" · terminée")}
          {!a.enabled && !finished && t(" · en pause")}
        </p>
        {a.lastRunAt && (
          <p className={cn("truncate text-[11px]", a.lastStatus === "error" ? "text-destructive" : "text-muted-foreground")}>
            {t("Dernière exécution")} {relativeTime(a.lastRunAt)} — {STATUS_LABELS[a.lastStatus ?? ""] ?? a.lastStatus}
            {a.lastStatus === "error" && a.lastResult ? ` : ${a.lastResult.slice(0, 80)}` : ""}
          </p>
        )}
      </button>
      <Switch
        checked={a.enabled}
        aria-label={a.enabled ? t("Mettre en pause") : t("Reprendre")}
        onCheckedChange={(enabled) => api.updateActivity(a.id, { enabled }).catch((e) => toast.error(e.message))}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" aria-label={t("Actions")}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openDialog({ kind: "activity", activity: a })}>
            <PencilIcon /> {t("Modifier")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => api.runActivity(a.id).then(() => toast.success(t("Exécution lancée"))).catch((e) => toast.error(e.message))}>
            <PlayIcon /> {t("Exécuter maintenant")}
          </DropdownMenuItem>
          {a.webhookUrl && (
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard?.writeText(a.webhookUrl!);
                toast.success(t("URL du webhook copiée"));
              }}
            >
              <CopyIcon /> {t("Copier l’URL du webhook")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => confirm(t("Supprimer « {v0} » ?", { v0: a.title })) && api.deleteActivity(a.id).catch((e) => toast.error(e.message))}
          >
            <Trash2Icon /> {t("Supprimer")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function relativeTimeFuture(iso: string) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  if (diff < 60) return t("dans moins d’une minute");
  if (diff < 3600) return t("dans {n} min", { n: Math.round(diff / 60) });
  if (diff < 86400) return t("à {time}", { time: new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) });
  return t("le {date}", { date: formatDateTime(iso) });
}
