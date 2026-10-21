import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import type { MailDraftDTO, SkillDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { closeDialog, useDialog } from "@/lib/dialogs";
import { toast } from "sonner";
import { ActivityDialog, Field } from "./activity-dialog";
import { McpDialog, MailDialog, PluginDialog } from "./connector-dialogs";

import { t } from "@/lib/i18n";
import { IntegrationConnectDialog } from '../integration-catalog';
/** Point de montage unique des modales globales. */
export function DialogHost() {
  const d = useDialog();
  if (!d) return null;
  switch (d.kind) {
    case 'integration': return <IntegrationConnectDialog requestedBy={d.requestedBy} provider={d.provider} connector={d.connector} onClose={closeDialog} />;
    case "mail":
      return <MailDialog initialPreset={d.initialPreset} connector={d.connector} requestedBy={d.requestedBy} onClose={closeDialog} />;
    case "mcp":
      return <McpDialog connector={d.connector} requestedBy={d.requestedBy} onClose={closeDialog} />;
    case "plugin":
      return <PluginDialog onClose={closeDialog} />;
    case "skill":
      return <SkillDialog skill={d.skill} onClose={closeDialog} />;
    case "activity":
      return <ActivityDialog activity={d.activity} agentId={d.agentId} onClose={closeDialog} />;
    case "draft":
      return <DraftDialog draftId={d.draftId} onClose={closeDialog} />;
  }
}

function SkillDialog({ skill, onClose }: { skill?: SkillDTO; onClose: () => void }) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      if (skill) await api.updateSkill(skill.id, { name, description, instructions });
      else await api.createSkill({ name, description, instructions });
      toast.success(t("Skill enregistré"));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{skill ? t("Modifier le skill") : t("Nouveau skill")}</DialogTitle>
          <DialogDescription>
            {t("Un savoir-faire réutilisable par tous les compagnons. Tu peux aussi dire « enregistre ça comme skill » dans une conversation.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("Nom")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Compte rendu de réunion")} autoFocus />
          </Field>
          <Field label={t("Quand l’utiliser")} hint={t("C’est ce que les compagnons voient pour décider de charger le skill.")}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Quand on me demande de résumer une réunion")} />
          </Field>
          <Field label={t("Instructions")}>
            <Textarea rows={12} value={instructions} onChange={(e) => setInstructions(e.target.value)} className="font-mono text-xs" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button onClick={save} disabled={busy || !name.trim() || !instructions.trim()}>
            {t("Enregistrer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftDialog({ draftId, onClose }: { draftId: string; onClose: () => void }) {
  const [draft, setDraft] = useState<MailDraftDTO | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.draft(draftId).then((d) => {
      setDraft(d);
      setTo(d.to.join(", "));
      setCc(d.cc.join(", "));
      setSubject(d.subject);
      setBody(d.body);
    });
  }, [draftId]);

  const split = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);

  async function save() {
    setBusy(true);
    try {
      await api.updateDraft(draftId, { to: split(to), cc: split(cc), subject, body });
      toast.success(t("Brouillon modifié — il reste à l’envoyer"));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Modifier l’e-mail")}</DialogTitle>
          <DialogDescription>{draft ? `De ${draft.from}` : " "}</DialogDescription>
        </DialogHeader>
        {!draft ? (
          <LoaderIcon className="mx-auto animate-spin" />
        ) : (
          <div className="space-y-3">
            <Field label={t("À")}>
              <Input value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label={t("Cc")}>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} />
            </Field>
            <Field label={t("Objet")}>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label={t("Message")}>
              <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button onClick={save} disabled={busy || !draft || draft.status !== "pending"}>
            {t("Enregistrer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
