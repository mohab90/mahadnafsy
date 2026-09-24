import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../types';
import { mysqlAuth, SESSION_ENDED_EVENT } from '../lib/mysqlapi';

interface AuthContextShape {
  authUser: AuthUser | null | undefined;
  setAuthUser: (u: AuthUser | null | undefined) => void;
  logout: () => void;
  refreshAuth: () => void;
  /** The server ended this browser's session — usually a sign-in somewhere else. */
  sessionEnded: boolean;
  dismissSessionEnded: () => void;
}

const AuthContext = createContext<AuthContextShape>({
  authUser: undefined,
  setAuthUser: () => {},
  logout: () => {},
  refreshAuth: () => {},
  sessionEnded: false,
  dismissSessionEnded: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);
  const [sessionEnded, setSessionEnded] = useState(false);

  // A session that ends while the page is open — another device signed in — is
  // reported by whichever request notices first: the heartbeat, a lecture's
  // access check, the subscriber refresh. Until now each of them failed on its
  // own and the page stayed signed in, so the student saw a course whose videos
  // would not play and no reason why. Only a page that believed it was signed in
  // reacts; a visitor who never was gets the same 401s and nothing to explain.
  const signedIn = useRef(false);
  useEffect(() => {
    signedIn.current = !!authUser;
    if (authUser) setSessionEnded(false);
  }, [authUser]);
  useEffect(() => {
    const onEnded = () => {
      if (!signedIn.current) return;
      localStorage.removeItem('mahad-token');
      setSessionEnded(true);
      setAuthUser(null);
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  // Auth: restore session via httpOnly cookie (credentials: 'include' in all API calls)
  useEffect(() => {
    // ApiError carries the HTTP status; read it instead of guessing from the
    // message. /api/auth/me answers 401 with "Account disabled or unavailable",
    // which matches none of the substrings this used to look for — so every
    // signed-out visitor was treated as a transient failure and retried three
    // times, four identical 401s spread over 24 seconds on every page load.
    const isAuthError = (err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 401 || status === 403) return true;
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')
        || msg.includes('Forbidden') || msg.includes('token') || msg.includes('expired');
    };

    let attempts = 0;
    const tryMe = () => {
      mysqlAuth.me()
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
                  mysqlAuth.refreshToken()
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
            // Reloading does not bring an ended session back, and this is the
            // moment a student who reloaded to "fix the videos" learns why.
            if ((err as { code?: string } | null)?.code === 'SESSION_REVOKED') setSessionEnded(true);
            setAuthUser(null);
          } else if (attempts < 3) {
            attempts++;
            setTimeout(tryMe, attempts * 4000);
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
      const status = (err as { status?: number } | null)?.status;
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthErr = status === 401 || status === 403
        || msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')
        || msg.includes('Forbidden') || msg.includes('token') || msg.includes('expired');
      if (isAuthErr) { localStorage.removeItem('mahad-token'); setAuthUser(null); }
    });
  };

  return (
    <AuthContext.Provider value={{
      authUser, setAuthUser, logout, refreshAuth,
      sessionEnded, dismissSessionEnded: () => setSessionEnded(false),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
