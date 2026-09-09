import type { AuthClient, AuthenticatedIdentity } from '@face/ui';
import { fetchMe } from '@face/ui';

/**
 * Real Microsoft 365 SSO `AuthClient` — the desktop counterpart to the
 * CMS's own SSO login (`apps/cms/src/auth/`), replacing `DevAuthClient` for
 * production use. Lives here (not in `packages/ui`) because it depends on
 * `window.faceAPI`, the Electron preload bridge — see
 * `apps/desktop/src/main/ssoLogin.ts` for the `BrowserWindow`/redirect-
 * intercept flow this drives, and `packages/ui/src/lib/authClient.ts`'s own
 * doc comment for why `AuthClient.ssoLogin` is optional.
 *
 * Known gap: no refresh-token flow yet. `refreshToken` is stored (so it is
 * not thrown away) but nothing here uses it — once `accessToken` expires,
 * every `/v1/*` call 401s and the operator has to log in again, rather than
 * this client silently refreshing the way the CMS's `AuthGate`/`authApi.ts`
 * do (LOGIN.md §5). Acceptable for a first real-SSO pass; worth revisiting
 * if kiosks start seeing mid-shift 401s.
 */

const STORAGE_KEY = 'looka_sso_identity_v1';

interface StoredSsoIdentity extends AuthenticatedIdentity {
  accessToken: string;
  refreshToken: string;
}

function readStored(): StoredSsoIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSsoIdentity) : null;
  } catch {
    return null;
  }
}

export class SsoAuthClient implements AuthClient {
  getUser(): AuthenticatedIdentity | null {
    const stored = readStored();
    return stored ? { displayName: stored.displayName, email: stored.email } : null;
  }

  /** Not used for real SSO — `ssoLogin()` below is what `LoginScreen` calls. Kept only to satisfy `AuthClient`. */
  async login(): Promise<void> {
    throw new Error('SsoAuthClient does not support manual login — use ssoLogin().');
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  authHeaders(): Record<string, string> {
    const stored = readStored();
    return stored ? { Authorization: `Bearer ${stored.accessToken}` } : {};
  }

  async ssoLogin(): Promise<AuthenticatedIdentity | null> {
    const faceAPI = (window as any).faceAPI;
    const result = await faceAPI?.ssoLogin?.();
    if (!result) return null; // operator closed the SSO window

    // A real display name beats the bare user_code SSO hands back — same
    // Bearer token this stores below, so if this call 401s (bad/rejected
    // token) surface that now rather than silently "logging in" with junk.
    let displayName = result.userCode || result.email;
    try {
      const me = await fetchMe({ Authorization: `Bearer ${result.accessToken}` });
      displayName = me.displayName || displayName;
    } catch {
      // Non-fatal — apps/api might be briefly unreachable; the picker
      // screen's own load() call will surface a clearer error if the token
      // really is bad. The login itself already succeeded against SSO.
    }

    const identity: StoredSsoIdentity = {
      displayName,
      email: result.email,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    return { displayName: identity.displayName, email: identity.email };
  }
}
