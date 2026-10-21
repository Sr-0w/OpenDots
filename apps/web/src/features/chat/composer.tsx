import { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, SquareIcon, PlusIcon, XIcon, LoaderIcon } from 'lucide-react';
import { IMAGE_MAX_BYTES, IMAGE_MAX_COUNT } from '@opendots/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type DraftImage = { id: string; file: File; preview: string };
/** File selection and clipboard images share the same draft and submission path. */
export function Composer({ onSubmit, onStop, busy, placeholder, autoFocus }: {
  onSubmit: (text: string, images: File[]) => void | Promise<void>;
  onStop: () => void; busy: boolean; placeholder: string; autoFocus?: boolean;
}) {
  const [value, setValue] = useState(''), [images, setImages] = useState<DraftImage[]>([]), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null), draft = useRef<DraftImage[]>([]), submitting = useRef(false);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = '0px'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; } }, [value]);
  useEffect(() => { if (autoFocus && window.matchMedia('(pointer: fine)').matches) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => () => { for (const image of draft.current) URL.revokeObjectURL(image.preview); }, []);
  function replace(next: DraftImage[]) { draft.current = next; setImages(next); }
  function add(files: File[]) {
    if (submitting.current) return;
    let warning = ''; const next = [...draft.current];
    for (const file of files) {
      if (next.length >= IMAGE_MAX_COUNT) { warning = t('Tu peux joindre jusqu’à 6 images par message.'); break; }
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) && !(file.type === '' && /\.(png|jpe?g|webp|gif)$/i.test(file.name))) { warning = t('Choisis une image JPEG, PNG, WebP ou GIF.'); continue; }
      if (!file.size || file.size > IMAGE_MAX_BYTES) { warning = t('Chaque image doit faire moins de 10 Mo.'); continue; }
      next.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    replace(next); setError(warning);
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }
  function remove(id: string) { const old = draft.current.find((image) => image.id === id); if (old) URL.revokeObjectURL(old.preview); replace(draft.current.filter((image) => image.id !== id)); }
  async function submit() {
    const text = value.trim();
    if ((!text && !draft.current.length) || busy || submitting.current) return;
    submitting.current = true; setUploading(true); setError('');
    try {
      await onSubmit(text, draft.current.map((image) => image.file));
      for (const image of draft.current) URL.revokeObjectURL(image.preview);
      replace([]); setValue('');
    } catch (error) { setError(error instanceof Error ? error.message : t('Impossible de joindre les images. Réessaie.')); }
    finally { submitting.current = false; setUploading(false); }
  }
  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className={cn('relative flex w-full flex-col gap-2 rounded-3xl border bg-card p-2 shadow-sm transition-shadow', 'focus-within:border-ring/60 focus-within:shadow-md')}>
    <input ref={picker} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" aria-label={t('Choisir des images')} onChange={(event) => { add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {images.length > 0 && <div className="flex flex-wrap gap-2 px-2 pt-2" aria-label={t('Images jointes')}>{images.map((image) => <div key={image.id} className="relative"><a href={image.preview} target="_blank" rel="noreferrer"><img src={image.preview} alt={image.file.name} className="size-20 rounded-xl border object-cover" /></a><Button type="button" size="icon" variant="secondary" disabled={uploading} className="absolute -top-1.5 -right-1.5 size-6 rounded-full" aria-label={t('Retirer {name}', { name: image.file.name })} onClick={() => remove(image.id)}><XIcon className="size-3" /></Button></div>)}</div>}
    {error && <p role="alert" className="px-3 text-xs text-destructive">{error}</p>}
    <div className="flex items-end gap-2">
      <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0 rounded-full" disabled={uploading || images.length >= IMAGE_MAX_COUNT} onClick={() => picker.current?.click()} aria-label={t('Joindre des images')}><PlusIcon /></Button>
      <textarea ref={ref} rows={1} value={value} disabled={uploading} maxLength={50_000} onChange={(event) => setValue(event.target.value)} onPaste={(event) => {
        const items = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file');
        const files = items.map((item) => item.getAsFile()).filter((file): file is File => file !== null);
        if (files.length) { event.preventDefault(); add(files); }
      }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={placeholder} aria-label={placeholder} className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground" />
      {busy ? <Button type="button" size="icon" variant="secondary" className="size-9 rounded-full" onClick={onStop} aria-label={t('Arrêter')}><SquareIcon className="size-3.5 fill-current" /></Button> : <Button type="submit" size="icon" className="size-9 shrink-0 rounded-full" disabled={uploading || (!value.trim() && !images.length)} aria-label={t('Envoyer')}>{uploading ? <LoaderIcon className="animate-spin" /> : <ArrowUpIcon />}</Button>}
    </div>
  </form>;
}
