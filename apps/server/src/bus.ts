import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@opendots/shared';

/** Bus d'événements interne, relayé au frontend par SSE. */
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publish(event: ServerEvent) {
  emitter.emit('event', event);
}

export function subscribe(fn: (event: ServerEvent) => void): () => void {
  emitter.on('event', fn);
  return () => emitter.off('event', fn);
}
