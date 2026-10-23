import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, LoaderIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { t } from '@/lib/i18n';

export function Worked({ streaming, count, failures, children }: { streaming: boolean; count: number; failures: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!streaming) setOpen(false); }, [streaming]);
  return <Collapsible open={open} onOpenChange={setOpen} data-worked className="not-prose min-w-0">
    <CollapsibleTrigger className="group/worked flex max-w-full items-center gap-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground">
      {streaming ? <LoaderIcon className="size-3.5 shrink-0 animate-spin" /> : <CheckIcon className="size-3.5 shrink-0" />}
      <span>{streaming ? t('Travaille…') : 'Worked'}</span>
      {count > 0 && <span className="opacity-70">· {t('{count} actions', { count })}</span>}
      {failures > 0 && <span className="text-destructive">· {t('{count} erreurs', { count: failures })}</span>}
      <ChevronDownIcon className="size-3 shrink-0 transition-transform group-data-[state=open]/worked:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent><div className="mt-2 max-h-[28rem] space-y-3 overflow-y-auto overscroll-contain border-l pl-3 pr-1 pb-2">{children}</div></CollapsibleContent>
  </Collapsible>;
}
