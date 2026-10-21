import { useCallback, useEffect, useState } from "react";
import { MailIcon, MoreHorizontalIcon, PackageIcon, PencilIcon, PlugIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import type { ConnectorDTO, MailConfig, McpConfig, PluginDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { openDialog } from "@/lib/dialogs";
import { useServerEvent } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageShell } from "./page-shell";
import { IntegrationCatalog } from '../integration-catalog';
import { useAccount } from '@/lib/account';

import { t } from "@/lib/i18n";
export function ConnectorsPage() {
  const account = useAccount();
  const [connectors, setConnectors] = useState<ConnectorDTO[] | null>(null);
  const [plugins, setPlugins] = useState<PluginDTO[]>([]);
  const reload = useCallback(() => {
    api.connectors().then(setConnectors).catch(() => {});
    api.plugins().then(setPlugins).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  useServerEvent((e) => (e.type === "connectors.changed" || e.type === "skills.changed") && reload(), [reload]);

  const mail = connectors?.filter((c) => c.kind === "mail") ?? [];
  const mcp = connectors?.filter((c) => c.kind === "mcp") ?? [];

  return (
    <PageShell
      title={t("Connecteurs")}
      description={t("Les services que tes compagnons peuvent utiliser. Partagés par toute l’équipe ; les actions sensibles demandent toujours ta validation.")}
    >
      <IntegrationCatalog connectors={connectors ?? []} />
      <Section
        icon={<MailIcon className="size-4" />}
        title={t("Comptes mail")}
        hint={t("Lecture, relève automatique et réponses préparées — l’envoi attend ton accord.")}
        action={
          <Button size="sm" variant="outline" onClick={() => openDialog({ kind: "mail" })}>
            <PlusIcon /> {t("Ajouter")}
          </Button>
        }
      >
        {connectors && !mail.length && <Empty text={t("Aucune boîte mail connectée.")} />}
        {mail.map((c) => (
          <ConnectorRow key={c.id} connector={c} subtitle={(c.config as MailConfig).email} />
        ))}
      </Section>

      {account?.role === 'admin' && <Section
        icon={<PlugIcon className="size-4" />}
        title={t("Serveurs MCP")}
        hint={t("Des outils supplémentaires (GitHub, Notion, Home Assistant, fichiers…) via le Model Context Protocol.")}
        action={
          <Button size="sm" variant="outline" onClick={() => openDialog({ kind: "mcp" })}>
            <PlusIcon /> {t("Ajouter")}
          </Button>
        }
      >
        {connectors && !mcp.length && <Empty text={t("Aucun serveur MCP.")} />}
        {mcp.map((c) => {
          const cfg = c.config as McpConfig;
          return <ConnectorRow key={c.id} connector={c} subtitle={cfg.transport === "stdio" ? `${cfg.command} ${(cfg.args ?? []).join(" ")}` : (cfg.url ?? "")} />;
        })}
      </Section>}

      <Section
        icon={<PackageIcon className="size-4" />}
        title={t("Plugins")}
        hint={t("Paquets de skills et de connecteurs installés ensemble.")}
        action={
          <Button size="sm" variant="outline" onClick={() => openDialog({ kind: "plugin" })}>
            <PlusIcon /> {t("Installer")}
          </Button>
        }
      >
        {!plugins.length && <Empty text={t("Aucun plugin installé.")} />}
        {plugins.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3">
            <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">
                {p.name} <span className="text-muted-foreground text-xs">{p.version}</span>
              </p>
              <p className="truncate text-muted-foreground text-xs">
                {p.description || t("{v0} skill(s) · {v1} connecteur(s)", { v0: p.skills, v1: p.connectors })}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => confirm(t("Désinstaller « {v0} » et ses skills/connecteurs ?", { v0: p.name })) && api.uninstallPlugin(p.id).catch((e) => toast.error(e.message))}
            >
              {t("Désinstaller")}
            </Button>
          </div>
        ))}
      </Section>
    </PageShell>
  );
}

function Section({ icon, title, hint, action, children }: { icon: React.ReactNode; title: string; hint: string; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-medium text-sm">
            {icon} {title}
          </h2>
          <p className="text-muted-foreground text-xs">{hint}</p>
        </div>
        {action}
      </div>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card/50">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-5 text-center text-muted-foreground text-sm">{text}</p>;
}

function ConnectorRow({ connector: c, subtitle }: { connector: ConnectorDTO; subtitle: string }) {
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const res = await api.refreshConnector(c.id);
      if (res.status === "error") toast.error(res.lastError ?? t("Erreur"));
      else toast.success(c.kind === "mail" ? t(res.newMessages ? "Relève effectuée · {n} nouveau(x)" : "Relève effectuée", { n: res.newMessages }) : t("{n} outil(s) disponibles", { n: res.tools.length }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", !c.enabled && "opacity-60")}>
      <span
        className={cn("size-2 shrink-0 rounded-full", c.status === "ok" ? "bg-foreground" : c.status === "error" ? "bg-red-500" : "bg-muted-foreground/40")}
        title={c.status === "error" ? (c.lastError ?? "") : c.status}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">
          {c.name}
          {c.pluginId && <span className="ml-1.5 rounded bg-muted px-1 font-normal text-[10px] text-muted-foreground">plugin</span>}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{subtitle}</p>
        {c.status === "error" && c.lastError && <p className="truncate text-[11px] text-destructive">{c.lastError}</p>}
        {c.kind === "mcp" && c.status === "ok" && (
          <p className="truncate text-[11px] text-muted-foreground">
            {t("{n} outil(s) :", { n: c.tools.length })} {c.tools.map((tool) => tool.name).join(", ")} · {c.approval === "ask" ? t("validation à chaque appel") : t("sans validation")}
          </p>
        )}
      </div>
      <Switch
        checked={c.enabled}
        onCheckedChange={(enabled) => api.updateConnector(c.id, { enabled }).catch((e) => toast.error(e.message))}
        aria-label={t("Activer")}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" aria-label={t("Actions")} disabled={busy}>
            {busy ? <RefreshCwIcon className="animate-spin" /> : <MoreHorizontalIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={refresh}>
            <RefreshCwIcon /> {c.kind === "mail" ? t("Relever maintenant") : t("Reconnecter")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog({ kind: c.kind === 'mail' ? 'mail' : 'mcp', connector: c })}>
            <PencilIcon /> {t("Modifier")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => confirm(t("Supprimer « {v0} » ?", { v0: c.name })) && api.deleteConnector(c.id).catch((e) => toast.error(e.message))}>
            <Trash2Icon /> {t("Supprimer")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
