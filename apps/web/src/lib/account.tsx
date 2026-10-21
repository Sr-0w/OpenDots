import { createContext, useContext } from 'react';
export interface Account { id: string; email: string; role: 'admin' | 'user' }
export const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);
