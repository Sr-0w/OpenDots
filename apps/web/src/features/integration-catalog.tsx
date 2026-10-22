import { useEffect, useRef, useState } from 'react';
import { CheckIcon, LoaderIcon, PlugIcon, RefreshCwIcon, SearchIcon, ShieldCheckIcon, UnplugIcon } from 'lucide-react';
import type { ConnectorDTO, IntegrationCatalogEntry, IntegrationConfig, IntegrationProvider, MailConfig, OAuthAppDTO, OAuthProvider } from '@opendots/shared';
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

import { ServiceLogo } from "./service-logo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ServiceIcon({ entry }: { entry: Pick<IntegrationCatalogEntry, 'id' | 'category'> }) { return <ServiceLogo provider={entry.id} />; }

const categories = [{id:'all',name:'Tous'}, {id:'mail',name:'Mail'}, {id:'calendar',name:'Agendas'}, {id:'files',name:'Fichiers'}, {id:'development',name:'Développement'}];
export function IntegrationCatalog({ connectors }: { connectors: ConnectorDTO[] }) {
  const account = useAccount();
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.integrationCatalog>> | null>(null);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all');
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<OAuthAppDTO | null>(null);
  const reload = () => { setFailure(''); return api.integrationCatalog().then(setCatalog).catch(e => setFailure(e.message)); };
  useEffect(() => { void reload(); }, []);
  const connections = connectors.filter(c => c.kind === 'integration');
  const mail = connectors.filter(c => c.kind === 'mail');
  const entries = catalog?.entries.filter(entry => (category === 'all' || entry.category === category) && `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  async function test(id: string) { setBusy(id); try { await api.testIntegration(id); toast.success(t('Connexion vérifiée auprès du fournisseur.')); } catch (error) { toast.error((error as Error).message); } finally { setBusy(null); } }
  async function refreshMail(id: string) { setBusy(id); try { const result = await api.refreshConnector(id); if (result.status === 'error') toast.error(result.lastError ?? t('Erreur')); else toast.success(t(result.newMessages ? 'Relève effectuée · {n} nouveau(x)' : 'Relève effectuée', { n: result.newMessages })); } catch (error) { toast.error((error as Error).message); } finally { setBusy(null); } }
  async function disconnect(c: ConnectorDTO) { if (!confirm(t('Déconnecter ce compte d’OpenDots ? Ses jetons seront supprimés localement.'))) return; setBusy(c.id); try { const result = await api.disconnectIntegration(c.id); if (result.warning) toast.message(result.warning); } catch (error) { toast.error((error as Error).message); } finally { setBusy(null); } }
  return <section className="mb-8 space-y-5">
    <div className="rounded-2xl border bg-gradient-to-br from-muted/80 via-background to-background p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('Ton espace connecté')}</p><h2 className="text-lg font-semibold tracking-tight">{t('Tes services, au même endroit.')}</h2><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{t('Relie tes outils à tes compagnons. Tu choisis les accès ; les envois et modifications restent soumis à ta validation.')}</p></div><div className="flex -space-x-2">{['gmail','google-drive','google-calendar','github'].map(provider => <ServiceLogo key={provider} provider={provider} className="size-10 rounded-full border-2 p-2.5 shadow-sm" />)}</div></div></div>
    <Tabs defaultValue="discover" className="gap-5">
      <TabsList aria-label={t('Catalogue de connecteurs')} variant="line" className="w-full justify-start border-b"><TabsTrigger value="discover">{t('Découvrir')}</TabsTrigger><TabsTrigger value="connected">{t('Mes connexions')}<span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{connections.length + mail.length}</span></TabsTrigger></TabsList>
      <TabsContent value="discover" className="space-y-4">
        <div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="h-10 rounded-xl pl-9" aria-label={t('Rechercher un service')} placeholder={t('Rechercher un service…')} value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="flex flex-wrap gap-1.5" aria-label={t('Catégories de connecteurs')}>{categories.map(item => <button key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${category === item.id ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}>{t(item.name)}</button>)}</div>
        <div className="flex items-center justify-between"><h2 className="text-sm font-medium">{t('Services prêts à connecter')}</h2><span className="text-xs text-muted-foreground">{entries.length} {t(entries.length === 1 ? 'service' : 'services')}</span></div>
        {failure && <p role="alert" className="text-sm text-destructive">{failure} <button onClick={() => void reload()} className="underline">{t('Réessayer')}</button></p>}
        {!catalog && !failure && <LoaderIcon className="animate-spin" />}
        {catalog && !entries.length && <div className="rounded-2xl border border-dashed p-10 text-center"><p className="text-sm text-muted-foreground">{t('Aucun service correspondant.')}</p><Button variant="link" onClick={() => { setQuery(''); setCategory('all'); }}>{t('Réinitialiser les filtres')}</Button></div>}
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{entries.map(entry => {
          const app = catalog?.apps.find(v => v.provider === entry.oauth), existing = entry.id === 'imap-smtp' ? mail.length > 0 : connections.some(c => (c.config as IntegrationConfig).provider === entry.id);
          const configured = !entry.oauth || app?.configured;
          return <article key={entry.id} aria-label={entry.name} className="flex min-w-0 flex-col rounded-2xl border bg-card p-5 transition-shadow hover:shadow-sm"><div className="mb-4 flex items-center justify-between gap-2"><ServiceIcon entry={entry} /><span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{t(categories.find(c => c.id === entry.category)?.name ?? entry.category)}</span></div><h3 className="text-sm font-semibold">{entry.name}</h3><p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>{!configured && <p className="mt-3 text-[11px] text-muted-foreground">{t('Configuration initiale par l’administrateur requise.')}</p>}<div className="mt-5 flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">{existing ? t('Compte déjà ajouté') : entry.oauth ? t('Connexion sécurisée OAuth') : t('Serveur de ton choix')}</span><Button size="sm" variant={existing || !configured ? 'outline' : 'default'} onClick={() => entry.id === 'imap-smtp' ? openDialog({ kind:'mail', initialPreset:'custom' }) : openDialog({ kind:'integration', provider:entry.id })}>{existing ? <CheckIcon /> : null}{t(existing ? 'Ajouter un compte' : configured ? 'Connecter' : 'Voir les accès')}</Button></div></article>;
        })}</div>
      </TabsContent>
      <TabsContent value="connected" className="space-y-4">
        <h2 className="text-sm font-medium">{t('Connectés')}</h2>
        {!connections.length && !mail.length && <div className="rounded-2xl border border-dashed p-10 text-center"><PlugIcon className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t('Aucun service connecté pour le moment.')}</p></div>}
        {connections.map(c => {
          const cfg=c.config as IntegrationConfig, entry=catalog?.entries.find(v => v.id === cfg.provider);
          return <article key={c.id} className="space-y-4 rounded-2xl border p-4"><div className="flex items-start gap-3"><ServiceLogo provider={cfg.provider} /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{entry?.name ?? c.name}</h3><p className="truncate text-xs text-muted-foreground">{cfg.account.email ?? cfg.account.label}</p><p className={`mt-1 text-xs ${c.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{c.lastError ?? t(!c.enabled ? 'Désactivé' : c.status === 'ok' ? 'Connecté — permissions sélectionnées uniquement' : 'Connexion à vérifier')}</p></div><Switch aria-label={t('Activer')+' '+c.name} checked={c.enabled} disabled={busy === c.id} onCheckedChange={enabled => api.updateConnector(c.id,{enabled}).catch(e => toast.error(e.message))} /></div><div className="flex flex-wrap gap-1.5">{cfg.permissions.map(permission => <span key={permission} className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">{entry?.permissions.find(p => p.id === permission)?.label ?? permission}</span>)}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy === c.id || !c.enabled} onClick={() => test(c.id)}>{busy === c.id ? <LoaderIcon className="animate-spin" /> : <ShieldCheckIcon />}{t('Tester')}</Button><Button size="sm" variant="outline" onClick={() => openDialog({kind:'integration',provider:cfg.provider,connector:c})}>{t('Permissions / reconnecter')}</Button><Button size="sm" variant="ghost" onClick={() => disconnect(c)}><UnplugIcon />{t('Déconnecter')}</Button></div></article>;
        })}
        {mail.map(c => <article key={c.id} className="space-y-4 rounded-2xl border p-4"><div className="flex items-start gap-3"><ServiceLogo provider="imap-smtp" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{c.name}</h3><p className="truncate text-xs text-muted-foreground">{(c.config as MailConfig).email}</p><p className="mt-1 text-xs text-muted-foreground">IMAP / SMTP · {c.lastError ?? t(c.enabled ? 'Connecté' : 'Désactivé')}</p></div><Switch aria-label={t('Activer')+' '+c.name} checked={c.enabled} onCheckedChange={enabled => api.updateConnector(c.id,{enabled}).catch(e => toast.error(e.message))} /></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy === c.id || !c.enabled} onClick={() => refreshMail(c.id)}><RefreshCwIcon className={busy === c.id ? 'animate-spin' : undefined} />{t('Relever maintenant')}</Button><Button size="sm" variant="outline" onClick={() => openDialog({kind:'mail',connector:c})}>{t('Configurer')}</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm(t('Déconnecter ce compte d’OpenDots ? Ses jetons seront supprimés localement.'))) void api.deleteConnector(c.id).catch(e => toast.error(e.message)); }}><UnplugIcon />{t('Déconnecter')}</Button></div></article>)}
      </TabsContent>
    </Tabs>
    {account?.role === 'admin' && <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">{t('Applications OAuth du déploiement')}</summary><p className="my-3 text-xs text-muted-foreground">{t('Configuration unique pour tous les utilisateurs. Ils ne voient ni le client secret ni cette configuration. Enregistre les URL de retour exactes chez les fournisseurs.')}</p><div className="space-y-2">{catalog?.apps.map(app => <div key={app.provider} data-oauth-provider={app.provider} className="flex flex-wrap items-center gap-2"><span className="min-w-24 text-sm capitalize">{app.provider}</span><span className="flex-1 text-xs text-muted-foreground">{t(app.configured ? 'Application configurée' : 'À configurer')}</span><Button size="sm" variant="outline" disabled={app.source === 'environment'} onClick={() => setEditing(app)}>{t('Configurer')}</Button><code className="w-full break-all text-[11px] text-muted-foreground">{app.callbackUrl}</code></div>)}</div></details>}
    {editing && <OAuthAppDialog app={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
  </section>;
}

function OAuthAppDialog({ app, onClose, onSaved }: { app: OAuthAppDTO; onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = useState(app.clientId), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const docs: Record<OAuthProvider, string> = { google: 'https://console.cloud.google.com/apis/credentials', microsoft: 'https://entra.microsoft.com/', github: 'https://github.com/settings/developers' };
  async function save(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api.saveOAuthApp(app.provider, clientId, secret || undefined); setSecret(''); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Dialog open onOpenChange={(v) => !v && onClose()}><DialogContent><DialogHeader><DialogTitle>{t('Application OAuth')} — {app.provider}</DialogTitle><DialogDescription>{t('Seul l’administrateur du déploiement effectue ce réglage. Le secret reste chiffré sur le serveur.')}</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><a className="text-sm underline" href={docs[app.provider]} target="_blank" rel="noreferrer">{t('Ouvrir la console du fournisseur')}</a><div className="space-y-1"><Label htmlFor="oauth-return">{t('URL de retour à enregistrer')}</Label><Input id="oauth-return" readOnly value={app.callbackUrl} onFocus={(e) => e.target.select()} /></div><div className="space-y-1"><Label htmlFor="oauth-client">Client ID</Label><Input id="oauth-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required autoComplete="off" /></div><div className="space-y-1"><Label htmlFor="oauth-secret">Client secret</Label><Input id="oauth-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={app.hasSecret && app.clientId === clientId ? t('Laisser vide pour conserver le secret') : ''} required={!app.hasSecret || app.clientId !== clientId} autoComplete="new-password" /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy} type="submit">{busy && <LoaderIcon className="animate-spin" />}{t('Enregistrer')}</Button></form></DialogContent></Dialog>;
}

export function IntegrationConnectDialog({ provider, connector, requestedBy, initialPermissions, onClose }: { requestedBy?: string; provider?: IntegrationProvider; connector?: ConnectorDTO; initialPermissions?: string[]; onClose: () => void }) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.integrationCatalog>> | null>(null), [selectedProvider, setProvider] = useState(provider), [permissions, setPermissions] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const popup = useRef<Window | null>(null), timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const entry = catalog?.entries.find((s) => s.id === selectedProvider);
  useEffect(() => { api.integrationCatalog().then(setCatalog).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (entry) setPermissions([...new Set([...(connector ? (connector.config as IntegrationConfig).permissions : initialPermissions?.length ? [] : entry.permissions.filter((p) => p.default).map((p) => p.id)), ...(initialPermissions ?? [])])].filter(id => entry.permissions.some(p => p.id === id))); }, [entry?.id]);
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
