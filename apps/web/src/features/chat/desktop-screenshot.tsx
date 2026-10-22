import { useState, type MouseEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';

interface Observation {
  url: string;
  width?: number;
  height?: number;
  cursor?: { x: number; y: number } | null;
  status?: string;
  visualChange?: string;
}

export function DesktopScreenshot({ output, afterAction }: { output: Observation; afterAction: boolean }) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: output.width ?? 1280, height: output.height ?? 800 });
  const caption = t(output.status === 'observe_first' ? 'Avant action — action non exécutée' : afterAction ? 'Après action — vérifie le résultat visible' : 'Capture du bureau privé');
  function inspect(event: MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    if (!event.detail) { setPoint(current => current ?? { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) }); return; }
    setPoint({
      x: Math.max(0, Math.min(size.width - 1, Math.floor((event.clientX - bounds.left) * size.width / bounds.width))),
      y: Math.max(0, Math.min(size.height - 1, Math.floor((event.clientY - bounds.top) * size.height / bounds.height))),
    });
  }
  return <figure className="max-w-xl space-y-1">
    <a href={output.url} target="_blank" rel="noreferrer" className="block"><img src={output.url} alt={t('Capture du bureau privé')} className="max-w-full rounded-xl border" loading="lazy" onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /></a>
    <figcaption className="space-y-1 text-xs text-muted-foreground">
      <p>{caption}{output.visualChange === 'unchanged' && <> · {t('Écran inchangé')}</>}</p>
      <p>{size.width} × {size.height} px · {t('Origine en haut à gauche')}{output.cursor && <> · {t('Pointeur X11')} ({output.cursor.x}, {output.cursor.y})</>}</p>
      <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)}>{t('Vérifier les coordonnées')}</button>
    </figcaption>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[95dvh] w-[calc(100%-1rem)] max-w-6xl overflow-y-auto sm:max-w-6xl">
        <DialogHeader><DialogTitle>{t('Coordonnées de la capture')}</DialogTitle><DialogDescription>{t('Touchez ou cliquez sur l’image pour lire un point en pixels d’origine.')}</DialogDescription></DialogHeader>
        <p className="text-xs text-muted-foreground">{size.width} × {size.height} px · {t('Origine en haut à gauche')}{output.cursor && <> · {t('Pointeur X11')} ({output.cursor.x}, {output.cursor.y})</>}</p>
        <button type="button" aria-label={t('Inspecter un point de la capture')} className="relative block w-full cursor-crosshair overflow-hidden rounded-lg p-0 outline-offset-2" onClick={inspect} onKeyDown={event => {
          const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
          if (!delta) return;
          event.preventDefault(); const step = event.shiftKey ? 10 : 1;
          setPoint(current => { const p = current ?? { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) }; return { x: Math.max(0, Math.min(size.width - 1, p.x + delta[0] * step)), y: Math.max(0, Math.min(size.height - 1, p.y + delta[1] * step)) }; });
        }}>
          <img src={output.url} alt={t('Capture en coordonnées natives')} className="block h-auto w-full" />
          {point && <span aria-hidden="true" className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-black" style={{ left: `${(point.x + 0.5) / size.width * 100}%`, top: `${(point.y + 0.5) / size.height * 100}%` }} />}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p role="status" className="font-mono">{t('Point inspecté')} : {point ? `(${point.x}, ${point.y})` : '—'}</p><a className="text-xs underline" href={output.url} target="_blank" rel="noreferrer">{t('Ouvrir l’original')}</a></div>
      </DialogContent>
    </Dialog>
  </figure>;
}
