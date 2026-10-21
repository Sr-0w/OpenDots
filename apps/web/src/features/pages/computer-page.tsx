import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { MonitorIcon, MousePointerIcon, LoaderIcon, PowerIcon, RefreshCwIcon } from 'lucide-react';
import { api, type DesktopStatus } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

export function ComputerPage() {
  const agents = useStore((s) => s.agents);
  const [status, setStatus] = useState<DesktopStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [control, setControl] = useState(false), [connected, setConnected] = useState(false), [revision, setRevision] = useState(0);
  const target = useRef<HTMLDivElement>(null), client = useRef<RFB | null>(null);
  useEffect(() => { api.desktop().then(setStatus).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!status?.running || !target.current) return;
    let active = true;
    const url = new URL('/api/computer/vnc', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const rfb = new RFB(target.current, url.href); client.current = rfb;
    rfb.viewOnly = true; rfb.scaleViewport = true; rfb.resizeSession = false; rfb.background = '#111';
    rfb.addEventListener('connect', () => { if (active) { setConnected(true); setError(''); } });
    rfb.addEventListener('disconnect', () => { if (active) { setConnected(false); setControl(false); setError(t('Connexion au bureau interrompue.')); } });
    return () => { active = false; rfb.disconnect(); client.current = null; setConnected(false); setControl(false); };
  }, [status?.running, revision]);
  async function start() {
    setBusy(true); setError('');
    try { setStatus(await api.startDesktop()); setRevision((v) => v + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { setStatus(await api.stopDesktop()); setControl(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function takeover() {
    try { await api.desktopControl(!control); if (client.current) { client.current.viewOnly = control; if (!control) client.current.focus(); } setControl(!control); setStatus((old) => old ? { ...old, manualControl: !control } : old); }
    catch (e) { toast.error((e as Error).message); }
  }
  return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><MonitorIcon className="size-5" />{t('Ordinateur')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('Un bureau Linux privé avec Chromium, réservé à ton compte.')}</p></div><div className="flex flex-wrap gap-2">
        {status?.running ? <><Button variant={control ? 'default' : 'outline'} disabled={!connected} onClick={takeover}><MousePointerIcon />{t(control ? 'Rendre la main aux modèles' : 'Prendre la main')}</Button><Button variant="outline" onClick={() => { setError(''); setRevision((v) => v + 1); }}><RefreshCwIcon />{t('Reconnecter')}</Button>{status.manualControl && !control && <Button variant="outline" onClick={() => { void api.desktopControl(false).then(() => setStatus((old) => old ? { ...old, manualControl: false } : old)).catch((e) => toast.error(e.message)); }}>{t('Autoriser les modèles')}</Button>}<Button variant="outline" disabled={busy} onClick={stop}><PowerIcon />{t('Arrêter le bureau')}</Button></> : <Button disabled={busy || !status?.available} onClick={start}>{busy && <LoaderIcon className="animate-spin" />}{t('Démarrer le bureau')}</Button>}
      </div></div>
      {error && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      {status && !status.available && <p className="text-sm text-muted-foreground">{t('Docker doit être installé et démarré sur le serveur.')}</p>}
      {busy && <p role="status" className="text-sm text-muted-foreground">{t('Le premier démarrage construit l’image du bureau et peut prendre plusieurs minutes.')}</p>}
      {status?.running && <><p className="text-xs text-muted-foreground">{t(control ? 'Tu contrôles le bureau. Les captures et actions des modèles sont suspendues.' : status.manualControl ? 'Les modèles sont suspendus. Reprends la main ou autorise-les à nouveau.' : 'Vue seule. Chaque action des modèles attend une validation humaine.')}</p><div ref={target} aria-label={t('Bureau distant')} className="h-[min(70vh,800px)] min-h-80 overflow-hidden rounded-xl border bg-black" /></>}
      <section className="space-y-3 rounded-xl border p-4"><h2 className="text-sm font-medium">{t('Accès des compagnons au bureau')}</h2><p className="text-xs text-muted-foreground">{t('Les captures sont envoyées au fournisseur du modèle. Choisis un modèle qui comprend les images. Saisis tes mots de passe directement après avoir pris la main.')}</p>
        {agents.map((agent) => <label key={agent.id} className="flex items-center justify-between gap-3 rounded-lg py-2"><span className="text-sm">{agent.name}</span><Switch aria-label={`${t('Accès au bureau')} — ${agent.name}`} checked={agent.permissions.computer ?? false} onCheckedChange={(computer) => { void api.updateAgent(agent.id, { permissions: { ...agent.permissions, computer } }).catch((e) => toast.error(e.message)); }} /></label>)}
      </section>
    </div>
  </div>;
}
