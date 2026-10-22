import { useEffect, useMemo, useState } from "react";
import {
  MenuIcon,
  PanelRightIcon,
  PauseCircleIcon,
  SettingsIcon,
  WifiOffIcon,
} from "lucide-react";
import { AGENT_STATE_LABELS, type AgentDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { cn, plainPreview, relativeTime } from "@/lib/utils";
import { ChatView } from "./chat/chat-view";
import { AgentPanel } from "./panels/agent-panel";
import { DotAvatar } from "./dot-avatar";
import { SettingsPage, SETTINGS_SECTIONS, type SettingsSection } from "./pages/settings-page";
import { AccountAvatar } from "./account-avatar";
import { lazy, Suspense } from "react";

import { t } from "@/lib/i18n";
import { useAccount } from '@/lib/account';
// Pages et modales secondaires chargées à la demande.
const DialogHost = lazy(() => import("./dialogs/dialog-host").then((m) => ({ default: m.DialogHost })));

type Route = { view: "agent"; id: string | null } | { view: "settings"; section: SettingsSection };
const LEGACY_PAGES = ['team', 'tasks', 'skills', 'connectors', 'computer', 'approvals'];
function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (LEGACY_PAGES.includes(h)) return { view: 'settings', section: h as SettingsSection };
  if (h === 'settings' || h.startsWith('settings/')) {
    const section = h.split('/')[1];
    return { view: 'settings', section: SETTINGS_SECTIONS.includes(section as SettingsSection) ? section as SettingsSection : 'general' };
  }
  const match = /^agent\/(.+)$/.exec(h);
  return { view: 'agent', id: match?.[1] ?? null };
}
function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => { const on = () => setRoute(parseHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return [route, next => { window.location.hash = next.view === 'agent' ? `/agent/${next.id}` : `/settings/${next.section}`; }];
}

const BUSY = ["thinking", "working", "collaborating", "awake"];

function AgentRow({ agent, active, onClick }: { agent: AgentDTO; active: boolean; onClick: () => void }) {
  const busy = BUSY.includes(agent.state);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent/70",
        active && "bg-accent",
      )}
    >
      <DotAvatar color={agent.color} state={agent.state} size={34} named={agent.named} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{agent.named ? agent.name : t("Nouveau compagnon")}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(agent.lastMessageAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className={cn("truncate text-xs", busy ? "text-foreground/80" : "text-muted-foreground")}>
            {busy ? agent.stateDetail || t(AGENT_STATE_LABELS[agent.state]) : agent.state === "error" ? t("Erreur — voir le journal") : plainPreview(agent.lastMessagePreview) || agent.description || t("Dis bonjour !")}
          </p>
          {agent.unread > 0 && !active && (
            <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-foreground px-1 font-semibold text-[10px] text-background">
              {agent.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Sidebar({ route, go }: { route: Route; go: (r: Route) => void }) {
  const agents = useStore((s) => s.agents);
  const pending = useStore((s) => s.approvals.filter((a) => a.status === "pending").length);
  const paused = useStore((s) => s.paused);
  const connected = useStore((s) => s.connected);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex gap-0.5">
          {["bg-foreground", "bg-foreground/55", "bg-foreground/25"].map((c) => (
            <span key={c} className={`size-2.5 rounded-full ${c}`} />
          ))}
        </div>
        <span className="font-semibold tracking-tight">{t("OpenDots")}</span>
        {!connected && (
          <Tooltip>
            <TooltipTrigger asChild>
              <WifiOffIcon className="ml-auto size-4 text-destructive" />
            </TooltipTrigger>
            <TooltipContent>{t("Connexion au moteur perdue — reconnexion…")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="px-4 pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">{t("Compagnons")}</div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} active={route.view === "agent" && route.id === a.id} onClick={() => go({ view: "agent", id: a.id })} />
        ))}
      </nav>

      <div className="space-y-0.5 border-t p-2">
        {paused && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-foreground text-xs">
            <PauseCircleIcon className="size-3.5" /> {t("Activités autonomes suspendues")}
          </div>
        )}
        <SideButton active={route.view === 'settings'} onClick={() => go({ view: 'settings', section: 'general' })} icon={<SettingsIcon />} badge={pending}>{t('Paramètres')}</SideButton>
        <AccountFooter onClick={() => go({ view: 'settings', section: 'general' })} />
      </div>
    </div>
  );
}

function AccountFooter({ onClick }: { onClick: () => void }) {
  const account = useAccount();
  return account ? <button onClick={onClick} aria-label={t('Mon compte')} className="mt-2 flex w-full min-w-0 items-center gap-2.5 rounded-xl border-t px-2 py-3 text-left hover:bg-accent"><AccountAvatar /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{account.profile?.name ?? account.email}</span><span className="block truncate text-[11px] text-muted-foreground">{account.profile?.name ? account.email : t('Compte personnel')}</span></span></button> : null;
}

function SideButton({
  children,
  icon,
  onClick,
  active,
  badge,
  className,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  badge?: number;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4",
        active && "bg-accent text-foreground",
        className,
      )}
    >
      {icon}
      <span className="flex-1 text-left">{children}</span>
      {!!badge && <span className="rounded-full bg-foreground px-1.5 font-semibold text-[10px] text-background">{badge}</span>}
    </button>
  );
}

export function Shell() {
  const agents = useStore((s) => s.agents);
  const [route, go] = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [mobilePanel, setMobilePanel] = useState(false);

  const current = useMemo(() => {
    if (route.view !== "agent") return null;
    return agents.find((a) => a.id === route.id) ?? agents[0] ?? null;
  }, [agents, route]);

  // Nouveau compagnon créé depuis la conversation : il apparaît simplement dans la liste.
  useEffect(() => {
    if (route.view === "agent" && !route.id && agents[0]) go({ view: "agent", id: agents[0].id });
  }, [route, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = (r: Route) => {
    go(r);
    setNavOpen(false);
  };

  const sidebar = <Sidebar route={route} go={navigate} />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-72 shrink-0 border-r md:block">{sidebar}</aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetTitle className="sr-only">{t("Navigation")}</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setNavOpen(true)} aria-label={t("Menu")}>
            <MenuIcon />
          </Button>
          {route.view !== "agent" ? (
            <span className="font-medium">{t("Paramètres")}</span>
          ) : current ? (
            <>
              <DotAvatar color={current.color} state={current.state} size={28} named={current.named} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate font-medium text-sm">{current.named ? current.name : t("Nouveau compagnon")}</p>
                <p className="truncate text-muted-foreground text-xs">
                  {current.stateDetail && BUSY.includes(current.state) ? current.stateDetail : t(AGENT_STATE_LABELS[current.state])}
                  <span className="hidden sm:inline"> · {current.effectiveModel.model}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Panneau du compagnon")}
                onClick={() => (window.matchMedia("(min-width: 1024px)").matches ? setPanelOpen((v) => !v) : setMobilePanel(true))}
              >
                <PanelRightIcon />
              </Button>
            </>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1">
          <Suspense fallback={<div className="flex-1" />}>
          {route.view === 'settings' ? (
            <SettingsPage section={route.section} onSectionChange={section => navigate({ view: 'settings', section })} />          ) : current ? (
            <>
              <ChatView agent={current} />
              {panelOpen && (
                <aside className="hidden w-[340px] shrink-0 border-l lg:block">
                  <AgentPanel agent={current} />
                </aside>
              )}
            </>
          ) : null}
          </Suspense>
        </div>
      </main>

      {current && (
        <Sheet open={mobilePanel} onOpenChange={setMobilePanel}>
          <SheetContent side="right" className="w-[92vw] max-w-sm p-0">
            <SheetTitle className="sr-only">{current.name}</SheetTitle>
            <AgentPanel agent={current} />
          </SheetContent>
        </Sheet>
      )}
      <Suspense fallback={null}>
        <DialogHost />
      </Suspense>
    </div>
  );
}
