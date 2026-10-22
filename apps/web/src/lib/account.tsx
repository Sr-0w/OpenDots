import { createContext, useContext } from 'react';
import type { AccountProfileDTO } from '@opendots/shared';
export interface Account { id: string; email: string; role: 'admin' | 'user'; profile?: AccountProfileDTO }
export const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);
