import { useEffect, useState } from "react";
import { MonitorIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, type ComputerStatus, type SettingsDTO } from "@/lib/api";
import { toast } from "sonner";

type Update = (patch: Parameters<typeof api.updateSettings>[0], message?: string) => Promise<void>;

/** Réglages des outils partagés : recherche web et ordinateur des compagnons. */
export function ToolsSettings({ settings, update, busy }: { settings: SettingsDTO; update: Update; busy: boolean }) {
  const [provider, setProvider] = useState(settings.search.provider);
  const [apiKey, setApiKey] = useState("");
  const [url, setUrl] = useState(settings.search.url ?? "");
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [image, setImage] = useState(settings.shell.image);

  const refresh = () => api.computer().then(setStatus).catch(() => {});
  useEffect(() => {
    void refresh();
  }, [settings.shell.mode, settings.shell.network, settings.shell.image]);

  const needsKey = provider === "brave" || provider === "tavily";
  const shell = settings.shell;

  return (
    <>
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium text-sm">
          <SearchIcon className="size-4" /> Recherche web
        </h3>
        <div className="space-y-1.5">
          <Label className="text-xs">Moteur</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatique (DuckDuckGo, puis Bing)</SelectItem>
              <SelectItem value="duckduckgo">DuckDuckGo (sans clé)</SelectItem>
              <SelectItem value="bing">Bing (sans clé)</SelectItem>
              <SelectItem value="brave">Brave Search (clé API)</SelectItem>
              <SelectItem value="tavily">Tavily (clé API)</SelectItem>
              <SelectItem value="searxng">SearXNG (instance personnelle)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {needsKey && (
          <Input
            type="password"
            placeholder={settings.search.hasKey && settings.search.provider === provider ? "Clé enregistrée — laisser vide pour la conserver" : "Clé API"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        )}
        {provider === "searxng" && <Input placeholder="https://searx.exemple.com" value={url} onChange={(e) => setUrl(e.target.value)} />}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || (provider === "searxng" && !url)}
          onClick={() => update({ search: { provider, apiKey: apiKey || undefined, url: url || null } }, "Recherche web mise à jour").then(() => setApiKey(""))}
        >
          Enregistrer
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium text-sm">
          <MonitorIcon className="size-4" /> Ordinateur des compagnons
        </h3>
        <p className="text-muted-foreground text-xs">
          Un shell Linux partagé : chaque compagnon a son utilisateur et son dossier, plus un dossier commun. Avec Docker, tout s’exécute dans un conteneur isolé.
        </p>
        {status && (
          <div className="rounded-xl border p-3 text-xs">
            <p>
              <span className="text-muted-foreground">État : </span>
              {status.backend === "docker"
                ? `conteneur ${status.container?.running ? "démarré" : "prêt à démarrer"} (${status.container?.image ?? shell.image})`
                : status.backend === "host"
                  ? "machine hôte (sans isolation)"
                  : "désactivé"}
            </p>
            <p>
              <span className="text-muted-foreground">Docker : </span>
              {status.dockerAvailable ? "disponible" : "indisponible"}
            </p>
            <p>
              <span className="text-muted-foreground">Validation : </span>
              {status.approvalRequired ? "chaque commande" : "aucune"}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Exécution</Label>
            <Select value={shell.mode} onValueChange={(mode) => update({ shell: { mode: mode as typeof shell.mode } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatique</SelectItem>
                <SelectItem value="docker">Conteneur Docker</SelectItem>
                <SelectItem value="host">Machine hôte</SelectItem>
                <SelectItem value="off">Désactivé</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Validation des commandes</Label>
            <Select value={shell.approval} onValueChange={(approval) => update({ shell: { approval: approval as typeof shell.approval } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Selon l’isolation</SelectItem>
                <SelectItem value="ask">Toujours demander</SelectItem>
                <SelectItem value="auto">Ne jamais demander</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Accès Internet depuis le conteneur</p>
            <p className="text-muted-foreground text-xs">Nécessaire pour installer des paquets ou appeler des API.</p>
          </div>
          <Switch checked={shell.network} onCheckedChange={(network) => update({ shell: { network } })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Autoriser l’administration (sudo)</p>
            <p className="text-muted-foreground text-xs">Les compagnons pourront installer des paquets système dans le conteneur.</p>
          </div>
          <Switch checked={shell.sudo} onCheckedChange={(sudo) => update({ shell: { sudo } })} />
        </label>
        <div className="flex gap-2">
          <Input value={image} onChange={(e) => setImage(e.target.value)} className="font-mono text-xs" />
          <Button size="sm" variant="outline" disabled={busy || image === shell.image} onClick={() => update({ shell: { image } }, "Image mise à jour")}>
            Utiliser
          </Button>
        </div>
        {status?.dockerAvailable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!confirm("Réinitialiser le conteneur ? Les programmes installés seront perdus, les dossiers des compagnons sont conservés.")) return;
              try {
                setStatus(await api.resetComputer());
                toast.success("Ordinateur réinitialisé");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <RotateCcwIcon /> Réinitialiser le conteneur
          </Button>
        )}
      </section>
    </>
  );
}
