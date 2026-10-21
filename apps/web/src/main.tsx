import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BootstrapDTO } from "@opendots/shared";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/api";
import { clearAccountState, connectEvents, loadInitial } from "@/lib/store";
import { Onboarding } from "@/features/onboarding";
import { Shell } from "@/features/shell";
import { AuthPage } from '@/features/auth-page';
import { AccountContext, type Account } from '@/lib/account';
import "./index.css";

import { t } from "@/lib/i18n";
function App() {
  const [boot, setBoot] = useState<BootstrapDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);

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
      .catch((e) => { if (!(e instanceof ApiError && e.status === 401)) setError(e.message); });

  useEffect(() => {
    api.me().then((res) => { setAccount(res.account); setRegistrationOpen(res.registrationOpen); setAuthReady(true); if (res.account) void refresh(); }).catch((e) => setError(e.message));
    const unauthorized = () => { clearAccountState(); setAccount(null); setBoot(null); setError(null); };
    window.addEventListener('opendots:unauthorized', unauthorized);
    return () => window.removeEventListener('opendots:unauthorized', unauthorized);
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
  if (!authReady) return null;
  if (!account) return <AuthPage registrationOpen={registrationOpen} onAuthenticated={(account) => { clearAccountState(); setAccount(account); setError(null); void refresh(); }} />;
  if (!boot) return null;
  return <AccountContext.Provider value={account}>{!boot.onboarded ? <div><ButtonLogout /><Onboarding keyConfigured={boot.openrouterConfigured} onDone={refresh} /></div> : <Shell />}</AccountContext.Provider>;
}

function ButtonLogout() { return <button className="absolute right-4 top-4 text-sm underline" onClick={() => api.logout().then(() => location.reload())}>{t('Se déconnecter')}</button>; }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster position="top-center" />
    </TooltipProvider>
  </StrictMode>,
);
