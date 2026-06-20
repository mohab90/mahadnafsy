import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser } from '../types';
import { mysqlAdmin, mysqlAuth } from '../lib/mysqlapi';

interface AuthContextShape {
  authUser: AuthUser | null | undefined;
  setAuthUser: (u: AuthUser | null | undefined) => void;
  logout: () => void;
  refreshAuth: () => void;
}

const AuthContext = createContext<AuthContextShape>({
  authUser: undefined,
  setAuthUser: () => {},
  logout: () => {},
  refreshAuth: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);

  // Auth: restore session via httpOnly cookie (credentials: 'include' in all API calls)
  useEffect(() => {
    const isAuthError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')
        || msg.includes('Forbidden') || msg.includes('token') || msg.includes('expired');
    };

    let attempts = 0;
    const tryMe = () => {
      const meWithTimeout = Promise.race([
        mysqlAuth.me(),
        new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 6000)),
      ]);
      meWithTimeout
        .then((user) => {
          setAuthUser(user);
          // Legacy token refresh
          const legacyToken = localStorage.getItem('mahad-token');
          if (legacyToken) {
            try {
              const parts = legacyToken.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1]));
                const expiresInMs = (payload.exp || 0) * 1000 - Date.now();
                if (expiresInMs > 0 && expiresInMs < 1 * 24 * 60 * 60 * 1000) {
                  mysqlAdmin.refreshToken()
                    .then(() => { localStorage.removeItem('mahad-token'); })
                    .catch(() => {/* silent */});
                }
              }
            } catch {/* malformed token */}
          }
        })
        .catch((err) => {
          if (isAuthError(err)) {
            localStorage.removeItem('mahad-token');
            setAuthUser(null);
          } else if (attempts < 3) {
            attempts++;
            setTimeout(tryMe, attempts * 2000);
          } else {
            setAuthUser(null);
          }
        });
    };
    tryMe();
  }, []);

  const logout = () => {
    mysqlAuth.logout();
    setAuthUser(null);
  };

  const refreshAuth = () => {
    mysqlAuth.me().then((user) => setAuthUser(user)).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthErr = msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')
        || msg.includes('Forbidden') || msg.includes('token') || msg.includes('expired');
      if (isAuthErr) { localStorage.removeItem('mahad-token'); setAuthUser(null); }
    });
  };

  return (
    <AuthContext.Provider value={{ authUser, setAuthUser, logout, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
