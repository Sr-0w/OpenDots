import { useState } from 'react';
import { useAccount } from '@/lib/account';
import { cn } from '@/lib/utils';
export function AccountAvatar({ className }: { className?: string }) {
  const account = useAccount(), [failed, setFailed] = useState(false);
  const name = account?.profile?.name ?? account?.email ?? '?';
  const initials = name.includes(' ') ? name.split(/\s+/).slice(0, 2).map(part => part[0]).join('') : name.slice(0, 2);
  return <span className={cn('flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground/10 text-xs font-semibold uppercase text-foreground', className)}>
    {account?.profile?.avatarUrl && !failed ? <img src={account.profile.avatarUrl} alt={name} className="size-full object-cover" onError={() => setFailed(true)} /> : initials}
  </span>;
}
