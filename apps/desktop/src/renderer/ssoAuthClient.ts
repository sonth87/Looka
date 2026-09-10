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
  /**
   * `MeResponse.id` — the server's own `users.id` (not the SSO `user_code`
   * or the email `AuthenticatedIdentity` already carries). Threaded through
   * to `apps/api`'s `sessions.operator_user_id` (2026-09-09, "thống kê phần
   * giảng viên chụp" — see `apps/desktop/src/main/uploads.ts`'s
   * `ApproveSessionUploadOptions.operatorUserId`) so the campaign detail's
   * Thống kê tab can report captures per operator. `undefined` if the
   * `fetchMe()` call during login failed (non-fatal there — see
   * `ssoLogin()` below) — a session captured before this resolves just
   * reports no operator, same as any other pre-this-feature session.
   */
  userId?: string;
  /**
   * The SSO's own `user_code` (2026-09-10 — previously parsed off the
   * callback and used only as a one-off `displayName` fallback below, then
   * discarded; now required by `parseCallback` and kept here so callers can
   * actually read it back via `getUserCode()`, same pattern as
   * `getOperatorUserId()`).
   */
  userCode: string;
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

  /** See `StoredSsoIdentity.userId`'s own doc comment. `null` if not logged in, or if `fetchMe()` never resolved during login. */
  getOperatorUserId(): string | null {
    return readStored()?.userId ?? null;
  }

  /** See `StoredSsoIdentity.userCode`'s own doc comment. `null` if not logged in. */
  getUserCode(): string | null {
    return readStored()?.userCode ?? null;
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
    let userId: string | undefined;
    try {
      const me = await fetchMe({ Authorization: `Bearer ${result.accessToken}` });
      displayName = me.displayName || displayName;
      userId = me.id;
    } catch {
      // Non-fatal — apps/api might be briefly unreachable; the picker
      // screen's own load() call will surface a clearer error if the token
      // really is bad. The login itself already succeeded against SSO.
      // userId stays undefined — getOperatorUserId() reports null, same as
      // any pre-this-feature session; capture is never blocked by this.
    }

    const identity: StoredSsoIdentity = {
      displayName,
      email: result.email,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      userId,
      userCode: result.userCode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    return { displayName: identity.displayName, email: identity.email };
  }
}
