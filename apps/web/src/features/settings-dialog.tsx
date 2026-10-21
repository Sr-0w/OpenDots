import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import type { ReasoningEffort } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type SettingsDTO } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";
import { ModelPicker } from "./model-picker";
import { ToolsSettings } from "./tools-settings";
import { notificationsEnabled, notificationsSupported, setNotifications } from "@/lib/notify";

import { t } from "@/lib/i18n";
/** Paramètres globaux : volontairement peu nombreux (15.3). */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [key, setKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { theme, setTheme } = useTheme();
  const [notify, setNotify] = useState(notificationsEnabled);

  useEffect(() => {
    if (!open) return;
    api.settings().then((s) => {
      setSettings(s);
      setOllamaUrl(s.ollamaUrl ?? "");
    });
  }, [open]);

  const model = settings?.defaultModel;
  useEffect(() => {
    if (model?.provider === "openrouter" && model.model) api.openrouterEndpoints(model.model).then(setProviders).catch(() => setProviders([]));
  }, [model?.model, model?.provider]);

  async function update(patch: Parameters<typeof api.updateSettings>[0], message = t("Enregistré")) {
    setBusy(true);
    try {
      await api.updateSettings(patch);
      setSettings(await api.settings());
      toast.success(message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("Paramètres")}</DialogTitle>
          <DialogDescription>{t("Le reste se règle en parlant à tes compagnons.")}</DialogDescription>
        </DialogHeader>
        {!settings ? (
          <LoaderIcon className="mx-auto animate-spin" />
        ) : (
          <Tabs defaultValue="models" className="min-h-0 flex-1">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="models">{t("Modèles")}</TabsTrigger>
              <TabsTrigger value="tools">{t("Outils")}</TabsTrigger>
              <TabsTrigger value="connections">{t("Connexions")}</TabsTrigger>
              <TabsTrigger value="general">{t("Général")}</TabsTrigger>
            </TabsList>

            <TabsContent value="tools" className="space-y-6 overflow-y-auto pt-2">
              <ToolsSettings settings={settings} update={update} busy={busy} />
            </TabsContent>

            <TabsContent value="models" className="flex min-h-0 flex-col gap-3 overflow-y-auto pt-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("Modèle par défaut")}</Label>
                <p className="font-mono text-sm">{model?.model}</p>
              </div>
              <ModelPicker
                className="h-64"
                value={model?.model ?? null}
                onChange={(m) =>
                  update({ defaultModel: { provider: m.provider, model: m.id, reasoning: m.reasoning ? (model?.reasoning ?? "medium") : null, providerOrder: null } })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("Raisonnement")}</Label>
                  <Select
                    value={model?.reasoning ?? "default"}
                    onValueChange={(v) => model && update({ defaultModel: { ...model, reasoning: v === "default" ? null : (v as ReasoningEffort) } })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t("Par défaut")}</SelectItem>
                      <SelectItem value="low">{t("Léger")}</SelectItem>
                      <SelectItem value="medium">{t("Moyen")}</SelectItem>
                      <SelectItem value="high">{t("Élevé")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {model?.provider === "openrouter" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("Fournisseur préféré")}</Label>
                    <Select
                      value={model.providerOrder?.[0] ?? "auto"}
                      onValueChange={(v) => update({ defaultModel: { ...model, providerOrder: v === "auto" ? null : [v] } })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">{t("Automatique")}</SelectItem>
                        {providers.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="connections" className="space-y-5 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Clé OpenRouter")}</Label>
                <p className="font-mono text-muted-foreground text-xs">{settings.openrouterKey ?? t("non configurée")}</p>
                <div className="flex gap-2">
                  <Input type="password" placeholder={t("Nouvelle clé sk-or-v1-…")} value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" />
                  <Button disabled={busy || key.length < 10} onClick={() => update({ openrouterKey: key }, t("Clé mise à jour")).then(() => setKey(""))}>
                    {t("Remplacer")}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Ollama (modèles locaux)")}</Label>
                <div className="flex gap-2">
                  <Input placeholder="http://127.0.0.1:11434" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        const models = await api.ollamaModels(ollamaUrl || undefined);
                        await update({ ollamaUrl: ollamaUrl || null }, t("Ollama connecté · {v0} modèle(s)", { v0: models.length }));
                      } catch (e) {
                        toast.error(t("Ollama injoignable : {error}", { error: (e as Error).message }));
                      }
                    }}
                  >
                    {t("Connecter")}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">{t("Ensuite, dis par exemple à un compagnon : « utilise le modèle local llama3.1 ».")}</p>
              </div>
            </TabsContent>

            <TabsContent value="general" className="space-y-4 pt-2">
              <label className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-sm">{t("Suspendre les activités autonomes")}</p>
                  <p className="text-muted-foreground text-xs">{t("Plus aucun réveil automatique jusqu’à la reprise.")}</p>
                </div>
                <Switch checked={settings.paused} onCheckedChange={(paused) => update({ paused }, paused ? t("Activités suspendues") : t("Activités reprises"))} />
              </label>
              {notificationsSupported() && (
                <label className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">{t("Notifications")}</p>
                    <p className="text-muted-foreground text-xs">{t("Messages, validations et questions de tes compagnons quand OpenDots est en arrière-plan.")}</p>
                  </div>
                  <Switch checked={notify} onCheckedChange={async (v) => setNotify(await setNotifications(v))} />
                </label>
              )}
              <label className="flex items-center justify-between gap-4">
                <p className="font-medium text-sm">{t("Thème sombre")}</p>
                <Switch checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
              </label>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Fuseau horaire")}</Label>
                <Input defaultValue={settings.timezone} onBlur={(e) => e.target.value !== settings.timezone && update({ timezone: e.target.value })} />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
