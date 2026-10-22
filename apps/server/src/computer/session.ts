import { AsyncLocalStorage } from 'node:async_hooks';
import { accountKey } from '../auth/context.ts';
import { getSetting, setSetting } from '../settings.ts';
import { KeyedMutex } from '../util.ts';

const storage = new AsyncLocalStorage<string>();
export function withDesktopAgent<T>(agentId: string, fn: () => T): T {
  if (!/^ag_[a-zA-Z0-9_]+$/.test(agentId)) throw new Error('Compagnon du bureau invalide.');
  return storage.run(agentId, fn);
}
export function desktopAgentId(): string {
  const id = storage.getStore();
  if (!id) throw new Error('Sélectionne un compagnon pour accéder à son bureau.');
  return id;
}
export const desktopKey = () => `${accountKey()}:${desktopAgentId()}`;
const allocation = new KeyedMutex();
export async function computerSlot(agentId: string) {
  if (!/^ag_[a-zA-Z0-9_]+$/.test(agentId)) throw new Error('Compagnon invalide.');
  return allocation.run(accountKey(), async () => {
    const slots = await getSetting('computer.sessions') ?? {};
    if (slots[agentId]) return slots[agentId];
    let slot = 1;
    const used = new Set(Object.values(slots));
    while (used.has(slot)) slot++;
    if (slot > 1000) throw new Error('Limite de bureaux atteinte pour ce compte.');
    slots[agentId] = slot;
    await setSetting('computer.sessions', slots);
    return slot;
  });
}
