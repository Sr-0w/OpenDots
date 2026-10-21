import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@opendots/shared';
import { accountKey } from './auth/context.ts';

/** Bus d'événements interne, relayé au frontend par SSE. */
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publish(event: ServerEvent) {
  emitter.emit(`event:${accountKey()}`, event);
}

export function subscribe(fn: (event: ServerEvent) => void): () => void {
  const channel = `event:${accountKey()}`;
  emitter.on(channel, fn);
  return () => emitter.off(channel, fn);
}
