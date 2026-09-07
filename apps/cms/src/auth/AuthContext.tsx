import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getProfile, logoutRequest, refreshAccessToken, AuthApiError } from './authApi';
import {
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
  setUser,
  clearAuthCookies,
  hasValidAuth,
} from './authCookies';
import { redirectToLogin } from './env';
import type { AuthProfileResponse } from './auth.types';

interface AuthContextValue {
  isLoading: boolean;
  profile: AuthProfileResponse | null;
  error: AuthApiError | null;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Reads `access_token`/`refresh_token`/`email`/`user_code` left on the query
 * string by the SSO redirect (LOGIN.md §3.3 step 3), stores them in cookies,
 * then strips the query string via `history.replaceState` so the tokens
 * don't linger in the URL / browser history. A no-op when there is nothing
 * to capture (the common case — most page loads aren't a fresh SSO return).
 */
function captureTokensFromQueryString(): void {
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return;

  setAccessToken(accessToken);
  setRefreshToken(refreshToken);
  setUser({ email: params.get('email') ?? '', user_code: params.get('user_code') ?? '' });

  window.history.replaceState({}, '', window.location.pathname);
}

/**
 * Provider for the SSO session state (LOGIN.md §3.3 step 4's `AuthContext`
 * role). Captures any token on the query string, then loads `/auth/profile`
 * once. Plain `useState`/`useEffect` — this app has no react-query, and a
 * single one-shot fetch on mount doesn't need its caching/refetch machinery.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<AuthProfileResponse | null>(null);
  const [error, setError] = useState<AuthApiError | null>(null);

  useEffect(() => {
    captureTokensFromQueryString();

    let cancelled = false;
    setIsLoading(true);
    getProfile()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProfile(null);
        setError(err instanceof AuthApiError ? err : new AuthApiError('Không thể kết nối tới SSO', 0));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** LOGIN.md §5 — used by call sites that need a fresh access_token; not invoked by AuthGate itself (see its own comment on `needsRefresh`). */
  const refreshToken = async (): Promise<boolean> => {
    const storedRefreshToken = getRefreshToken();
    if (!storedRefreshToken) {
      await logout();
      return false;
    }

    try {
      const response = await refreshAccessToken(storedRefreshToken);
      setAccessToken(response.access_token);
      if (response.refresh_token) setRefreshToken(response.refresh_token);
      return true;
    } catch {
      await logout();
      return false;
    }
  };

  /** LOGIN.md §6 — best-effort `/auth/logout` call, then always clear locally and send the user back to SSO. */
  const logout = async (): Promise<void> => {
    if (hasValidAuth()) {
      try {
        await logoutRequest();
      } catch {
        // Best-effort: still clear the local session and redirect below even
        // if the SSO backend call itself failed (e.g. already expired).
      }
    }
    clearAuthCookies();
    redirectToLogin();
  };

  return (
    <AuthContext.Provider value={{ isLoading, profile, error, logout, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Only valid inside `<AuthProvider>` — i.e. when `isSsoConfigured` is true (see AuthGate.tsx). */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
