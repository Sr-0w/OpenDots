import { useEffect, useState } from "react";
import { ArchiveIcon, CheckIcon } from "lucide-react";
import type { AgentDTO, AgentPermissions } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { removeAgentLocally } from "@/lib/store";
import { toast } from "sonner";
import { ModelPicker } from "../model-picker";

import { t } from "@/lib/i18n";
const COLORS = ["#2563eb", "#e11d48", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#db2777"];

const PERMS: { key: Exclude<keyof AgentPermissions, "createAgents">; label: string }[] = [
  { key: "web", label: t("Lire des pages web") },
  { key: "manageActivities", label: t("Créer des planifications et surveillances") },
  { key: "messageAgents", label: t("Échanger avec les autres compagnons") },
  { key: "manageMemory", label: t("Gérer sa mémoire") },
  { key: "mail", label: t("Lire les e-mails (l’envoi demande ton accord)") },
  { key: "connectors", label: t("Utiliser les connecteurs MCP") },
  { key: "shell", label: t("Utiliser l’ordinateur (shell)") },
];

/**
 * Paramètres avancés d'un compagnon. Facultatifs : tout ceci peut aussi être
 * demandé directement au compagnon dans la conversation.
 */
export function AgentSettings({ agent }: { agent: AgentDTO }) {
  const [draft, setDraft] = useState({
    name: agent.name,
    description: agent.description,
    personality: agent.personality,
    instructions: agent.instructions,
  });
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setDraft({ name: agent.name, description: agent.description, personality: agent.personality, instructions: agent.instructions });
  }, [agent.id, agent.name, agent.description, agent.personality, agent.instructions]);

  const dirty =
    draft.name !== agent.name ||
    draft.description !== agent.description ||
    draft.personality !== agent.personality ||
    draft.instructions !== agent.instructions;

  async function save(patch: Parameters<typeof api.updateAgent>[1]) {
    try {
      await api.updateAgent(agent.id, patch);
      toast.success(t("Enregistré"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-5 pb-6">
      <p className="rounded-lg bg-muted/60 p-2.5 text-muted-foreground text-xs">
        {t("Astuce : tu peux aussi simplement dire à {name} « sois plus direct » ou « utilise tel modèle ».", { name: agent.name })}
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("Couleur")}</Label>
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => save({ color: c })}
              className="flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition hover:scale-110"
              style={{ background: c, boxShadow: agent.color === c ? `0 0 0 2px ${c}` : undefined }}
              aria-label={c}
            >
              {agent.color === c && <CheckIcon className="size-3 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <Field label={t("Nom")}>
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Field>
      <Field label={t("Responsabilités")}>
        <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      <Field label={t("Personnalité")}>
        <Textarea rows={2} value={draft.personality} onChange={(e) => setDraft({ ...draft, personality: e.target.value })} />
      </Field>
      <Field label={t("Consignes")}>
        <Textarea rows={4} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
      </Field>
      {dirty && (
        <Button size="sm" className="w-full" onClick={() => save(draft)}>
          {t("Enregistrer")}
        </Button>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">{t("Modèle")}</Label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-md border px-2.5 py-1.5 font-mono text-xs">
            {agent.effectiveModel.model}
            {!agent.model && <span className="ml-1 font-sans text-muted-foreground">{t("(par défaut)")}</span>}
          </div>
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            {t("Changer")}
          </Button>
        </div>
        {agent.model && (
          <button className="text-muted-foreground text-xs underline-offset-2 hover:underline" onClick={() => save({ model: null })}>
            {t("Revenir au modèle par défaut")}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("Permissions")}</Label>
        {PERMS.map((p) => (
          <label key={p.key} className="flex items-center justify-between gap-3 text-sm">
            <span>{p.label}</span>
            <Switch checked={agent.permissions[p.key]} onCheckedChange={(v) => save({ permissions: { ...agent.permissions, [p.key]: v } })} />
          </label>
        ))}
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{t("Créer des compagnons")}</span>
          <Select
            value={agent.permissions.createAgents}
            onValueChange={(v) => save({ permissions: { ...agent.permissions, createAgents: v as AgentPermissions["createAgents"] } })}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">{t("Sur demande")}</SelectItem>
              <SelectItem value="allow">{t("Toujours")}</SelectItem>
              <SelectItem value="deny">{t("Jamais")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-destructive hover:text-destructive"
        onClick={async () => {
          if (!confirm(t("Retirer {v0} ? Ses activités seront suspendues.", { v0: agent.name }))) return;
          try {
            await api.archiveAgent(agent.id);
            removeAgentLocally(agent.id);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        <ArchiveIcon /> {t("Retirer ce compagnon")}
      </Button>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="flex h-[70vh] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>{t("Modèle de {name}", { name: agent.name })}</DialogTitle>
          </DialogHeader>
          <ModelPicker
            className="min-h-0 flex-1"
            value={agent.model?.model ?? null}
            onChange={async (m) => {
              await save({ model: { provider: m.provider, model: m.id, reasoning: m.reasoning ? agent.effectiveModel.reasoning ?? "medium" : null } });
              setPicking(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
