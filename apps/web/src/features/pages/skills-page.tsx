import { useCallback, useEffect, useState } from "react";
import { PackageIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import type { SkillDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { openDialog } from "@/lib/dialogs";
import { useServerEvent, useStore } from "@/lib/store";
import { cn, relativeTime } from "@/lib/utils";
import { toast } from "sonner";
import { PageShell } from "./page-shell";

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillDTO[] | null>(null);
  const agents = useStore((s) => s.agents);
  const reload = useCallback(() => {
    api.skills().then(setSkills).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  useServerEvent((e) => e.type === "skills.changed" && reload(), [reload]);

  return (
    <PageShell
      title="Skills"
      description="Des savoir-faire partagés par tous tes compagnons. Chacun charge un skill quand une demande correspond à sa description."
      action={
        <Button size="sm" onClick={() => openDialog({ kind: "skill" })}>
          <PlusIcon /> Nouveau skill
        </Button>
      }
    >
      {skills?.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <SparklesIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="font-medium text-sm">Aucun skill</p>
          <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-xs">
            Après avoir expliqué une méthode à un compagnon, dis-lui simplement « enregistre ça comme skill ». Ou installe un plugin depuis Connecteurs.
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {skills?.map((s) => {
          const author = agents.find((a) => a.id === s.createdBy);
          return (
            <div key={s.id} className={cn("flex flex-col gap-2 rounded-2xl border bg-card/50 p-4", !s.enabled && "opacity-60")}>
              <div className="flex items-start gap-2">
                <SparklesIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
                <p className="min-w-0 flex-1 font-medium text-sm">{s.name}</p>
                <Switch checked={s.enabled} onCheckedChange={(enabled) => api.updateSkill(s.id, { enabled }).catch((e) => toast.error(e.message))} />
              </div>
              <p className="line-clamp-2 flex-1 text-muted-foreground text-xs">{s.description || "Sans description"}</p>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {s.pluginId ? (
                  <span className="flex items-center gap-1">
                    <PackageIcon className="size-3" /> plugin
                  </span>
                ) : (
                  <span>{author ? `par ${author.name}` : "manuel"}</span>
                )}
                <span>· {relativeTime(s.updatedAt)}</span>
                <span className="flex-1" />
                <Button size="icon" variant="ghost" className="size-7" onClick={() => openDialog({ kind: "skill", skill: s })} aria-label="Modifier">
                  <PencilIcon className="size-3.5" />
                </Button>
                {!s.pluginId && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="Supprimer"
                    onClick={() => confirm(`Supprimer le skill « ${s.name} » ?`) && api.deleteSkill(s.id).catch((e) => toast.error(e.message))}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
