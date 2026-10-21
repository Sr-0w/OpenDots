import { useState } from "react";
import { CheckCircle2Icon, LoaderIcon, MailIcon, PlugIcon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import type { ConnectorDTO, MailConfig, McpConfig, PluginManifest } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Field } from "./activity-dialog";

// --- Compte mail -------------------------------------------------------------

const PRESETS: Record<string, { label: string; imap: MailConfig["imap"]; smtp: MailConfig["smtp"]; hint?: string }> = {
  gmail: {
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    hint: "Utilise un mot de passe d’application (compte Google → Sécurité → Mots de passe des applications).",
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    hint: "IMAP doit être activé sur le compte ; un mot de passe d’application peut être nécessaire.",
  },
  icloud: {
    label: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    hint: "Crée un mot de passe d’application sur appleid.apple.com.",
  },
  yahoo: {
    label: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
  infomaniak: {
    label: "Infomaniak",
    imap: { host: "mail.infomaniak.com", port: 993, secure: true },
    smtp: { host: "mail.infomaniak.com", port: 465, secure: true },
  },
  custom: { label: "Autre (IMAP / SMTP)", imap: { host: "", port: 993, secure: true }, smtp: { host: "", port: 465, secure: true } },
};

function guessPreset(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (/gmail\.com|googlemail\.com/.test(domain)) return "gmail";
  if (/outlook|hotmail|live\.|msn\.com|office365/.test(domain)) return "outlook";
  if (/icloud|me\.com|mac\.com/.test(domain)) return "icloud";
  if (/yahoo/.test(domain)) return "yahoo";
  if (/ik\.me|infomaniak/.test(domain)) return "infomaniak";
  return "custom";
}

/** Connexion d'un compte mail. Le mot de passe va directement au moteur, chiffré. */
export function MailDialog({ connector, requestedBy, onClose }: { connector?: ConnectorDTO; requestedBy?: string; onClose: () => void }) {
  const existing = connector?.config as MailConfig | undefined;
  const [email, setEmail] = useState(existing?.email ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState(existing ? "custom" : "gmail");
  const [imap, setImap] = useState(existing?.imap ?? PRESETS.gmail.imap);
  const [smtp, setSmtp] = useState(existing?.smtp ?? PRESETS.gmail.smtp);
  const [pollMinutes, setPollMinutes] = useState(existing?.pollMinutes ?? 2);
  const [advanced, setAdvanced] = useState(Boolean(existing));
  const [test, setTest] = useState<{ ok: boolean; imap: string; smtp: string } | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  const config: MailConfig = { email: email.trim(), displayName: displayName.trim() || undefined, username: (username || email).trim(), imap, smtp, pollMinutes };
  const ready = /.+@.+\..+/.test(email) && imap.host && smtp.host && (password || connector);

  function choosePreset(p: string) {
    setPreset(p);
    setImap(PRESETS[p].imap);
    setSmtp(PRESETS[p].smtp);
    if (p === "custom") setAdvanced(true);
  }

  async function runTest() {
    setBusy("test");
    try {
      setTest(await api.testMail(config, password, connector?.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      if (connector) {
        await api.updateConnector(connector.id, { config, secrets: password ? { password } : undefined, name: email });
        toast.success("Compte mis à jour");
      } else {
        await api.createConnector({ name: email.trim(), kind: "mail", config, secrets: { password }, requestedBy });
        toast.success(`${email} est connecté`);
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-brand/15 text-brand">
            <MailIcon className="size-4" />
          </div>
          <DialogTitle>{connector ? "Modifier le compte mail" : "Connecter une boîte mail"}</DialogTitle>
          <DialogDescription>
            Tes compagnons pourront lire et préparer des réponses. Aucun e-mail n’est envoyé sans ta validation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Adresse e-mail">
            <Input
              type="email"
              value={email}
              autoFocus
              onChange={(e) => {
                setEmail(e.target.value);
                if (!connector && !advanced) choosePreset(guessPreset(e.target.value));
              }}
              placeholder="prenom@exemple.com"
            />
          </Field>
          <Field label="Fournisseur" hint={PRESETS[preset]?.hint}>
            <Select value={preset} onValueChange={choosePreset}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <SelectItem key={k} value={k}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={connector ? "Mot de passe (laisser vide pour conserver)" : "Mot de passe ou mot de passe d’application"}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <button type="button" className="text-muted-foreground text-xs underline-offset-2 hover:underline" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "Masquer les réglages avancés" : "Réglages avancés"}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-xl border p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nom affiché">
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </Field>
                <Field label="Identifiant">
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={email} />
                </Field>
              </div>
              <ServerRow label="IMAP" value={imap} onChange={setImap} />
              <ServerRow label="SMTP" value={smtp} onChange={setSmtp} />
              <Field label="Relève toutes les (minutes)">
                <Input type="number" min={1} className="w-24" value={pollMinutes} onChange={(e) => setPollMinutes(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
            </div>
          )}
          {test && (
            <div className={cn("space-y-1 rounded-xl border p-3 text-xs", test.ok ? "border-emerald-500/40" : "border-destructive/40")}>
              <Status label="Réception (IMAP)" value={test.imap} />
              <Status label="Envoi (SMTP)" value={test.smtp} />
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheckIcon className="size-3.5" /> Le mot de passe est chiffré sur ta machine et n’est jamais montré aux modèles.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={runTest} disabled={!ready || !!busy}>
            {busy === "test" ? <LoaderIcon className="animate-spin" /> : "Tester"}
          </Button>
          <Button onClick={save} disabled={!ready || !!busy}>
            {busy === "save" ? <LoaderIcon className="animate-spin" /> : connector ? "Enregistrer" : "Connecter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServerRow({ label, value, onChange }: { label: string; value: MailConfig["imap"]; onChange: (v: MailConfig["imap"]) => void }) {
  return (
    <div className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
      <Field label={`Serveur ${label}`}>
        <Input value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value })} />
      </Field>
      <Field label="Port">
        <Input type="number" value={value.port} onChange={(e) => onChange({ ...value, port: Number(e.target.value) })} />
      </Field>
      <label className="flex h-9 items-center gap-1.5 text-xs">
        <Switch checked={value.secure} onCheckedChange={(secure) => onChange({ ...value, secure })} /> SSL
      </label>
    </div>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  const ok = value === "ok";
  return (
    <p className="flex items-start gap-1.5">
      {ok ? <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" /> : <XCircleIcon className="size-3.5 shrink-0 text-destructive" />}
      <span>
        <span className="font-medium">{label}</span> {ok ? "— connexion réussie" : `— ${value}`}
      </span>
    </p>
  );
}

// --- Connecteur MCP --------------------------------------------------------------

type SecretRow = { key: string; value: string };

export function McpDialog({ connector, requestedBy, onClose }: { connector?: ConnectorDTO; requestedBy?: string; onClose: () => void }) {
  const cfg = connector?.config as McpConfig | undefined;
  const [name, setName] = useState(connector?.name ?? "");
  const [transport, setTransport] = useState<McpConfig["transport"]>(cfg?.transport ?? "http");
  const [url, setUrl] = useState(cfg?.url ?? "");
  const [command, setCommand] = useState(cfg?.command ?? "");
  const [args, setArgs] = useState((cfg?.args ?? []).join(" "));
  const [approval, setApproval] = useState<"ask" | "auto">(connector?.approval ?? "ask");
  const [secrets, setSecrets] = useState<SecretRow[]>(
    connector?.secretKeys.map((key) => ({ key, value: "" })) ?? [{ key: transport === "stdio" ? "" : "Authorization", value: "" }],
  );
  const [busy, setBusy] = useState(false);

  const config: McpConfig =
    transport === "stdio" ? { transport, command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [] } : { transport, url: url.trim() };
  const ready = name.trim() && (transport === "stdio" ? command.trim() : /^https?:\/\//.test(url));

  async function save() {
    setBusy(true);
    try {
      const secretMap = Object.fromEntries(secrets.filter((s) => s.key.trim()).map((s) => [s.key.trim(), s.value]));
      const res = connector
        ? await api.updateConnector(connector.id, { name, config, approval, secrets: secretMap })
        : await api.createConnector({ name: name.trim(), kind: "mcp", config, approval, secrets: secretMap, requestedBy });
      if (res.status === "error") toast.error(`Connexion impossible : ${res.lastError}`);
      else toast.success(`${res.name} connecté · ${res.tools.length} outil(s)`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-brand/15 text-brand">
            <PlugIcon className="size-4" />
          </div>
          <DialogTitle>{connector ? "Modifier le connecteur" : "Ajouter un connecteur MCP"}</DialogTitle>
          <DialogDescription>Donne à tous tes compagnons l’accès aux outils d’un serveur MCP.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Nom">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GitHub, Notion, Home Assistant…" autoFocus />
          </Field>
          <Tabs value={transport} onValueChange={(v) => setTransport(v as McpConfig["transport"])}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="http">HTTP</TabsTrigger>
              <TabsTrigger value="sse">SSE</TabsTrigger>
              <TabsTrigger value="stdio">Local (stdio)</TabsTrigger>
            </TabsList>
          </Tabs>
          {transport === "stdio" ? (
            <>
              <Field label="Commande">
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className="font-mono" />
              </Field>
              <Field label="Arguments">
                <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /chemin" className="font-mono" />
              </Field>
              <p className="text-amber-600 text-[11px]">Cette commande s’exécutera sur ta machine : n’ajoute que des serveurs de confiance.</p>
            </>
          ) : (
            <Field label="URL du serveur">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://exemple.com/mcp" />
            </Field>
          )}
          <Field label={transport === "stdio" ? "Variables d’environnement secrètes" : "En-têtes secrets"} hint="Chiffrés localement, jamais montrés aux modèles. Vide = valeur conservée.">
            <div className="space-y-2">
              {secrets.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={s.key}
                    placeholder={transport === "stdio" ? "API_KEY" : "Authorization"}
                    className="w-40 font-mono text-xs"
                    onChange={(e) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  />
                  <Input
                    type="password"
                    value={s.value}
                    placeholder={transport === "stdio" ? "valeur" : "Bearer …"}
                    onChange={(e) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                </div>
              ))}
              <button type="button" className="text-muted-foreground text-xs hover:text-foreground" onClick={() => setSecrets([...secrets, { key: "", value: "" }])}>
                + Ajouter
              </button>
            </div>
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div>
              <p className="font-medium text-sm">Demander ma validation à chaque appel</p>
              <p className="text-muted-foreground text-xs">Recommandé pour les outils qui modifient des données.</p>
            </div>
            <Switch checked={approval === "ask"} onCheckedChange={(v) => setApproval(v ? "ask" : "auto")} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} disabled={!ready || busy}>
            {busy ? <LoaderIcon className="animate-spin" /> : connector ? "Enregistrer" : "Connecter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Plugin ----------------------------------------------------------------------

export function PluginDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"url" | "json">("url");
  const [url, setUrl] = useState("");
  const [json, setJson] = useState("");
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [secrets, setSecrets] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const source = () => (mode === "url" ? { url: url.trim() } : { manifest: json });

  async function preview() {
    setBusy(true);
    try {
      setManifest(await api.previewPlugin(source()));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    setBusy(true);
    try {
      await api.installPlugin({ ...source(), secrets });
      toast.success(`Plugin « ${manifest?.name} » installé`);
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
          <DialogTitle>Installer un plugin</DialogTitle>
          <DialogDescription>Un plugin regroupe des skills et des connecteurs MCP, décrits dans un manifeste JSON.</DialogDescription>
        </DialogHeader>
        {!manifest ? (
          <div className="space-y-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as "url" | "json")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="url">Depuis une URL</TabsTrigger>
                <TabsTrigger value="json">Coller le manifeste</TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === "url" ? (
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/opendots-plugin.json" />
            ) : (
              <Textarea
                rows={10}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                className="font-mono text-xs"
                placeholder={'{\n  "name": "Mon plugin",\n  "skills": [{ "name": "…", "description": "…", "instructions": "…" }],\n  "connectors": [{ "name": "…", "config": { "transport": "http", "url": "…" } }]\n}'}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="font-medium">
                {manifest.name} <span className="text-muted-foreground text-xs">{manifest.version}</span>
              </p>
              {manifest.description && <p className="text-muted-foreground text-sm">{manifest.description}</p>}
            </div>
            {!!manifest.skills?.length && (
              <div className="space-y-1">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Skills</p>
                {manifest.skills.map((s) => (
                  <p key={s.name} className="text-sm">
                    • <span className="font-medium">{s.name}</span> — <span className="text-muted-foreground">{s.description}</span>
                  </p>
                ))}
              </div>
            )}
            {!!manifest.connectors?.length && (
              <div className="space-y-2">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Connecteurs</p>
                {manifest.connectors.map((c) => (
                  <div key={c.name} className="space-y-2 rounded-xl border p-3 text-sm">
                    <p>
                      <span className="font-medium">{c.name}</span>{" "}
                      <span className="font-mono text-muted-foreground text-xs">
                        {c.config.transport === "stdio" ? `${c.config.command} ${(c.config.args ?? []).join(" ")}` : c.config.url}
                      </span>
                    </p>
                    {c.config.transport === "stdio" && <p className="text-amber-600 text-[11px]">Exécutera une commande sur ta machine.</p>}
                    {(c.secrets ?? []).map((key) => (
                      <Input
                        key={key}
                        type="password"
                        placeholder={key}
                        value={secrets[c.name]?.[key] ?? ""}
                        onChange={(e) => setSecrets({ ...secrets, [c.name]: { ...secrets[c.name], [key]: e.target.value } })}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {manifest ? (
            <>
              <Button variant="ghost" onClick={() => setManifest(null)}>
                Retour
              </Button>
              <Button onClick={install} disabled={busy}>
                {busy ? <LoaderIcon className="animate-spin" /> : "Installer"}
              </Button>
            </>
          ) : (
            <Button onClick={preview} disabled={busy || (mode === "url" ? !url.trim() : !json.trim())}>
              {busy ? <LoaderIcon className="animate-spin" /> : "Aperçu"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
