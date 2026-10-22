import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CalendarClockIcon, ChevronRightIcon, CpuIcon, KeyRoundIcon, LoaderIcon, MonitorIcon, PaletteIcon, PlugIcon, SearchIcon, ShieldCheckIcon, SparklesIcon, UsersIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { AccountAvatar } from '../account-avatar';
import { SettingsPanel } from '../settings-dialog';
import { ApprovalCard } from '../chat/approval-card';
const ConnectorsPage = lazy(() => import('./connectors-page').then(m => ({ default: m.ConnectorsPage })));
const ComputerPage = lazy(() => import('./computer-page').then(m => ({ default: m.ComputerPage })));
const TasksPage = lazy(() => import('./tasks-page').then(m => ({ default: m.TasksPage })));
const SkillsPage = lazy(() => import('./skills-page').then(m => ({ default: m.SkillsPage })));
const TeamView = lazy(() => import('../team-view').then(m => ({ default: m.TeamView })));

export const SETTINGS_SECTIONS = ['general', 'models', 'credentials', 'connectors', 'computer', 'tools', 'tasks', 'skills', 'team', 'approvals'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
const sections = [
  { id: 'general', label: 'Général', icon: PaletteIcon, group: 'Ton compte', description: 'Ton profil, l’apparence et les notifications.' },
  { id: 'models', label: 'Modèles', icon: CpuIcon, group: 'Ton compte', description: 'Le modèle par défaut et ses fournisseurs.' },
  { id: 'credentials', label: 'Clés et modèles locaux', icon: KeyRoundIcon, group: 'Ton compte', description: 'Ta clé OpenRouter et les connexions Ollama.' },
  { id: 'connectors', label: 'Connecteurs', icon: PlugIcon, group: 'Espace de travail' },
  { id: 'computer', label: 'Ordinateur', icon: MonitorIcon, group: 'Espace de travail' },
  { id: 'tools', label: 'Recherche et outils', icon: SearchIcon, group: 'Espace de travail', description: 'La recherche web et l’environnement d’exécution.' },
  { id: 'tasks', label: 'Tâches planifiées', icon: CalendarClockIcon, group: 'Espace de travail' },
  { id: 'skills', label: 'Skills', icon: SparklesIcon, group: 'Espace de travail' },
  { id: 'team', label: 'Échanges de l’équipe', icon: UsersIcon, group: 'Équipe' },
  { id: 'approvals', label: 'Validations', icon: ShieldCheckIcon, group: 'Équipe', description: 'Les actions en attente de ton accord et les dernières décisions.' },
] as const;

export function SettingsPage({ section, onSectionChange }: { section: SettingsSection; onSectionChange: (section: SettingsSection) => void }) {
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1024px)').matches);
  const navigation = useRef<HTMLDivElement>(null);
  const account = useAccount(), approvals = useStore(s => s.approvals);
  const pending = approvals.filter(a => a.status === 'pending');
  useEffect(() => { const query = matchMedia('(min-width: 1024px)'); const update = () => setWide(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  useEffect(() => { if (!wide) navigation.current?.querySelector('[role="tab"][data-state="active"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [section, wide]);
  const selected = sections.find(s => s.id === section)!;
  const accountSection = ['general', 'models', 'credentials', 'tools'].includes(section);
  return <Tabs value={section} onValueChange={value => onSectionChange(value as SettingsSection)} orientation={wide ? 'vertical' : 'horizontal'} className="min-h-0 min-w-0 flex-1 gap-0">
    <TabsList ref={navigation} aria-label={t('Rubriques des paramètres')} className={wide ? 'w-52 shrink-0 items-stretch justify-start gap-0.5 rounded-none border-r bg-sidebar/40 p-3 data-[orientation=vertical]:h-full' : 'h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b bg-background p-2'}>
      {sections.map((item, index) => <div key={item.id} className={wide ? 'w-full' : 'shrink-0'}>
        {wide && (index === 0 || item.group !== sections[index - 1].group) && <p className="px-2 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t(item.group)}</p>}
        <TabsTrigger value={item.id} className={wide ? 'h-auto w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs data-[state=active]:bg-accent data-[state=active]:shadow-none' : 'shrink-0 gap-1.5 whitespace-nowrap px-3 py-2 text-xs'}><item.icon className="size-3.5 shrink-0" />{t(item.label)}{item.id === 'approvals' && pending.length > 0 && <span className="ml-auto rounded-full bg-foreground px-1.5 text-[10px] text-background">{pending.length}</span>}</TabsTrigger>
      </div>)}
    </TabsList>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<div className="flex flex-1 items-center justify-center"><LoaderIcon className="animate-spin" /></div>}>
        <TabsContent value={section} className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        {accountSection ? <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-6 p-5 sm:p-8"><div><p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">{t('Paramètres')}<ChevronRightIcon className="size-3" />{t(selected.group)}</p><h1 className="text-2xl font-semibold tracking-tight">{t(selected.label)}</h1>{'description' in selected && <p className="mt-1 text-sm text-muted-foreground">{t(selected.description)}</p>}</div>
          {section === 'general' && <section className="flex flex-wrap items-center gap-4 rounded-2xl border p-5"><AccountAvatar className="size-14 text-lg" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{account?.profile?.name ?? account?.email}</p>{account?.profile?.name && <p className="truncate text-xs text-muted-foreground">{account.email}</p>}<p className="mt-1 text-xs text-muted-foreground">{account?.profile?.source === 'gravatar' ? t('Profil public Gravatar') : t('Compte personnel')}</p></div><Button variant="outline" size="sm" onClick={() => api.logout().then(() => location.reload())}>{t('Se déconnecter')}</Button></section>}
          <SettingsPanel key={section} section={section as 'general' | 'models' | 'credentials' | 'tools'} />
        </div></div> : section === 'connectors' ? <ConnectorsPage /> : section === 'computer' ? <ComputerPage /> : section === 'tasks' ? <TasksPage /> : section === 'skills' ? <SkillsPage /> : section === 'team' ? <TeamView /> : <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8"><h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheckIcon className="size-5" />{t('Validations')}</h1><p className="text-sm text-muted-foreground">{t('Les actions en attente de ton accord et les dernières décisions.')}</p>{!pending.length && <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">{t('Rien n’attend ta validation.')}</div>}{pending.map(a => <ApprovalCard key={a.id} approvalId={a.id} />)}{approvals.some(a => a.status !== 'pending') && <h2 className="pt-4 text-sm font-medium text-muted-foreground">{t('Récemment')}</h2>}{approvals.filter(a => a.status !== 'pending').slice(0, 8).map(a => <ApprovalCard key={a.id} approvalId={a.id} />)}</div></div>}
        </TabsContent>
      </Suspense>
    </div>
  </Tabs>;
}
