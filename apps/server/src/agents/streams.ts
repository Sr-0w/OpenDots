import type { UIMessageChunk } from 'ai';

/**
 * Flux actifs en mémoire, un par conversation. Chaque tour diffuse ses chunks
 * ici ; un client qui se (re)connecte reçoit la totalité du tour en cours puis
 * la suite en direct. Le tour continue même si aucun client n'écoute.
 */
export class ActiveStream {
  readonly chunks: UIMessageChunk[] = [];
  private listeners = new Set<(chunk: UIMessageChunk | null) => void>();
  done = false;
  /** Permet d'interrompre explicitement le tour (bouton « stop »). */
  readonly abort = new AbortController();

  constructor(readonly conversationId: string) {}

  push(chunk: UIMessageChunk) {
    if (this.done) return;
    this.chunks.push(chunk);
    for (const l of this.listeners) l(chunk);
  }

  end() {
    if (this.done) return;
    this.done = true;
    for (const l of this.listeners) l(null);
    this.listeners.clear();
  }

  /** Flux lisible : rejoue l'historique du tour puis suit les nouveaux chunks. */
  readable(): ReadableStream<UIMessageChunk> {
    let listener: ((c: UIMessageChunk | null) => void) | null = null;
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        for (const c of this.chunks) controller.enqueue(c);
        if (this.done) {
          controller.close();
          return;
        }
        listener = (c) => {
          try {
            if (c === null) controller.close();
            else controller.enqueue(c);
          } catch {
            // client déconnecté
          }
        };
        this.listeners.add(listener);
      },
      cancel: () => {
        if (listener) this.listeners.delete(listener);
      },
    });
  }
}

const active = new Map<string, ActiveStream>();

export function beginStream(stream: ActiveStream) {
  active.set(stream.conversationId, stream);
}

export function finishStream(stream: ActiveStream) {
  stream.end();
  if (active.get(stream.conversationId) === stream) active.delete(stream.conversationId);
}

export function getActiveStream(conversationId: string): ActiveStream | null {
  const s = active.get(conversationId);
  return s && !s.done ? s : null;
}
