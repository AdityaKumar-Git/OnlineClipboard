import { createContext } from 'react';

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Non-null when /api/me failed for a reason other than "not signed in". */
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
