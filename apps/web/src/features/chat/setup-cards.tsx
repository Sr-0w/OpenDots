import { useEffect, useState } from 'react';
import { LoaderIcon, MonitorIcon, PlugIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { openDialog } from '@/lib/dialogs';
import { useServerEvent } from '@/lib/store';
import { Button } from '@/components/ui/button';
import type { ConnectorDTO, IntegrationConfig } from '@opendots/shared';
import { t } from '@/lib/i18n';
import { ServiceLogo } from '../service-logo';

const card = 'not-prose w-full max-w-lg space-y-3 rounded-2xl border bg-card p-4 shadow-xs';
export function ComputerSetupCard({ agentId, reason }: { agentId: string; reason?: string }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.desktop>> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const reload = () => api.desktop(agentId).then(setStatus).catch(e => setError(e.message));
  useEffect(() => { void reload(); }, [agentId]);
  useServerEvent(e => ((e.type === 'agent.updated' && e.agent.id === agentId) || (e.type === 'turn.finished' && e.agentId === agentId)) && void reload(), [agentId]);
  async function start() {
    setBusy(true); setError('');
    try { setStatus(await api.startDesktop(agentId, true)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className={card} aria-label={t('Configurer l’ordinateur')}>
    <div className="flex items-center gap-2"><MonitorIcon className="size-4" /><h3 className="font-medium text-sm">{t('L’ordinateur de ton compagnon')}</h3></div>
    <p className="text-xs text-muted-foreground">{reason ?? t('Active son bureau privé pour travailler avec des applications et des fichiers. Le navigateur s’ouvre seulement à la demande.')}</p>
    <p className="text-xs text-muted-foreground">{t('Ce bouton autorise ce compagnon à utiliser son bureau. Tu peux passer cette étape.')}</p>
    {status?.running && !status.suspended && <p role="status" className="text-sm">{t('Ordinateur démarré')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button size="sm" disabled={busy || Boolean(status?.running && !status.suspended)} onClick={start}>{busy && <LoaderIcon className="animate-spin" />}{busy ? t('Démarrage…') : status?.running && !status.suspended ? t('Ordinateur démarré') : t('Activer et démarrer l’ordinateur')}</Button>
  </section>;
}

export function WelcomeSetupCards({ agentId }: { agentId: string }) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.integrationCatalog>> | null>(null);
  const [connections, setConnections] = useState<ConnectorDTO[]>([]), [error, setError] = useState('');
  const reload = () => api.connectors().then(setConnections).catch(e => setError(e.message));
  useEffect(() => { api.integrationCatalog().then(setCatalog).catch(e => setError(e.message)); void reload(); }, [agentId]);
  useServerEvent(e => e.type === 'connectors.changed' && void reload(), [agentId]);
  return <div className="space-y-3">
    <section className={card} aria-label={t('Connecter tes services')}>
      <div className="flex items-center gap-2"><PlugIcon className="size-4" /><h3 className="font-medium text-sm">{t('Connecter tes services')}</h3></div>
      <p className="text-xs text-muted-foreground">{t('Choisis les services utiles et leurs accès. Tu peux aussi le faire plus tard, en discutant avec ton compagnon.')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!catalog && !error && <LoaderIcon className="size-4 animate-spin" />}
      <div className="divide-y">{catalog?.entries.map(entry => {
        const existing = connections.find(c => c.enabled && c.status === 'ok' && (entry.id === 'imap-smtp' ? c.kind === 'mail' : c.kind === 'integration' && (c.config as IntegrationConfig).provider === entry.id));
        return <div key={entry.id} className="flex items-center justify-between gap-3 py-2"><ServiceLogo provider={entry.id} className="size-8 rounded-lg p-1.5" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{entry.name}</p>{entry.oauth && !catalog.apps.find(a => a.provider === entry.oauth)?.configured && <p className="text-xs text-muted-foreground">{t('Activation par l’administrateur requise')}</p>}</div><Button size="sm" variant="outline" aria-label={`${existing ? t('Gérer') : t('Connecter')} ${entry.name}`} onClick={() => entry.id === 'imap-smtp' ? openDialog({ kind: 'mail', requestedBy: agentId, initialPreset: 'custom', connector: existing }) : openDialog({ kind: 'integration', provider: entry.id, requestedBy: agentId, connector: existing })}>{existing ? t('Gérer') : t('Connecter')}</Button></div>;
      })}</div>
    </section>
    <ComputerSetupCard agentId={agentId} />
  </div>;
}
