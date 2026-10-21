import { useEffect, useMemo, useState } from "react";
import type { ActivityDTO, ActivitySchedule, ConnectorDTO, MailConfig, WatchMode } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, type ActivityInput } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAYS = [
  { v: "1", l: "L" },
  { v: "2", l: "M" },
  { v: "3", l: "M" },
  { v: "4", l: "J" },
  { v: "5", l: "V" },
  { v: "6", l: "S" },
  { v: "0", l: "D" },
];

type Repeat = "once" | "daily" | "weekdays" | "days" | "interval" | "cron";

interface Draft {
  agentId: string;
  title: string;
  kind: ActivityDTO["kind"];
  instructions: string;
  repeat: Repeat;
  time: string;
  days: string[];
  at: string;
  minutes: number;
  cron: string;
  url: string;
  mode: WatchMode;
  value: string;
  account: string;
  from: string;
  subject: string;
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Traduit un horaire existant vers le formulaire simplifié. */
function fromSchedule(s: ActivitySchedule | null): Partial<Draft> {
  if (!s) return {};
  if (s.type === "once") return { repeat: "once", at: toLocalInput(s.at) };
  if (s.type === "interval") return { repeat: "interval", minutes: s.minutes };
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6](?:,[0-6])*)$/.exec(s.expr.trim());
  if (!m) return { repeat: "cron", cron: s.expr };
  const time = `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  if (m[3] === "*") return { repeat: "daily", time, cron: s.expr };
  if (m[3] === "1-5") return { repeat: "weekdays", time, cron: s.expr };
  return { repeat: "days", time, days: m[3].split(","), cron: s.expr };
}

function toSchedule(d: Draft): ActivitySchedule | null {
  const [h, min] = d.time.split(":").map((x) => Number(x));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  switch (d.repeat) {
    case "once":
      return { type: "once", at: new Date(d.at).toISOString() };
    case "interval":
      return { type: "interval", minutes: Math.max(1, Math.round(d.minutes)) };
    case "daily":
      return { type: "cron", expr: `${min} ${h} * * *`, tz };
    case "weekdays":
      return { type: "cron", expr: `${min} ${h} * * 1-5`, tz };
    case "days":
      return { type: "cron", expr: `${min} ${h} * * ${[...d.days].sort().join(",") || "*"}`, tz };
    case "cron":
      return { type: "cron", expr: d.cron.trim(), tz };
  }
}

/** Création ou modification manuelle d'une tâche planifiée. */
export function ActivityDialog({
  activity,
  agentId,
  onClose,
}: {
  activity?: ActivityDTO;
  agentId?: string;
  onClose: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const [accounts, setAccounts] = useState<ConnectorDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Draft>(() => {
    const inOneHour = toLocalInput(new Date(Date.now() + 3600_000).toISOString());
    return {
      agentId: activity?.agentId ?? agentId ?? agents[0]?.id ?? "",
      title: activity?.title ?? "",
      kind: activity?.kind ?? "schedule",
      instructions: activity?.instructions ?? "",
      repeat: activity?.kind === "watch" ? "interval" : "daily",
      time: "08:00",
      days: ["1", "2", "3", "4", "5"],
      at: inOneHour,
      minutes: 60,
      cron: "0 8 * * *",
      url: activity?.watch?.url ?? "",
      mode: activity?.watch?.mode ?? "changed",
      value: activity?.watch?.value ?? "",
      account: activity?.filter?.connectorId ?? "all",
      from: activity?.filter?.from ?? "",
      subject: activity?.filter?.subject ?? "",
      ...fromSchedule(activity?.schedule ?? null),
    };
  });
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));

  useEffect(() => {
    api.connectors().then((c) => setAccounts(c.filter((x) => x.kind === "mail"))).catch(() => {});
  }, []);

  const scheduleNeeded = d.kind === "schedule" || d.kind === "watch";
  const valid = useMemo(() => {
    if (!d.title.trim() || !d.instructions.trim() || !d.agentId) return false;
    if (d.kind === "watch" && !/^https?:\/\//.test(d.url)) return false;
    if (scheduleNeeded && d.repeat === "days" && !d.days.length) return false;
    return true;
  }, [d, scheduleNeeded]);

  async function save() {
    setBusy(true);
    try {
      const input: ActivityInput = { title: d.title.trim(), kind: d.kind, instructions: d.instructions.trim() };
      if (scheduleNeeded) input.schedule = d.kind === "watch" ? { type: "interval", minutes: Math.max(1, d.minutes) } : toSchedule(d);
      if (d.kind === "watch") input.watch = { url: d.url.trim(), mode: d.mode, value: d.mode === "changed" ? null : d.value };
      if (d.kind === "mail") input.filter = { connectorId: d.account === "all" ? null : d.account, from: d.from || null, subject: d.subject || null };
      if (activity) {
        const { kind: _kind, ...patch } = input;
        await api.updateActivity(activity.id, patch);
        toast.success("Tâche mise à jour");
      } else {
        await api.createActivity({ ...input, agentId: d.agentId });
        toast.success("Tâche créée");
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{activity ? "Modifier la tâche" : "Nouvelle tâche planifiée"}</DialogTitle>
          <DialogDescription>
            {activity ? "Ajustement manuel — tu peux aussi le demander au compagnon." : "Le plus simple reste de le demander au compagnon, mais tu peux aussi la créer ici."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!activity && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Compagnon">
                <Select value={d.agentId} onValueChange={(v) => set({ agentId: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Déclencheur">
                <Select value={d.kind} onValueChange={(v) => set({ kind: v as Draft["kind"], repeat: v === "watch" ? "interval" : d.repeat })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="schedule">Horaire</SelectItem>
                    <SelectItem value="watch">Surveillance d’une page</SelectItem>
                    <SelectItem value="mail">Réception d’un e-mail</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          <Field label="Titre">
            <Input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Point du matin" />
          </Field>
          <Field label="Instructions pour le compagnon">
            <Textarea
              rows={4}
              value={d.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
              placeholder="Ce qu’il doit faire à chaque déclenchement, quand te prévenir, ce qui demande ton accord…"
            />
          </Field>

          {d.kind === "schedule" && (
            <div className="space-y-3 rounded-xl border p-3">
              <Field label="Répétition">
                <Select value={d.repeat} onValueChange={(v) => set({ repeat: v as Repeat })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Une seule fois</SelectItem>
                    <SelectItem value="daily">Tous les jours</SelectItem>
                    <SelectItem value="weekdays">En semaine</SelectItem>
                    <SelectItem value="days">Certains jours</SelectItem>
                    <SelectItem value="interval">À intervalle régulier</SelectItem>
                    <SelectItem value="cron">Expression cron (avancé)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {d.repeat === "once" && (
                <Field label="Date et heure">
                  <Input type="datetime-local" value={d.at} onChange={(e) => set({ at: e.target.value })} />
                </Field>
              )}
              {(d.repeat === "daily" || d.repeat === "weekdays" || d.repeat === "days") && (
                <Field label="Heure">
                  <Input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} className="w-32" />
                </Field>
              )}
              {d.repeat === "days" && (
                <div className="flex gap-1.5">
                  {DAYS.map((day) => {
                    const on = d.days.includes(day.v);
                    return (
                      <button
                        key={day.v}
                        type="button"
                        onClick={() => set({ days: on ? d.days.filter((x) => x !== day.v) : [...d.days, day.v] })}
                        className={cn(
                          "size-8 rounded-full border text-xs font-medium transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                        )}
                      >
                        {day.l}
                      </button>
                    );
                  })}
                </div>
              )}
              {d.repeat === "interval" && <MinutesField value={d.minutes} onChange={(minutes) => set({ minutes })} />}
              {d.repeat === "cron" && (
                <Field label="Expression cron (minute heure jour mois jour-semaine)">
                  <Input value={d.cron} onChange={(e) => set({ cron: e.target.value })} className="font-mono" />
                </Field>
              )}
            </div>
          )}

          {d.kind === "watch" && (
            <div className="space-y-3 rounded-xl border p-3">
              <Field label="Page à surveiller">
                <Input value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Condition">
                  <Select value={d.mode} onValueChange={(v) => set({ mode: v as WatchMode })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="changed">La page change</SelectItem>
                      <SelectItem value="contains">Contient un texte</SelectItem>
                      <SelectItem value="not_contains">Ne contient plus un texte</SelectItem>
                      <SelectItem value="regex">Expression régulière</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {d.mode !== "changed" && (
                  <Field label="Texte">
                    <Input value={d.value} onChange={(e) => set({ value: e.target.value })} />
                  </Field>
                )}
              </div>
              <MinutesField label="Vérifier toutes les" value={d.minutes} onChange={(minutes) => set({ minutes })} />
              <p className="text-muted-foreground text-xs">La vérification ne sollicite pas l’IA : le compagnon n’est réveillé que si la condition est remplie.</p>
            </div>
          )}

          {d.kind === "mail" && (
            <div className="space-y-3 rounded-xl border p-3">
              {accounts.length === 0 && <p className="text-foreground font-medium text-xs">Aucun compte mail connecté pour l’instant.</p>}
              <Field label="Compte">
                <Select value={d.account} onValueChange={(v) => set({ account: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les comptes</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {(a.config as MailConfig).email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expéditeur contient">
                  <Input value={d.from} onChange={(e) => set({ from: e.target.value })} placeholder="venthone.lu" />
                </Field>
                <Field label="Objet contient">
                  <Input value={d.subject} onChange={(e) => set({ subject: e.target.value })} />
                </Field>
              </div>
            </div>
          )}

          {d.kind === "webhook" && !activity && (
            <p className="rounded-xl border p-3 text-muted-foreground text-xs">Une adresse de webhook sera générée après la création.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} disabled={!valid || busy}>
            {activity ? "Enregistrer" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MinutesField({ value, onChange, label = "Toutes les" }: { value: number; onChange: (v: number) => void; label?: string }) {
  const unit = value % 60 === 0 && value >= 60 ? "h" : "min";
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          className="w-24"
          value={unit === "h" ? value / 60 : value}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1) * (unit === "h" ? 60 : 1))}
        />
        <Select value={unit} onValueChange={(u) => onChange(u === "h" ? Math.max(1, Math.round(value / 60)) * 60 : value)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="min">minutes</SelectItem>
            <SelectItem value="h">heures</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Field>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}
