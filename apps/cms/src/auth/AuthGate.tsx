import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { getAccessToken, getRefreshToken, hasValidAuth } from './authCookies';
import { isSsoConfigured, redirectToLogin } from './env';

/**
 * Shown while the initial `/auth/profile` check is in flight. Same visual
 * language the removed ApiKeyGate.tsx used (centered card on a light gray
 * page).
 */
function CheckingAccessScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <p className="text-gray-500 text-sm">Đang kiểm tra quyền truy cập...</p>
    </div>
  );
}

/**
 * Protected-route priority rules (docs/LOGIN.md §4.1), evaluated in order —
 * first match wins. `redirectToLogin` is a full-page navigation, so
 * returning `null` is enough; nothing renders before the browser leaves.
 * This app has no "special path" group (§4.1 rule #1 — e.g. a webview
 * verifier) to skip, so that rule has no equivalent here.
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoading, profile, error } = useAuth();

  if (isLoading) return <CheckingAccessScreen />;

  // Rule 2: refresh_token present but access_token missing (e.g. the shorter-
  // lived access_token cookie expired) — force re-login rather than silently
  // refreshing, matching LOGIN.md §4.1.
  if (getRefreshToken() && !getAccessToken()) {
    redirectToLogin();
    return null;
  }

  // Rule 3: backend says the current access_token is no longer usable.
  if (profile?.needsRefresh) {
    redirectToLogin();
    return null;
  }

  // Rule 4: no valid local session, or the profile call itself came back 401.
  if (!hasValidAuth() || error?.status === 401) {
    redirectToLogin();
    return null;
  }

  // Rule 5: none of the above — render the app.
  return <>{children}</>;
}

/**
 * SSO gate wrapping the whole CMS — the sole auth gate in App.tsx since the
 * old `ApiKeyGate`/shared `x-api-key` layer was removed (2026-09-07): SSO now
 * decides both who may open the CMS and, via the Bearer token it captures
 * into cookies, which apps/api calls succeed (api.ts's request()).
 *
 * Dev fallback: when `VITE_URL_LOGIN_SSO` is unset/empty, `isSsoConfigured`
 * is false (env.ts already logged a console warning) and this renders
 * children directly, skipping the SSO flow entirely — so
 * `pnpm --filter @face/cms dev` keeps working without a real SSO backend
 * (apps/api's own SsoAuthGuard still applies server-side in that case, so
 * CMS/admin calls will 401 unless the backend's dev bypass is also set).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!isSsoConfigured) {
    return <>{children}</>;
  }

  return (
    <AuthProvider>
      <AuthGuard>{children}</AuthGuard>
    </AuthProvider>
  );
}
