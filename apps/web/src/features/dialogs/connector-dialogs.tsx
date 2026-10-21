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

import { t } from "@/lib/i18n";
// --- Compte mail -------------------------------------------------------------

const PRESETS: Record<string, { label: string; imap: MailConfig["imap"]; smtp: MailConfig["smtp"]; hint?: string }> = {
  gmail: {
    label: t("Gmail"),
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    hint: t("Utilise un mot de passe d’application (compte Google → Sécurité → Mots de passe des applications)."),
  },
  outlook: {
    label: t("Outlook / Microsoft 365"),
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    hint: t("IMAP doit être activé sur le compte ; un mot de passe d’application peut être nécessaire."),
  },
  icloud: {
    label: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    hint: t("Crée un mot de passe d’application sur appleid.apple.com."),
  },
  yahoo: {
    label: t("Yahoo"),
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
  infomaniak: {
    label: t("Infomaniak"),
    imap: { host: "mail.infomaniak.com", port: 993, secure: true },
    smtp: { host: "mail.infomaniak.com", port: 465, secure: true },
  },
  custom: { label: t("Autre (IMAP / SMTP)"), imap: { host: "", port: 993, secure: true }, smtp: { host: "", port: 465, secure: true } },
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
export function MailDialog({ connector, requestedBy, initialPreset, onClose }: { initialPreset?: "custom"; connector?: ConnectorDTO; requestedBy?: string; onClose: () => void }) {
  const existing = connector?.config as MailConfig | undefined;
  const [email, setEmail] = useState(existing?.email ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState(existing ? "custom" : initialPreset ?? "gmail");
  const [imap, setImap] = useState(existing?.imap ?? PRESETS[initialPreset ?? "gmail"].imap);
  const [smtp, setSmtp] = useState(existing?.smtp ?? PRESETS[initialPreset ?? "gmail"].smtp);
  const [pollMinutes, setPollMinutes] = useState(existing?.pollMinutes ?? 2);
  const [advanced, setAdvanced] = useState(Boolean(existing) || initialPreset === "custom");
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
        toast.success(t("Compte mis à jour"));
      } else {
        await api.createConnector({ name: email.trim(), kind: "mail", config, secrets: { password }, requestedBy });
        toast.success(t("{v0} est connecté", { v0: email }));
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
          <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-muted text-foreground">
            <MailIcon className="size-4" />
          </div>
          <DialogTitle>{connector ? t("Modifier le compte mail") : t("Connecter une boîte mail")}</DialogTitle>
          <DialogDescription>
            {t("Tes compagnons pourront lire et préparer des réponses. Aucun e-mail n’est envoyé sans ta validation.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label={t("Adresse e-mail")}>
            <Input
              type="email"
              value={email}
              autoFocus
              onChange={(e) => {
                setEmail(e.target.value);
                if (!connector && !advanced) choosePreset(guessPreset(e.target.value));
              }}
              placeholder={t("prenom@exemple.com")}
            />
          </Field>
          <Field label={t("Fournisseur")} hint={PRESETS[preset]?.hint}>
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
          <Field label={connector ? t("Mot de passe (laisser vide pour conserver)") : t("Mot de passe ou mot de passe d’application")}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <button type="button" className="text-muted-foreground text-xs underline-offset-2 hover:underline" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? t("Masquer les réglages avancés") : t("Réglages avancés")}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-xl border p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Nom affiché")}>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </Field>
                <Field label={t("Identifiant")}>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={email} />
                </Field>
              </div>
              <ServerRow label="IMAP" value={imap} onChange={setImap} />
              <ServerRow label="SMTP" value={smtp} onChange={setSmtp} />
              <Field label={t("Relève toutes les (minutes)")}>
                <Input type="number" min={1} className="w-24" value={pollMinutes} onChange={(e) => setPollMinutes(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
            </div>
          )}
          {test && (
            <div className={cn("space-y-1 rounded-xl border p-3 text-xs", test.ok ? "border-foreground/30" : "border-destructive/40")}>
              <Status label={t("Réception (IMAP)")} value={test.imap} />
              <Status label={t("Envoi (SMTP)")} value={test.smtp} />
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheckIcon className="size-3.5" /> {t("Le mot de passe est chiffré sur le serveur et n’est jamais montré aux modèles.")}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={runTest} disabled={!ready || !!busy}>
            {busy === "test" ? <LoaderIcon className="animate-spin" /> : t("Tester")}
          </Button>
          <Button onClick={save} disabled={!ready || !!busy}>
            {busy === "save" ? <LoaderIcon className="animate-spin" /> : connector ? t("Enregistrer") : t("Connecter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServerRow({ label, value, onChange }: { label: string; value: MailConfig["imap"]; onChange: (v: MailConfig["imap"]) => void }) {
  return (
    <div className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
      <Field label={t("Serveur {label}", { label })}>
        <Input value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value })} />
      </Field>
      <Field label={t("Port")}>
        <Input type="number" value={value.port} onChange={(e) => onChange({ ...value, port: Number(e.target.value) })} />
      </Field>
      <label className="flex h-9 items-center gap-1.5 text-xs">
        <Switch checked={value.secure} onCheckedChange={(secure) => onChange({ ...value, secure })} /> {t("SSL")}
      </label>
    </div>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  const ok = value === "ok";
  return (
    <p className="flex items-start gap-1.5">
      {ok ? <CheckCircle2Icon className="size-3.5 shrink-0 text-foreground" /> : <XCircleIcon className="size-3.5 shrink-0 text-destructive" />}
      <span>
        <span className="font-medium">{label}</span> {ok ? t("— connexion réussie") : `— ${value}`}
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
    connector?.secretKeys.map((key) => ({ key, value: "" })) ?? [{ key: transport === "stdio" ? "" : t("Authorization"), value: "" }],
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
      if (res.status === "error") toast.error(t("Connexion impossible : {error}", { error: res.lastError }));
      else toast.success(t("{v0} connecté · {v1} outil(s)", { v0: res.name, v1: res.tools.length }));
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
          <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-muted text-foreground">
            <PlugIcon className="size-4" />
          </div>
          <DialogTitle>{connector ? t("Modifier le connecteur") : t("Ajouter un connecteur MCP")}</DialogTitle>
          <DialogDescription>{t("Donne à tous tes compagnons l’accès aux outils d’un serveur MCP.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("Nom")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("GitHub, Notion, Home Assistant…")} autoFocus />
          </Field>
          <Tabs value={transport} onValueChange={(v) => setTransport(v as McpConfig["transport"])}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="http">{t("HTTP")}</TabsTrigger>
              <TabsTrigger value="sse">{t("SSE")}</TabsTrigger>
              <TabsTrigger value="stdio">Local (stdio)</TabsTrigger>
            </TabsList>
          </Tabs>
          {transport === "stdio" ? (
            <>
              <Field label={t("Commande")}>
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className="font-mono" />
              </Field>
              <Field label={t("Arguments")}>
                <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /path" className="font-mono" />
              </Field>
              <p className="text-foreground font-medium text-[11px]">{t("Cette commande s’exécutera sur ta machine : n’ajoute que des serveurs de confiance.")}</p>
            </>
          ) : (
            <Field label={t("URL du serveur")}>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
            </Field>
          )}
          <Field label={transport === "stdio" ? t("Variables d’environnement secrètes") : t("En-têtes secrets")} hint={t("Chiffrés localement, jamais montrés aux modèles. Vide = valeur conservée.")}>
            <div className="space-y-2">
              {secrets.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={s.key}
                    placeholder={transport === "stdio" ? "API_KEY" : t("Authorization")}
                    className="w-40 font-mono text-xs"
                    onChange={(e) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  />
                  <Input
                    type="password"
                    value={s.value}
                    placeholder={transport === "stdio" ? "valeur" : t("Bearer …")}
                    onChange={(e) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                </div>
              ))}
              <button type="button" className="text-muted-foreground text-xs hover:text-foreground" onClick={() => setSecrets([...secrets, { key: "", value: "" }])}>
                {t("+ Ajouter")}
              </button>
            </div>
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div>
              <p className="font-medium text-sm">{t("Demander ma validation à chaque appel")}</p>
              <p className="text-muted-foreground text-xs">{t("Recommandé pour les outils qui modifient des données.")}</p>
            </div>
            <Switch checked={approval === "ask"} onCheckedChange={(v) => setApproval(v ? "ask" : "auto")} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button onClick={save} disabled={!ready || busy}>
            {busy ? <LoaderIcon className="animate-spin" /> : connector ? t("Enregistrer") : t("Connecter")}
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
      toast.success(t("Plugin « {v0} » installé", { v0: manifest?.name }));
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
          <DialogTitle>{t("Installer un plugin")}</DialogTitle>
          <DialogDescription>{t("Un plugin regroupe des skills et des connecteurs MCP, décrits dans un manifeste JSON.")}</DialogDescription>
        </DialogHeader>
        {!manifest ? (
          <div className="space-y-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as "url" | "json")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="url">{t("Depuis une URL")}</TabsTrigger>
                <TabsTrigger value="json">{t("Coller le manifeste")}</TabsTrigger>
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
                placeholder={'{\n  "name": "My plugin",\n  "skills": [{ "name": "…", "description": "…", "instructions": "…" }],\n  "connectors": [{ "name": "…", "config": { "transport": "http", "url": "…" } }]\n}'}
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
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{t("Skills")}</p>
                {manifest.skills.map((s) => (
                  <p key={s.name} className="text-sm">
                    • <span className="font-medium">{s.name}</span> — <span className="text-muted-foreground">{s.description}</span>
                  </p>
                ))}
              </div>
            )}
            {!!manifest.connectors?.length && (
              <div className="space-y-2">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{t("Connecteurs")}</p>
                {manifest.connectors.map((c) => (
                  <div key={c.name} className="space-y-2 rounded-xl border p-3 text-sm">
                    <p>
                      <span className="font-medium">{c.name}</span>{" "}
                      <span className="font-mono text-muted-foreground text-xs">
                        {c.config.transport === "stdio" ? `${c.config.command} ${(c.config.args ?? []).join(" ")}` : c.config.url}
                      </span>
                    </p>
                    {c.config.transport === "stdio" && <p className="text-foreground font-medium text-[11px]">{t("Exécutera une commande sur ta machine.")}</p>}
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
                {t("Retour")}
              </Button>
              <Button onClick={install} disabled={busy}>
                {busy ? <LoaderIcon className="animate-spin" /> : t("Installer")}
              </Button>
            </>
          ) : (
            <Button onClick={preview} disabled={busy || (mode === "url" ? !url.trim() : !json.trim())}>
              {busy ? <LoaderIcon className="animate-spin" /> : t("Aperçu")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
