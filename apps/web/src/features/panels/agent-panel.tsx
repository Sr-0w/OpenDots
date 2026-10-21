import { useCallback, useEffect, useState } from "react";
import { CopyIcon, PencilIcon, PlusIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import type { ActivityDTO, AgentDTO, JournalEntryDTO, MemoryDTO } from "@opendots/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/store";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { toast } from "sonner";
import { AgentSettings } from "./agent-settings";
import { ACTIVITY_ICONS, describeActivity, STATUS_LABELS } from "../pages/tasks-page";
import { openDialog } from "@/lib/dialogs";

function ActivityItem({ activity }: { activity: ActivityDTO }) {
  const Icon = ACTIVITY_ICONS[activity.kind];
  return (
    <div className={cn("space-y-2 rounded-xl border bg-card/60 p-3", !activity.enabled && "opacity-60")}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-snug">{activity.title}</p>
          <p className="text-muted-foreground text-xs">{describeActivity(activity)}</p>
        </div>
        <Switch
          checked={activity.enabled}
          onCheckedChange={(enabled) => api.updateActivity(activity.id, { enabled }).catch((e) => toast.error(e.message))}
          aria-label={activity.enabled ? "Suspendre" : "Reprendre"}
        />
      </div>
      <p className="line-clamp-3 text-muted-foreground text-xs">{activity.instructions}</p>
      {activity.watch && (
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {activity.watch.mode} · {activity.watch.url}
        </p>
      )}
      {activity.webhookUrl && (
        <button
          className="flex w-full items-center gap-1.5 truncate rounded-md bg-muted px-2 py-1 text-left font-mono text-[11px]"
          onClick={() => {
            void navigator.clipboard?.writeText(activity.webhookUrl!);
            toast.success("URL du webhook copiée");
          }}
        >
          <CopyIcon className="size-3 shrink-0" /> <span className="truncate">{activity.webhookUrl}</span>
        </button>
      )}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="flex-1">
          {activity.enabled && activity.nextRunAt
            ? `Prochaine : ${formatDateTime(activity.nextRunAt)}`
            : activity.enabled
              ? ""
              : activity.schedule?.type === "once" && activity.runCount > 0
                ? "Terminée"
                : "Suspendue"}
          {activity.lastRunAt && ` · Dernière : ${relativeTime(activity.lastRunAt)}${activity.lastStatus ? ` (${STATUS_LABELS[activity.lastStatus] ?? activity.lastStatus})` : ""}`}
        </span>
        <Button size="icon" variant="ghost" className="size-6" title="Modifier" onClick={() => openDialog({ kind: "activity", activity })}>
          <PencilIcon className="size-3" />
        </Button>
        <Button size="icon" variant="ghost" className="size-6" title="Exécuter maintenant" onClick={() => api.runActivity(activity.id).then(() => toast.success("Exécution lancée")).catch((e) => toast.error(e.message))}>
          <RotateCwIcon className="size-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          title="Supprimer"
          onClick={() => {
            if (confirm(`Supprimer « ${activity.title} » ?`)) api.deleteActivity(activity.id).catch((e) => toast.error(e.message));
          }}
        >
          <Trash2Icon className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function useReload<T>(load: () => Promise<T>, match: (e: any) => boolean, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(() => {
    load().then(setData).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  useServerEvent((e) => match(e) && reload(), [reload]);
  return data;
}

export function AgentPanel({ agent }: { agent: AgentDTO }) {
  const activities = useReload(() => api.activities(agent.id), (e) => e.type === "activity.changed" && e.agentId === agent.id, [agent.id]);
  const memories = useReload<MemoryDTO[]>(
    async () => [...(await api.memories(agent.id)), ...(await api.sharedMemories())],
    (e) => e.type === "memory.changed",
    [agent.id],
  );
  const journal = useReload<JournalEntryDTO[]>(() => api.journal(agent.id), (e) => e.type === "journal.created", [agent.id]);

  return (
    <Tabs defaultValue="activities" className="flex h-full min-h-0 flex-col gap-0">
      <TabsList className="mx-3 mt-3 grid w-auto grid-cols-4">
        <TabsTrigger value="activities" className="text-xs">Activités</TabsTrigger>
        <TabsTrigger value="memory" className="text-xs">Mémoire</TabsTrigger>
        <TabsTrigger value="journal" className="text-xs">Journal</TabsTrigger>
        <TabsTrigger value="profile" className="text-xs">Profil</TabsTrigger>
      </TabsList>

      <TabsContent value="activities" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {activities?.length === 0 && (
          <Empty
            title="Aucune activité"
            text={`Demande simplement à ${agent.named ? agent.name : "ton compagnon"} : « Tous les vendredis, fais-moi un résumé de mes projets » ou « Préviens-moi si cette page change ».`}
          />
        )}
        {activities?.map((a) => <ActivityItem key={a.id} activity={a} />)}
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => openDialog({ kind: "activity", agentId: agent.id })}>
          <PlusIcon /> Ajouter manuellement
        </Button>
      </TabsContent>

      <TabsContent value="memory" className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {memories?.length === 0 && <Empty title="Mémoire vide" text={`Dis « Souviens-toi que… » et ${agent.named ? agent.name : "ton compagnon"} le retiendra.`} />}
        {memories?.map((m) => (
          <div key={m.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/60">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
            <p className="flex-1 leading-snug">
              {m.content}
              {!m.agentId && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">partagé</span>}
            </p>
            <button
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title="Oublier"
              onClick={() => api.deleteMemory(m.id).catch((e) => toast.error(e.message))}
            >
              <Trash2Icon className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        ))}
      </TabsContent>

      <TabsContent value="journal" className="min-h-0 flex-1 overflow-y-auto p-3">
        {journal?.length === 0 && <Empty title="Rien pour l’instant" text="Les opérations importantes apparaîtront ici." />}
        <ol className="space-y-2">
          {journal?.map((j) => (
            <li key={j.id} className="flex gap-2 text-xs">
              <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{relativeTime(j.createdAt)}</span>
              <span className="flex-1">{j.summary}</span>
            </li>
          ))}
        </ol>
      </TabsContent>

      <TabsContent value="profile" className="min-h-0 flex-1 overflow-y-auto p-3">
        <AgentSettings agent={agent} />
      </TabsContent>
    </Tabs>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-4 text-center">
      <p className="font-medium text-sm">{title}</p>
      <p className="mt-1 text-muted-foreground text-xs">{text}</p>
    </div>
  );
}

