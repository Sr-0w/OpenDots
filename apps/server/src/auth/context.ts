import { AsyncLocalStorage } from 'node:async_hooks';

export interface AccountContext { id: string; email: string; role: 'admin' | 'user'; dataDir: string }
const storage = new AsyncLocalStorage<AccountContext | undefined>();
export const currentAccount = () => storage.getStore();
export const accountKey = () => currentAccount()?.id ?? 'system';
export const withAccount = <T>(account: AccountContext | undefined, fn: () => T): T => storage.run(account, fn);
