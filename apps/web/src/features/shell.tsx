import { useEffect, useMemo, useState } from "react";
import {
  MenuIcon,
  MessagesSquareIcon,
  MoonIcon,
  PanelRightIcon,
  PauseCircleIcon,
  SettingsIcon,
  ShieldQuestionIcon,
  SunIcon,
  WifiOffIcon,
} from "lucide-react";
import { AGENT_STATE_LABELS, type AgentDTO } from "@opendots/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { cn, plainPreview, relativeTime } from "@/lib/utils";
import { ChatView } from "./chat/chat-view";
import { ApprovalCard } from "./chat/approval-card";
import { AgentPanel } from "./panels/agent-panel";
import { DotAvatar } from "./dot-avatar";
import { SettingsDialog } from "./settings-dialog";
import { TeamView } from "./team-view";

type Route = { view: "agent"; id: string | null } | { view: "team" };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "team") return { view: "team" };
  const m = /^agent\/(.+)$/.exec(h);
  return { view: "agent", id: m?.[1] ?? null };
}

function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (r) => (window.location.hash = r.view === "team" ? "/team" : `/agent/${r.id}`)];
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
          <span className="truncate font-medium text-sm">{agent.named ? agent.name : "Nouveau compagnon"}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(agent.lastMessageAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className={cn("truncate text-xs", busy ? "text-foreground/80" : "text-muted-foreground")}>
            {busy ? agent.stateDetail || AGENT_STATE_LABELS[agent.state] : agent.state === "error" ? "Erreur — voir le journal" : plainPreview(agent.lastMessagePreview) || agent.description || "Dis bonjour !"}
          </p>
          {agent.unread > 0 && !active && (
            <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 font-semibold text-[10px] text-white">
              {agent.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Sidebar({ route, go, onSettings, onApprovals }: { route: Route; go: (r: Route) => void; onSettings: () => void; onApprovals: () => void }) {
  const agents = useStore((s) => s.agents);
  const pending = useStore((s) => s.approvals.filter((a) => a.status === "pending").length);
  const paused = useStore((s) => s.paused);
  const connected = useStore((s) => s.connected);
  const { theme, toggle } = useTheme();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex gap-0.5">
          {["#7c9cff", "#ff9fb2", "#7fd6c2"].map((c) => (
            <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <span className="font-semibold tracking-tight">OpenDots</span>
        {!connected && (
          <Tooltip>
            <TooltipTrigger asChild>
              <WifiOffIcon className="ml-auto size-4 text-destructive" />
            </TooltipTrigger>
            <TooltipContent>Connexion au moteur perdue — reconnexion…</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="px-4 pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Compagnons</div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} active={route.view === "agent" && route.id === a.id} onClick={() => go({ view: "agent", id: a.id })} />
        ))}
        {agents.length > 0 && agents.length < 3 && (
          <p className="px-3 pt-3 text-[11px] text-muted-foreground leading-relaxed">
            Pour créer un compagnon, demande-le simplement : « crée un compagnon qui s’occupera de… »
          </p>
        )}
      </nav>

      <div className="space-y-0.5 border-t p-2">
        {paused && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-amber-700 text-xs dark:text-amber-400">
            <PauseCircleIcon className="size-3.5" /> Activités autonomes suspendues
          </div>
        )}
        <SideButton active={route.view === "team"} onClick={() => go({ view: "team" })} icon={<MessagesSquareIcon />}>
          Échanges de l’équipe
        </SideButton>
        <SideButton onClick={onApprovals} icon={<ShieldQuestionIcon />} badge={pending}>
          Validations
        </SideButton>
        <div className="flex items-center gap-1">
          <SideButton onClick={onSettings} icon={<SettingsIcon />} className="flex-1">
            Paramètres
          </SideButton>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={toggle} aria-label="Changer de thème">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
        </div>
      </div>
    </div>
  );
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
      {!!badge && <span className="rounded-full bg-amber-500 px-1.5 font-semibold text-[10px] text-white">{badge}</span>}
    </button>
  );
}

function ApprovalsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const approvals = useStore((s) => s.approvals);
  const agents = useStore((s) => s.agents);
  const pending = approvals.filter((a) => a.status === "pending");
  const recent = approvals.filter((a) => a.status !== "pending").slice(0, 8);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Validations</DialogTitle>
        </DialogHeader>
        {pending.length === 0 && <p className="text-muted-foreground text-sm">Rien n’attend ta validation.</p>}
        <div className="space-y-3">
          {pending.map((a) => (
            <div key={a.id} className="space-y-1.5">
              <p className="text-muted-foreground text-xs">{agents.find((g) => g.id === a.agentId)?.name}</p>
              <ApprovalCard approvalId={a.id} />
            </div>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium text-muted-foreground text-xs">Récemment</p>
            {recent.map((a) => (
              <ApprovalCard key={a.id} approvalId={a.id} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Shell() {
  const agents = useStore((s) => s.agents);
  const [route, go] = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);

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

  const sidebar = <Sidebar route={route} go={navigate} onSettings={() => setSettingsOpen(true)} onApprovals={() => setApprovalsOpen(true)} />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-72 shrink-0 border-r md:block">{sidebar}</aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Menu">
            <MenuIcon />
          </Button>
          {route.view === "team" ? (
            <span className="font-medium">Équipe</span>
          ) : current ? (
            <>
              <DotAvatar color={current.color} state={current.state} size={28} named={current.named} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate font-medium text-sm">{current.named ? current.name : "Nouveau compagnon"}</p>
                <p className="truncate text-muted-foreground text-xs">
                  {current.stateDetail && BUSY.includes(current.state) ? current.stateDetail : AGENT_STATE_LABELS[current.state]}
                  <span className="hidden sm:inline"> · {current.effectiveModel.model}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Panneau du compagnon"
                onClick={() => (window.matchMedia("(min-width: 1024px)").matches ? setPanelOpen((v) => !v) : setMobilePanel(true))}
              >
                <PanelRightIcon />
              </Button>
            </>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1">
          {route.view === "team" ? (
            <TeamView />
          ) : current ? (
            <>
              <ChatView agent={current} />
              {panelOpen && (
                <aside className="hidden w-[340px] shrink-0 border-l lg:block">
                  <AgentPanel agent={current} />
                </aside>
              )}
            </>
          ) : null}
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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ApprovalsDialog open={approvalsOpen} onOpenChange={setApprovalsOpen} />
    </div>
  );
}
