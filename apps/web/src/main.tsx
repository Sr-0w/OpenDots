import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BootstrapDTO } from "@opendots/shared";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { connectEvents, loadInitial } from "@/lib/store";
import { Onboarding } from "@/features/onboarding";
import { Shell } from "@/features/shell";
import "./index.css";

import { t } from "@/lib/i18n";
function App() {
  const [boot, setBoot] = useState<BootstrapDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api
      .bootstrap()
      .then(async (b) => {
        if (b.onboarded) {
          await loadInitial();
          connectEvents();
        }
        setBoot(b);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    void refresh();
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-medium">{t("Le moteur OpenDots ne répond pas.")}</p>
        <p className="text-muted-foreground text-sm">{error}</p>
        <button className="text-sm underline" onClick={() => location.reload()}>
          {t("Réessayer")}
        </button>
      </div>
    );
  }
  if (!boot) return null;
  if (!boot.onboarded) return <Onboarding keyConfigured={boot.openrouterConfigured} onDone={refresh} />;
  return <Shell />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster position="top-center" />
    </TooltipProvider>
  </StrictMode>,
);
