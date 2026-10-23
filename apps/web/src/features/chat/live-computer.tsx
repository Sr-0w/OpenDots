import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { LoaderIcon, MonitorIcon } from 'lucide-react';
import { api, type DesktopStatus } from '@/lib/api';
import { useStore } from '@/lib/store';
import { t } from '@/lib/i18n';
import { remotePointer } from '../pages/remote-pointer';

/** One read-only RFB feed for the active turn; never starts or takes over a PC. */
export function LiveComputer({ agentId }: { agentId: string }) {
  const name = useStore(s => s.agents.find(a => a.id === agentId)?.name ?? '');
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [connected, setConnected] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true, pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try { const next = await api.desktop(agentId); if (active) { setStatus(next); setError(''); } }
      catch { if (active) { setStatus(null); setError(t('Bureau indisponible')); } }
      finally { pending = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { active = false; clearInterval(timer); };
  }, [agentId]);
  useEffect(() => {
    if (!status?.running || !status.enabled || status.agentId !== agentId || !target.current) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const url = new URL('/api/computer/vnc', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('agentId', agentId);
    const rfb = new RFB(target.current, url.href, { credentials: { password: status.vncPassword ?? '' } });
    rfb.viewOnly = true; rfb.scaleViewport = true; rfb.resizeSession = false; rfb.background = '#111';
    const pointer = remotePointer(target.current, rfb, status.width, status.height);
    rfb.addEventListener('connect', () => { if (active) { setConnected(true); setError(''); } });
    rfb.addEventListener('disconnect', () => {
      pointer.remove();
      if (active) { setConnected(false); setError(t('Reconnexion au bureau…')); retry = setTimeout(() => setRevision(v => v+1), 2000); }
    });
    return () => { active = false; clearTimeout(retry); pointer.remove(); rfb.disconnect(); setConnected(false); };
  }, [agentId, status?.running, status?.enabled, status?.agentId, status?.vncPassword, revision]);
  return <section aria-label={t('Ordinateur en direct')} data-live-computer={agentId} className="not-prose overflow-hidden rounded-xl border bg-card">
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground"><MonitorIcon className="size-3.5" /><span className="min-w-0 flex-1 truncate">{t('Ordinateur en direct')}{name && ` · ${name}`}</span><span>{t('Vue seule')}</span>{!connected && <LoaderIcon className="size-3.5 animate-spin" />}</div>
    <div ref={target} aria-label={t('Bureau en direct')} className="pointer-events-none relative aspect-[8/5] w-full overflow-hidden bg-black" />
    {!connected && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{error || t(status?.enabled === false ? 'Bureau indisponible' : 'Connexion au bureau…')}</p>}
  </section>;
}
