import { useEffect, useState } from "react";
import { MonitorIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, type ComputerStatus, type SettingsDTO } from "@/lib/api";
import { toast } from "sonner";

import { t } from "@/lib/i18n";
type Update = (patch: Parameters<typeof api.updateSettings>[0], message?: string) => Promise<void>;

/** Réglages des outils partagés : recherche web et ordinateur des compagnons. */
export function ToolsSettings({ settings, update, busy }: { settings: SettingsDTO; update: Update; busy: boolean }) {
  const [provider, setProvider] = useState(settings.search.provider);
  const [url, setUrl] = useState(settings.search.url ?? "");
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [image, setImage] = useState(settings.shell.image);

  const refresh = () => api.computer().then(setStatus).catch(() => {});
  useEffect(() => {
    void refresh();
  }, [settings.shell.mode, settings.shell.network, settings.shell.image]);

  const shell = settings.shell;

  return (
    <>
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium text-sm">
          <SearchIcon className="size-4" /> {t("Recherche web")}
        </h3>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("Moteur")}</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("SearXNG intégré (local, sans compte)")}</SelectItem>
              <SelectItem value="mwmbl">{t("Mwmbl (libre, sans compte)")}</SelectItem>
              <SelectItem value="searxng">{t("SearXNG (instance personnelle)")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground text-xs">{t("SearXNG démarre automatiquement en local avec Docker et interroge des moteurs web externes. Sans Docker, choisis Mwmbl, dont l’index est plus limité. Aucun compte ni clé ne sont nécessaires.")}</p>
        {provider === "searxng" && <Input placeholder="https://searx.example.com" value={url} onChange={(e) => setUrl(e.target.value)} />}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || (provider === "searxng" && !url.trim())}
          onClick={() => update({ search: { provider, url: url.trim() || null } }, t("Recherche web mise à jour"))}
        >
          {t("Enregistrer")}
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium text-sm">
          <MonitorIcon className="size-4" /> {t("Ordinateur des compagnons")}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t("Un shell Linux partagé : chaque compagnon a son utilisateur et son dossier, plus un dossier commun. Avec Docker, tout s’exécute dans un conteneur isolé.")}
        </p>
        {status && (
          <div className="rounded-xl border p-3 text-xs">
            <p>
              <span className="text-muted-foreground">{t("État :")} </span>
              {status.backend === "docker"
                ? t(status.container?.running ? "conteneur démarré ({image})" : "conteneur prêt à démarrer ({image})", { image: status.container?.image ?? shell.image })
                : status.backend === "host"
                  ? t("machine hôte (sans isolation)")
                  : t("désactivé")}
            </p>
            <p>
              <span className="text-muted-foreground">{t("Docker :")} </span>
              {status.dockerAvailable ? "disponible" : "indisponible"}
            </p>
            <p>
              <span className="text-muted-foreground">{t("Validation :")} </span>
              {status.approvalRequired ? t("chaque commande") : t("aucune")}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Exécution")}</Label>
            <Select value={shell.mode} onValueChange={(mode) => update({ shell: { mode: mode as typeof shell.mode } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("Automatique")}</SelectItem>
                <SelectItem value="docker">{t("Conteneur Docker")}</SelectItem>
                <SelectItem value="host">{t("Machine hôte")}</SelectItem>
                <SelectItem value="off">{t("Désactivé")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Validation des commandes")}</Label>
            <Select value={shell.approval} onValueChange={(approval) => update({ shell: { approval: approval as typeof shell.approval } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("Selon l’isolation")}</SelectItem>
                <SelectItem value="ask">{t("Toujours demander")}</SelectItem>
                <SelectItem value="auto">{t("Ne jamais demander")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">{t("Accès Internet depuis le conteneur")}</p>
            <p className="text-muted-foreground text-xs">{t("Nécessaire pour installer des paquets ou appeler des API.")}</p>
          </div>
          <Switch checked={shell.network} onCheckedChange={(network) => update({ shell: { network } })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">{t("Autoriser l’administration (sudo)")}</p>
            <p className="text-muted-foreground text-xs">{t("Les compagnons pourront installer des paquets système dans le conteneur.")}</p>
          </div>
          <Switch checked={shell.sudo} onCheckedChange={(sudo) => update({ shell: { sudo } })} />
        </label>
        <div className="flex gap-2">
          <Input value={image} onChange={(e) => setImage(e.target.value)} className="font-mono text-xs" />
          <Button size="sm" variant="outline" disabled={busy || image === shell.image} onClick={() => update({ shell: { image } }, t("Image mise à jour"))}>
            {t("Utiliser")}
          </Button>
        </div>
        {status?.dockerAvailable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!confirm(t("Réinitialiser le conteneur ? Les programmes installés seront perdus, les dossiers des compagnons sont conservés."))) return;
              try {
                setStatus(await api.resetComputer());
                toast.success(t("Ordinateur réinitialisé"));
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <RotateCcwIcon /> {t("Réinitialiser le conteneur")}
          </Button>
        )}
      </section>
    </>
  );
}
