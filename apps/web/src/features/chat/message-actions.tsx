import { useRef, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, EllipsisIcon, ReplyIcon } from 'lucide-react';
import type { MessageReaction, MessageReplyRef } from '@opendots/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '👀', '🔥'];

export function scrollToMessage(id: string) {
  const el = document.getElementById(`message-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.setAttribute('data-flash', '');
  window.setTimeout(() => el.removeAttribute('data-flash'), 1400);
}

export function MessageQuote({ reply }: { reply: MessageReplyRef }) {
  return (
    <button type="button" onClick={() => scrollToMessage(reply.messageId)} className="mb-1.5 flex w-full min-w-0 flex-col rounded-lg border-l-2 border-foreground/25 bg-background/70 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-background">
      <span className="font-medium text-foreground/80">{t('En réponse à')}</span>
      <span className="line-clamp-2 whitespace-pre-wrap">{reply.preview || t('Message')}</span>
    </button>
  );
}

export function ReactionPills({ reactions, onToggle }: { reactions: MessageReaction[]; onToggle: (emoji: string) => void }) {
  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const entry = grouped.get(reaction.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (reaction.actor === 'user') entry.mine = true;
    grouped.set(reaction.emoji, entry);
  }
  if (!grouped.size) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {[...grouped].map(([emoji, entry]) => (
        <button key={emoji} type="button" aria-pressed={entry.mine} onClick={() => onToggle(emoji)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors', entry.mine ? 'border-foreground/30 bg-secondary' : 'bg-card/70 hover:bg-accent')}>
          <span>{emoji}</span>
          {entry.count > 1 && <span className="text-muted-foreground">{entry.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Actions d'un message : bouton visible, menu, et appui long sur mobile. */
export function MessageActions({ text, onReply, onReact, align = 'start', children }: { text: string; onReply: () => void; onReact: (emoji: string) => void; align?: 'start' | 'end'; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const press = useRef<number | null>(null);

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
    setOpen(false);
  }

  function clearPress() {
    if (press.current) window.clearTimeout(press.current);
    press.current = null;
  }

  return (
    <div
      className={cn('group/bubble relative flex w-full flex-col gap-1', align === 'end' && 'items-end')}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, [data-no-press]')) return;
        press.current = window.setTimeout(() => setOpen(true), 480);
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onContextMenu={(event) => {
        event.preventDefault();
        setOpen(true);
      }}
    >
      {children}
      <div data-no-press className="flex items-center gap-0.5">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={t('Actions du message')}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            <div className="flex flex-wrap gap-1 px-1 py-1">
              {QUICK_REACTIONS.map((emoji) => (
                <button key={emoji} type="button" className="rounded-md px-1.5 py-1 text-base hover:bg-accent" aria-label={t('Réagir')} onClick={() => { onReact(emoji); setOpen(false); }}>{emoji}</button>
              ))}
            </div>
            <DropdownMenuItem onSelect={onReply}><ReplyIcon />{t('Répondre')}</DropdownMenuItem>
            {text && <DropdownMenuItem onSelect={() => void copy()}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? t('Copié') : t('Copier')}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-0.5 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/bubble:opacity-100 [@media(hover:hover)]:group-focus-within/bubble:opacity-100">
          <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={t('Répondre')} onClick={onReply}><ReplyIcon /></Button>
          {text && <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={copied ? t('Copié') : t('Copier')} onClick={() => void copy()}>{copied ? <CheckIcon /> : <CopyIcon />}</Button>}
        </div>
        {copied && <span className="px-1 text-[11px] text-muted-foreground">{t('Copié')}</span>}
      </div>
    </div>
  );
}
