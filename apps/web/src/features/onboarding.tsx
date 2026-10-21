import { useState } from "react";
import { ArrowRightIcon, ExternalLinkIcon, KeyRoundIcon, LoaderIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ModelInfo } from "@/lib/api";
import { DotAvatar } from "./dot-avatar";
import { ModelPicker } from "./model-picker";

import { t } from "@/lib/i18n";
/**
 * Onboarding volontairement minimal : une clé OpenRouter et un modèle.
 * Tout le reste se fait ensuite en parlant au premier compagnon.
 */
export function Onboarding({ keyConfigured, onDone }: { keyConfigured: boolean; onDone: () => void }) {
  const [step, setStep] = useState<"key" | "model">(keyConfigured ? "model" : "key");
  const [key, setKey] = useState("");
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveKey(key.trim());
      setStep("model");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      await api.completeOnboarding(
        { provider: "openrouter", model: model.id, reasoning: model.reasoning ? "medium" : null },
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <DotAvatar color="#27272a" size={64} named={false} />
          <div className="space-y-1.5">
            <h1 className="font-semibold text-2xl tracking-tight">{t("Bienvenue dans OpenDots")}</h1>
            <p className="text-balance text-muted-foreground text-sm">
              {step === "key"
                ? t("Deux réglages et ton premier compagnon est prêt. Le reste, tu le lui diras simplement.")
                : t("Choisis le modèle qui fera réfléchir ton premier compagnon. Tu pourras en changer à tout moment.")}
            </p>
          </div>
        </div>

        <div className="flex w-full items-center gap-2 text-muted-foreground text-xs">
          <span className={step === "key" ? "font-medium text-foreground" : ""}>{t("1. Clé OpenRouter")}</span>
          <span className="h-px flex-1 bg-border" />
          <span className={step === "model" ? "font-medium text-foreground" : ""}>{t("2. Modèle")}</span>
        </div>

        {step === "key" ? (
          <form onSubmit={submitKey} className="flex w-full flex-col gap-3">
            <div className="relative">
              <KeyRoundIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t("sk-or-v1-…")}
                className="h-11 pl-9 font-mono"
                autoComplete="off"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" size="lg" disabled={busy || key.trim().length < 10}>
              {busy ? <LoaderIcon className="animate-spin" /> : <>{t("Continuer")} <ArrowRightIcon /></>}
            </Button>
            <a
              href="https://openrouter.ai/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            >
              {t("Obtenir une clé sur openrouter.ai")} <ExternalLinkIcon className="size-3" />
            </a>
            <p className="text-center text-[11px] text-muted-foreground">{t("La clé est chiffrée et reste sur ta machine.")}</p>
          </form>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <ModelPicker value={model?.id ?? null} onChange={setModel} className="h-80" />
            {model && !model.tools && (
              <p className="text-foreground font-medium text-xs">{t("Ce modèle ne sait pas utiliser d’outils : ton compagnon pourra parler, mais pas agir.")}</p>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button size="lg" onClick={finish} disabled={busy || !model}>
              {busy ? <LoaderIcon className="animate-spin" /> : <>{t("Rencontrer mon compagnon")} <ArrowRightIcon /></>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
