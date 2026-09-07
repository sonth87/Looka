/**
 * SSO environment configuration — see docs/LOGIN.md §8.
 *
 * `VITE_URL_LOGIN_SSO` is the external SSO login page (consuming apps never
 * render their own username/password form — see LOGIN.md §1). Left empty,
 * this app has no SSO backend to talk to; `isSsoConfigured` below is how the
 * rest of the auth module (and `AuthGate`) knows to skip the whole flow
 * instead of redirecting into a dead URL, so local dev keeps working without
 * a real SSO backend (`pnpm --filter @face/cms dev`).
 */
const rawLoginSSOUrl = (import.meta.env.VITE_URL_LOGIN_SSO ?? '').trim();

export const isSsoConfigured = rawLoginSSOUrl.length > 0;

if (!isSsoConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] VITE_URL_LOGIN_SSO is not set — skipping the SSO login gate. ' +
      'The CMS will render with no login gate at all (dev only - there is no ' +
      'other auth layer left since api-key was removed). Set VITE_URL_LOGIN_SSO ' +
      '(see .env.example) to exercise the real SSO flow.'
  );
}

/** URL of the external SSO login page. Empty string when unconfigured (dev). */
export const loginSSOUrl = rawLoginSSOUrl;

/**
 * baseURL for the SSO backend's `/auth/*` endpoints (profile, logout,
 * refresh-token). Falls back to `loginSSOUrl` per LOGIN.md §8 — most test/
 * prod setups run the login page and its API on the same origin.
 */
export const loginSSOBeUrl = (import.meta.env.VITE_BE_URL_WORKSPACE ?? '').trim() || loginSSOUrl;

/**
 * Builds the full-page redirect URL to the SSO login page, carrying
 * `continueUrl` so SSO knows where to redirect back to once done
 * (LOGIN.md §3.2/§3.3). `continueUrl` must be the full absolute URL
 * (`window.location.href`), exactly as LOGIN.md §3.3's own code sample
 * does (`getLoginUrl(window.location.href)`) — the SSO app runs on a
 * different origin and constructs its own redirect-back URL from this
 * value; a bare path (`pathname + search`, no scheme/host) made its own
 * `new URL(continueUrl)` throw "Invalid URL" and crash the SSO login page
 * outright (fixed 2026-09-07, confirmed live against test-login.dainam.edu.vn).
 */
export function getLoginUrl(continueUrl: string): string {
  const separator = loginSSOUrl.includes('?') ? '&' : '?';
  return `${loginSSOUrl}${separator}continueUrl=${encodeURIComponent(continueUrl)}`;
}

/** Full-page (not SPA) navigation to the SSO login page — see LOGIN.md §3.2. */
export function redirectToLogin(continueUrl = window.location.href): void {
  window.location.href = getLoginUrl(continueUrl);
}
