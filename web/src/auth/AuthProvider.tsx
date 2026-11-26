import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from '../lib/api.ts';
import { AuthContext, type AuthContextValue, type AuthStatus, type User } from './AuthContext.ts';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await apiFetch<User>('/api/me');
      setUser(me);
      setStatus('signed-in');
      setError(null);
    } catch (err) {
      setUser(null);
      setStatus('signed-out');
      setError(err instanceof ApiError && err.status === 401 ? null : 'Could not reach the server');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setStatus('signed-out');
    }
  }, []);

  useEffect(() => {
    // Initial session check; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, error, refresh, logout }),
    [status, user, error, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
