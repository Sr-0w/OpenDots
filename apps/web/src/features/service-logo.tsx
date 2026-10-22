import { MailIcon, PlugIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
export function ServiceLogo({ provider, className }: { provider: string; className?: string }) {
  const logo = ['gmail', 'google-drive', 'google-calendar', 'github', 'outlook'].includes(provider);
  return <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background p-2.5', className)}>
    {logo ? <img src={`/brands/${provider}.svg`} alt="" className={cn('size-full object-contain', provider === 'github' && 'dark:invert')} /> : provider === 'imap-smtp' ? <MailIcon className="size-6 text-sky-500" /> : <PlugIcon className="size-6" />}
  </span>;
}
