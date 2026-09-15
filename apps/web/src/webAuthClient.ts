import type { AuthClient, AuthenticatedIdentity } from '@face/ui';
import { fetchMe } from '@face/ui';

/**
 * Real SSO `AuthClient` for `apps/web` — the browser counterpart to
 * `apps/desktop`'s `SsoAuthClient` (`apps/desktop/src/renderer/ssoAuthClient.ts`)
 * and modeled directly on `apps/cms`'s own working SSO login (`apps/cms/src/auth/`),
 * since both are plain browser SPAs (see docs/LOGIN.md, which documents
 * exactly this redirect flow for browser apps — desktop's `BrowserWindow`
 * intercept is the platform-specific workaround, not the other way round).
 *
 * Unlike desktop's `ssoLogin()` (which opens an Electron window, waits for
 * the redirect, and resolves with the identity in one call), a browser has
 * no way to "wait" for a full-page redirect — `ssoLogin()` here just
 * navigates away (`window.location.href = ...`); the actual identity
 * capture happens on the NEXT page load, once SSO redirects back with
 * tokens on the query string (`captureSsoCallback()` below, run once at
 * module load — see its own doc comment for why it must run before
 * anything calls `getUser()`).
 *
 * Known gap, same as desktop's own: no refresh-token flow yet — once
 * `accessToken` expires, `/v1/*` calls 401 and the operator has to log in
 * again, rather than silently refreshing the way the CMS's `AuthGate`/
 * `authApi.ts` do (LOGIN.md §5).
 *
 * Real SSO is used unconditionally here — no `DevAuthClient`/manual
 * name-and-email fallback — the same way `apps/desktop/src/renderer/
 * CampaignGate.tsx` unconditionally exports `new SsoAuthClient()`. Just
 * like `apps/desktop/src/main/ssoLogin.ts`'s own `DEFAULT_SSO_BASE_URL`,
 * `VITE_URL_LOGIN_SSO` is an optional override, not a gate — unset, it
 * falls back to the same real test SSO host `apps/cms/.env.local` points
 * at, so this works out of the box without an `apps/web/.env.local`.
 */

const STORAGE_KEY = 'looka_web_sso_identity_v1';
const DEFAULT_SSO_BASE_URL = 'https://test-login.dainam.edu.vn/';

interface StoredWebIdentity extends AuthenticatedIdentity {
  accessToken: string;
  refreshToken: string;
  /** `MeResponse.id` — resolved best-effort after the callback (see `captureSsoCallback`), same non-fatal reasoning as `SsoAuthClient.ssoLogin`. `undefined` until that resolves or if it fails. */
  userId?: string;
  userCode: string;
}

function readStored(): StoredWebIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredWebIdentity) : null;
  } catch {
    return null;
  }
}

function writeStored(identity: StoredWebIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

function ssoBaseUrl(): string {
  const configured = ((import.meta as any).env?.VITE_URL_LOGIN_SSO ?? '').trim();
  return configured.length > 0 ? configured : DEFAULT_SSO_BASE_URL;
}

function getLoginUrl(continueUrl: string): string {
  const base = ssoBaseUrl();
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}continueUrl=${encodeURIComponent(continueUrl)}`;
}

/**
 * Reads `access_token`/`refresh_token`/`email`/`user_code` left on the query
 * string by the SSO redirect-back (LOGIN.md §3.3 step 3 — identical param
 * names to `apps/cms/src/auth/AuthContext.tsx`'s own
 * `captureTokensFromQueryString`), stores them, then strips the query
 * string via `history.replaceState` so the tokens don't linger in the URL/
 * browser history. A no-op when there's nothing to capture (the common
 * case — most page loads aren't a fresh SSO return).
 *
 * MUST run at module load (see the call at the bottom of this file), before
 * `WebCampaignGate`'s `useState(() => authClient.getUser())` — a React
 * effect would run too late, after the first render already saw `null`.
 */
/**
 * Query-string keys SSO's own redirect-back can leave behind — both the
 * success shape above and whatever an OAuth-style rejected/cancelled login
 * comes back with (`error`/`error_description`, `state`). Used only to
 * detect "we just returned from an SSO round trip at all", so the cleanup
 * below still runs on a REJECTED login, not only a successful one.
 */
const SSO_CALLBACK_PARAM_KEYS = [
  'access_token',
  'refresh_token',
  'email',
  'user_code',
  'error',
  'error_description',
  'state',
];

function captureSsoCallback(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) {
    // A rejected/cancelled SSO login (or any other non-success redirect
    // back) still lands here with its own leftover query params. Left
    // uncleaned, `@sonth87/device-layout` (the app-window shell this runs
    // inside — see App.tsx's own `?w=undefined` cleanup for a previous
    // instance of it misreading a stray query string) can fail to reopen
    // the app window automatically, leaving the operator staring at an
    // empty desktop until they manually reopen the app — 2026-09-15 field
    // report. Stripping these params the same way the success path already
    // does below fixes that without needing to know every shape SSO's own
    // reject flow can take.
    if (SSO_CALLBACK_PARAM_KEYS.some((key) => params.has(key))) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    return;
  }

  const email = params.get('email') ?? '';
  const userCode = params.get('user_code') ?? '';
  writeStored({ displayName: userCode || email, email, accessToken, refreshToken, userCode });
  window.history.replaceState({}, '', window.location.pathname);

  // Best-effort real display name — same non-fatal reasoning as
  // `SsoAuthClient.ssoLogin`'s own `fetchMe` call. Fire-and-forget: this
  // function itself must stay synchronous (it runs at module load, before
  // React renders anything).
  void fetchMe({ Authorization: `Bearer ${accessToken}` })
    .then((me) => {
      const stored = readStored();
      if (!stored) return;
      writeStored({ ...stored, displayName: me.displayName || stored.displayName, userId: me.id });
    })
    .catch(() => {
      /* non-fatal — apps/api might be briefly unreachable; the campaign list's own load() surfaces a clearer error if the token is really bad */
    });
}

export class WebAuthClient implements AuthClient {
  getUser(): AuthenticatedIdentity | null {
    const stored = readStored();
    return stored ? { displayName: stored.displayName, email: stored.email } : null;
  }

  /** Not used for real SSO — `ssoLogin()` below is what `LoginScreen` calls. Kept only to satisfy `AuthClient`. */
  async login(): Promise<void> {
    throw new Error('WebAuthClient does not support manual login — use ssoLogin().');
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  /** Same role as `SsoAuthClient.getOperatorUserId()` — `null` if not logged in, or if the post-callback `fetchMe()` never resolved. */
  getOperatorUserId(): string | null {
    return readStored()?.userId ?? null;
  }

  authHeaders(): Record<string, string> {
    const stored = readStored();
    return stored ? { Authorization: `Bearer ${stored.accessToken}` } : {};
  }

  async ssoLogin(): Promise<AuthenticatedIdentity | null> {
    // Full-page navigation — LOGIN.md §3.2. `continueUrl` must be the full
    // absolute URL (LOGIN.md §3.3), matching `apps/cms/src/auth/env.ts`'s
    // own `redirectToLogin` exactly (a bare path made SSO's own redirect
    // construction throw "Invalid URL" — see that file's 2026-09-07 note).
    window.location.href = getLoginUrl(window.location.href);
    // Never actually observed: the navigation above tears down this page
    // before `LoginScreen`'s `await` could do anything with it.
    return null;
  }
}

captureSsoCallback();
