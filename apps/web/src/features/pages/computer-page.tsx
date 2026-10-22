import { useEffect, useRef, useState } from 'react';
import { COMPUTER_ACTION_TYPES, type ComputerActionType, type DesktopPermissions } from '@opendots/shared';
import RFB from '@novnc/novnc';
import { MonitorIcon, MousePointerIcon, LoaderIcon, PowerIcon, RefreshCwIcon } from 'lucide-react';
import { api, type DesktopStatus } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

const ACTION_LABELS: Record<ComputerActionType, string> = { click: 'Clics et doubles-clics', type: 'Saisie de texte', key: 'Touches et raccourcis', scroll: 'Défilement', move: 'Déplacement du pointeur' };
const DEFAULT_DESKTOP_PERMISSIONS: DesktopPermissions = { mode: 'auto', actions: [] };

export function ComputerPage() {
  const agents = useStore((s) => s.agents);
  const [selectedId, setSelectedId] = useState('');
  const agentId = agents.some((agent) => agent.id === selectedId) ? selectedId : agents[0]?.id ?? '';
  const [status, setStatus] = useState<DesktopStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [control, setControl] = useState(false), [connected, setConnected] = useState(false), [revision, setRevision] = useState(0);
  const [permissions, setPermissions] = useState<Record<string, DesktopPermissions>>({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false), [savingPermissions, setSavingPermissions] = useState<string | null>(null);
  const target = useRef<HTMLDivElement>(null), client = useRef<RFB | null>(null);
  useEffect(() => {
    let active = true; setStatus(null); setError('');
    if (agentId) api.desktop(agentId).then((value) => { if (active) setStatus(value); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [agentId]);
  useEffect(() => { api.desktopPermissions().then((value) => { setPermissions(value); setPermissionsLoaded(true); }).catch((e) => setError(e.message)); }, []);
  async function savePermissions(agentId: string, next: DesktopPermissions) {
    const previous = permissions[agentId] ?? DEFAULT_DESKTOP_PERMISSIONS;
    setSavingPermissions(agentId);
    setPermissions((old) => ({ ...old, [agentId]: next }));
    try { const saved = await api.setDesktopPermissions(agentId, next); setPermissions((old) => ({ ...old, [agentId]: saved })); }
    catch (e) { setPermissions((old) => ({ ...old, [agentId]: previous })); toast.error((e as Error).message); }
    finally { setSavingPermissions(null); }
  }
  useEffect(() => {
    if (!status?.running || status.agentId !== agentId || !target.current) return;
    let active = true;
    const url = new URL('/api/computer/vnc', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('agentId', agentId);
    const rfb = new RFB(target.current, url.href, { credentials: { password: status.vncPassword ?? '' } }); client.current = rfb;
    rfb.viewOnly = true; rfb.scaleViewport = true; rfb.resizeSession = false; rfb.background = '#111';
    rfb.addEventListener('connect', () => { if (active) { setConnected(true); setError(''); } });
    rfb.addEventListener('securityfailure', (event) => { if (active) setError((event as CustomEvent<{ reason: string }>).detail.reason || t('Connexion au bureau interrompue.')); });
    rfb.addEventListener('disconnect', () => { if (active) { setConnected(false); setControl(false); setError(t('Connexion au bureau interrompue.')); } });
    return () => { active = false; rfb.disconnect(); client.current = null; setConnected(false); setControl(false); };
  }, [status?.running, status?.agentId, agentId, revision]);
  async function start() {
    setBusy(true); setError('');
    try { setStatus(await api.startDesktop(agentId)); setRevision((v) => v + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { setStatus(await api.stopDesktop(agentId)); setControl(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function takeover() {
    try { await api.desktopControl(agentId, !control); if (client.current) { client.current.viewOnly = control; if (!control) client.current.focus(); } setControl(!control); setStatus((old) => old ? { ...old, manualControl: !control } : old); }
    catch (e) { toast.error((e as Error).message); }
  }
  return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><MonitorIcon className="size-5" />{t('Ordinateur')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('Un conteneur privé par compte, un bureau et un navigateur séparés par compagnon.')}</p></div><div className="flex flex-wrap gap-2">
        {status?.running ? <><Button variant={control ? 'default' : 'outline'} disabled={!connected} onClick={takeover}><MousePointerIcon />{t(control ? 'Rendre la main aux modèles' : 'Prendre la main')}</Button><Button variant="outline" onClick={() => { setError(''); setRevision((v) => v + 1); }}><RefreshCwIcon />{t('Reconnecter')}</Button>{status.manualControl && !control && <Button variant="outline" onClick={() => { void api.desktopControl(agentId, false).then(() => setStatus((old) => old ? { ...old, manualControl: false } : old)).catch((e) => toast.error(e.message)); }}>{t('Autoriser les modèles')}</Button>}<Button variant="outline" disabled={busy} onClick={stop}><PowerIcon />{t('Arrêter le bureau')}</Button></> : <Button disabled={busy || !status?.available || !agentId} onClick={start}>{busy && <LoaderIcon className="animate-spin" />}{t('Démarrer le bureau')}</Button>}
      </div></div>
      {agents.length > 0 && <Select value={agentId} onValueChange={setSelectedId} disabled={busy}><SelectTrigger aria-label={t('Bureau du compagnon')} className="w-full sm:max-w-sm"><SelectValue /></SelectTrigger><SelectContent>{agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}</SelectContent></Select>}
      {error && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      {status && !status.available && <p className="text-sm text-muted-foreground">{t('Docker doit être installé et démarré sur le serveur.')}</p>}
      {busy && <p role="status" className="text-sm text-muted-foreground">{t('Démarrage du bureau. Une session en pause reprend sans relancer le navigateur.')}</p>}
      {status?.running && <><p className="text-xs text-muted-foreground">{t(control ? 'Tu contrôles le bureau. Les captures et actions des modèles sont suspendues.' : status.manualControl ? 'Les modèles sont suspendus. Reprends la main ou autorise-les à nouveau.' : 'Vue seule. Les modèles agissent selon les permissions de chaque compagnon.')}</p><div ref={target} aria-label={t('Bureau distant')} className="h-[min(70vh,800px)] min-h-80 overflow-hidden rounded-xl border bg-black" /></>}
      <section className="space-y-3 rounded-xl border p-4"><h2 className="text-sm font-medium">{t('Accès des compagnons au bureau')}</h2><p className="text-xs text-muted-foreground">{t('Les captures sont envoyées au fournisseur du modèle. Choisis un modèle qui comprend les images. Saisis tes mots de passe directement après avoir pris la main.')}</p>
        <p className="text-xs text-muted-foreground">{t('L’accès au bureau autorise les actions sans confirmation par défaut. Tu peux demander une validation pour tout ou seulement certaines actions.')}</p>
        {agents.map((agent) => {
          const policy = permissions[agent.id] ?? DEFAULT_DESKTOP_PERMISSIONS;
          const disabled = !permissionsLoaded || savingPermissions !== null;
          return <div key={agent.id} className="space-y-3 rounded-lg border p-3" aria-label={`${t('Permissions du bureau')} — ${agent.name}`}>
            <label className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{agent.name}</span><Switch aria-label={`${t('Accès au bureau')} — ${agent.name}`} checked={agent.permissions.computer ?? false} onCheckedChange={(computer) => { void api.updateAgent(agent.id, { permissions: { ...agent.permissions, computer } }).catch((e) => toast.error(e.message)); }} /></label>
            {agent.permissions.computer && <>
              <Select disabled={disabled} value={policy.mode} onValueChange={(mode) => { void savePermissions(agent.id, { ...policy, mode: mode as DesktopPermissions['mode'] }); }}>
                <SelectTrigger aria-label={`${t('Validation des actions')} — ${agent.name}`} className="w-full sm:max-w-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="auto">{t('Toujours autoriser')}</SelectItem><SelectItem value="ask">{t('Toujours demander')}</SelectItem><SelectItem value="custom">{t('Personnalisé')}</SelectItem></SelectContent>
              </Select>
              {policy.mode === 'custom' && <div className="space-y-2"><p className="text-xs text-muted-foreground">{t('Les actions cochées sont autorisées sans confirmation. Les autres demandent une validation.')}</p>{COMPUTER_ACTION_TYPES.map((action) => <label key={action} className="flex items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={policy.actions.includes(action)} onCheckedChange={(checked) => { void savePermissions(agent.id, { ...policy, actions: checked === true ? [...policy.actions, action] : policy.actions.filter((item) => item !== action) }); }} />{t(ACTION_LABELS[action])}</label>)}</div>}
            </>}
          </div>;
        })}
      </section>
    </div>
  </div>;
}
