import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, CheckIcon, FileIcon, GitBranchIcon, LoaderIcon, MailIcon, SearchIcon, ShieldCheckIcon, UnplugIcon } from 'lucide-react';
import type { ConnectorDTO, IntegrationCatalogEntry, IntegrationConfig, IntegrationProvider, OAuthAppDTO, OAuthProvider } from '@opendots/shared';
import { api } from '@/lib/api';
import { useAccount } from '@/lib/account';
import { openDialog } from '@/lib/dialogs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

function ServiceIcon({ entry }: { entry: Pick<IntegrationCatalogEntry, 'id' | 'category'> }) {
  const Icon = entry.category === 'mail' ? MailIcon : entry.category === 'calendar' ? CalendarIcon : entry.category === 'development' ? GitBranchIcon : FileIcon;
  const colors: Record<string, string> = { gmail: 'bg-red-500/10 text-red-500', 'google-drive': 'bg-green-500/10 text-green-600', 'google-calendar': 'bg-blue-500/10 text-blue-500', outlook: 'bg-sky-500/10 text-sky-500', github: 'bg-muted text-foreground', 'imap-smtp': 'bg-muted text-foreground' };
  return <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${colors[entry.id]}`}><Icon className="size-5" /></span>;
}

export function IntegrationCatalog({ connectors }: { connectors: ConnectorDTO[] }) {
  const account = useAccount();
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.integrationCatalog>> | null>(null);
  const [query, setQuery] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<OAuthAppDTO | null>(null);
  const reload = () => api.integrationCatalog().then(setCatalog).catch((e) => setFailure(e.message));
  useEffect(() => { void reload(); }, []);
  const connections = connectors.filter((c) => c.kind === 'integration');
  const entries = catalog?.entries.filter((entry) => `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  async function test(id: string) {
    setBusy(id); try { await api.testIntegration(id); toast.success(t('Connexion vérifiée auprès du fournisseur.')); } catch (error) { toast.error((error as Error).message); } finally { setBusy(null); }
  }
  async function disconnect(c: ConnectorDTO) {
    if (!confirm(t('Déconnecter ce compte d’OpenDots ? Ses jetons seront supprimés localement.'))) return;
    setBusy(c.id);
    try { const res = await api.disconnectIntegration(c.id); if (res.warning) toast.message(res.warning); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(null); }
  }
  return <section className="mb-9 space-y-5">
    <div className="flex items-center gap-2 rounded-xl border px-3"><SearchIcon className="size-4 shrink-0 text-muted-foreground" /><Input className="border-0 shadow-none focus-visible:ring-0" aria-label={t('Rechercher un service')} placeholder={t('Rechercher un service…')} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    {connections.length > 0 && <div className="space-y-2"><h2 className="text-sm font-medium">{t('Connectés')}</h2><div className="divide-y rounded-2xl border">
      {connections.map((c) => {
        const cfg = c.config as IntegrationConfig, entry = catalog?.entries.find((v) => v.id === cfg.provider);
        return <div key={c.id} className="flex flex-wrap items-center gap-3 p-4">
          {entry && <ServiceIcon entry={entry} />}<div className="min-w-0 flex-1"><p className="truncate font-medium text-sm">{entry?.name ?? c.name}</p><p className="truncate text-xs text-muted-foreground">{cfg.account.email ?? cfg.account.label}</p><p className={`mt-1 text-xs ${c.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{c.lastError ?? (c.enabled ? t('Connecté — permissions sélectionnées uniquement') : t('Désactivé'))}</p></div>
          <Switch aria-label={t('Activer')} checked={c.enabled} disabled={busy === c.id} onCheckedChange={(enabled) => api.updateConnector(c.id, { enabled }).catch((e) => toast.error(e.message))} />
          <Button size="sm" variant="outline" disabled={busy === c.id || !c.enabled} onClick={() => test(c.id)}>{busy === c.id ? <LoaderIcon className="animate-spin" /> : <ShieldCheckIcon />}{t('Tester')}</Button>
          <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'integration', provider: cfg.provider, connector: c })}>{t('Permissions / reconnecter')}</Button>
          <Button size="icon" variant="ghost" aria-label={t('Déconnecter')} disabled={busy === c.id} onClick={() => disconnect(c)}><UnplugIcon /></Button>
        </div>;
      })}
    </div></div>}
    <div className="space-y-3"><h2 className="text-sm font-medium">{t('Services prêts à connecter')}</h2>
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      {!catalog && !failure && <LoaderIcon className="animate-spin" />}
      {catalog && !entries.length && <p className="text-sm text-muted-foreground">{t('Aucun service correspondant.')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{entries.map((entry) => {
        const app = catalog?.apps.find((v) => v.provider === entry.oauth), connected = connections.some((c) => (c.config as IntegrationConfig).provider === entry.id);
        return <div key={entry.id} className="flex items-start gap-3 rounded-2xl border p-4"><ServiceIcon entry={entry} /><div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{entry.name}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>{entry.oauth && !app?.configured && <p className="mt-2 text-xs text-muted-foreground">{t('Configuration initiale par l’administrateur requise.')}</p>}<Button className="mt-3" size="sm" variant="outline" disabled={Boolean(entry.oauth && !app?.configured)} onClick={() => entry.id === 'imap-smtp' ? openDialog({ kind: 'mail', initialPreset: 'custom' }) : openDialog({ kind: 'integration', provider: entry.id })}>{connected && <CheckIcon />}{t(connected ? 'Ajouter un compte' : 'Connecter')}</Button></div></div>;
      })}</div>
    </div>
    {account?.role === 'admin' && <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">{t('Applications OAuth du déploiement')}</summary><p className="my-3 text-xs text-muted-foreground">{t('Configuration unique pour tous les utilisateurs. Ils ne voient ni le client secret ni cette configuration. Enregistre les URL de retour exactes chez les fournisseurs.')}</p><div className="space-y-2">{catalog?.apps.map((app) => <div key={app.provider} className="flex flex-wrap items-center gap-2"><span className="min-w-24 text-sm capitalize">{app.provider}</span><span className="flex-1 text-xs text-muted-foreground">{t(app.configured ? 'Application configurée' : 'À configurer')}</span><Button size="sm" variant="outline" disabled={app.source === 'environment'} onClick={() => setEditing(app)}>{t('Configurer')}</Button><code className="w-full break-all text-[11px] text-muted-foreground">{app.callbackUrl}</code></div>)}</div></details>}
    {editing && <OAuthAppDialog app={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
  </section>;
}

function OAuthAppDialog({ app, onClose, onSaved }: { app: OAuthAppDTO; onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = useState(app.clientId), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const docs: Record<OAuthProvider, string> = { google: 'https://console.cloud.google.com/apis/credentials', microsoft: 'https://entra.microsoft.com/', github: 'https://github.com/settings/developers' };
  async function save(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api.saveOAuthApp(app.provider, clientId, secret || undefined); setSecret(''); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Dialog open onOpenChange={(v) => !v && onClose()}><DialogContent><DialogHeader><DialogTitle>{t('Application OAuth')} — {app.provider}</DialogTitle><DialogDescription>{t('Seul l’administrateur du déploiement effectue ce réglage. Le secret reste chiffré sur le serveur.')}</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><a className="text-sm underline" href={docs[app.provider]} target="_blank" rel="noreferrer">{t('Ouvrir la console du fournisseur')}</a><div className="space-y-1"><Label htmlFor="oauth-return">{t('URL de retour à enregistrer')}</Label><Input id="oauth-return" readOnly value={app.callbackUrl} onFocus={(e) => e.target.select()} /></div><div className="space-y-1"><Label htmlFor="oauth-client">Client ID</Label><Input id="oauth-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required autoComplete="off" /></div><div className="space-y-1"><Label htmlFor="oauth-secret">Client secret</Label><Input id="oauth-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={app.hasSecret && app.clientId === clientId ? t('Laisser vide pour conserver le secret') : ''} required={!app.hasSecret || app.clientId !== clientId} autoComplete="new-password" /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy} type="submit">{busy && <LoaderIcon className="animate-spin" />}{t('Enregistrer')}</Button></form></DialogContent></Dialog>;
}

export function IntegrationConnectDialog({ provider, connector, requestedBy, onClose }: { requestedBy?: string; provider?: IntegrationProvider; connector?: ConnectorDTO; onClose: () => void }) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.integrationCatalog>> | null>(null), [selectedProvider, setProvider] = useState(provider), [permissions, setPermissions] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const popup = useRef<Window | null>(null), timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const entry = catalog?.entries.find((s) => s.id === selectedProvider);
  useEffect(() => { api.integrationCatalog().then(setCatalog).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (entry) setPermissions(connector ? (connector.config as IntegrationConfig).permissions : entry.permissions.filter((p) => p.default).map((p) => p.id)); }, [entry?.id]);
  useEffect(() => {
    function done(event: MessageEvent) { if (event.origin === location.origin && event.source === popup.current && event.data?.type === 'opendots:oauth' && event.data.ok) { toast.success(t('Compte connecté.')); onClose(); } }
    window.addEventListener('message', done);
    return () => { window.removeEventListener('message', done); if (timer.current) clearInterval(timer.current); };
  }, [onClose]);
  async function connect() {
    if (!selectedProvider) return;
    setError('');
    popup.current = window.open('about:blank', `opendots-oauth-${selectedProvider}`, 'popup,width=620,height=760');
    if (!popup.current) { setError(t('Autorise les fenêtres de connexion pour ce site.')); return; }
    setBusy(true);
    try {
      const res = await api.startOAuth(selectedProvider, permissions, connector?.id, requestedBy);
      popup.current.location.href = res.url;
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => { if (!popup.current || popup.current.closed) { setBusy(false); if (timer.current) clearInterval(timer.current); } }, 700);
    } catch (e) { popup.current.close(); setBusy(false); setError((e as Error).message); }
  }
  const configured = catalog?.apps.find((a) => a.provider === entry?.oauth)?.configured;
  return <Dialog open onOpenChange={(v) => !v && !busy && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{entry ? `${t('Connecter')} ${entry.name}` : t('Choisir un service')}</DialogTitle><DialogDescription>{t('Choisis les accès accordés. Les jetons restent chiffrés sur le serveur ; les envois et modifications attendront toujours ta validation.')}</DialogDescription></DialogHeader>
    {!entry ? <div className="grid gap-2">{catalog?.entries.filter((e) => e.oauth).map((e) => <Button key={e.id} variant="outline" onClick={() => setProvider(e.id as IntegrationProvider)}>{e.name}</Button>)}</div> : <div className="space-y-4"><ServiceIcon entry={entry} />{connector && <p className="text-sm">{(connector.config as IntegrationConfig).account.email ?? (connector.config as IntegrationConfig).account.label}</p>}<div className="divide-y rounded-xl border">{entry.permissions.map((p) => <label key={p.id} className="flex cursor-pointer items-start gap-3 p-3"><Checkbox checked={permissions.includes(p.id)} disabled={busy} onCheckedChange={(checked) => setPermissions((old) => checked ? [...new Set([...old, p.id])] : old.filter((v) => v !== p.id))} className="mt-0.5" /><span><span className="block text-sm font-medium">{p.label}</span><span className="block text-xs text-muted-foreground">{p.description}</span><details className="mt-1 text-xs text-muted-foreground"><summary>{t('Voir les accès demandés au fournisseur')}</summary><code className="break-all">{p.scopes.join(' · ')}</code></details></span></label>)}</div>{!configured && <p className="text-sm text-muted-foreground">{t('L’administrateur doit activer cette application OAuth. Aucun compte développeur personnel n’est nécessaire.')}</p>}<Button disabled={!configured || !permissions.length || busy} onClick={connect} className="w-full">{busy && <LoaderIcon className="animate-spin" />}{t(busy ? 'Connexion en cours…' : 'Continuer avec le fournisseur')}</Button>{busy && <Button variant="ghost" onClick={() => { popup.current?.close(); setBusy(false); }}>{t('Annuler')}</Button>}</div>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </DialogContent></Dialog>;
}
