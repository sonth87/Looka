import { useEffect } from 'react';

/**
 * Landing page for the desktop kiosk's SSO login (docs/plans/
 * campaign-config-sso-card-photo-discussion.md §7 finding #1): the Electron
 * main process opens a `BrowserWindow` at `getLoginUrl(<this route's URL>)`
 * and intercepts the redirect back here (`will-redirect`/`will-navigate`,
 * see apps/desktop/src/main/ssoLogin.ts) to read `access_token`/
 * `refresh_token`/`email`/`user_code` off the query string *before* this
 * page actually loads — the same query-string contract LOGIN.md §3.3
 * documents for the CMS's own `AuthContext`.
 *
 * This component only exists as a fallback for the rare case the intercept
 * misses the redirect (e.g. a client-side/meta-refresh hop `will-redirect`
 * doesn't fire for) and the page loads for real: `AuthGate`'s own
 * `AuthProvider` already captured the same query string into cookies by the
 * time this renders (its capture runs before route matching), so there is
 * nothing left to do here except tell the operator it's safe to close the
 * window — the desktop app never reads anything from this page itself.
 */
export function DesktopCallbackPage() {
  useEffect(() => {
    // Best-effort — Chromium only allows a script to close a window it
    // opened itself, which is exactly what the kiosk's BrowserWindow is;
    // silently does nothing in any other context (e.g. loaded directly).
    const timer = setTimeout(() => window.close(), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center">
        <p className="text-gray-700 font-medium">Đăng nhập thành công</p>
        <p className="text-sm text-gray-500 mt-1">Cửa sổ này sẽ tự đóng…</p>
      </div>
    </div>
  );
}
