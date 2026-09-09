/**
 * Identity layer for the desktop/web login → campaign-picker flow — see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §2.2-A and
 * docs/plans/ui-redesign-plan.md S1.
 *
 * `AuthClient` is the interface `LoginScreen`/`CampaignPickerScreen`/
 * `CampaignHomeScreen` are written against. `DevAuthClient` below is a
 * deliberate stand-in, not real SSO — it lets the operator type a name/
 * email and "logs in" instantly, storing that identity in `localStorage`.
 * This is only useful against an `apps/api` instance running with
 * `SSO_BASE_URL` unset and `ALLOW_UNAUTHENTICATED_ADMIN_DEV=true` — in that
 * mode `SsoAuthGuard` accepts every request regardless of what
 * `Authorization` header (if any) is sent, and attaches a synthetic admin
 * identity server-side. Against a real SSO-backed API, every call this
 * makes will fail with 401 — that is correct, not a bug, and
 * `CampaignPickerScreen`/`CampaignHomeScreen` show a clear error in that
 * case rather than silently showing nothing.
 *
 * The real implementation is `apps/desktop/src/renderer/ssoAuthClient.ts`'s
 * `SsoAuthClient` — an Electron `BrowserWindow` opened to
 * `VITE_URL_LOGIN_SSO?continueUrl=<CMS origin>/desktop-callback`,
 * intercepting the redirect to read `access_token`/`refresh_token` off the
 * query string per LOGIN.md §3.3 (see `apps/desktop/src/main/ssoLogin.ts`).
 * It lives in `apps/desktop`, not here, because it depends on
 * `window.faceAPI` (the Electron preload bridge) — this package stays
 * platform-agnostic, which is also why `ssoLogin` below is optional: a
 * consumer with no real SSO wiring (or `apps/web`) simply never sets it, and
 * `LoginScreen` falls back to `DevAuthClient`'s manual form.
 */

export interface AuthenticatedIdentity {
  displayName: string;
  email: string;
}

export interface AuthClient {
  getUser(): AuthenticatedIdentity | null;
  login(identity: AuthenticatedIdentity): Promise<void>;
  logout(): void;
  /** Headers to attach to every `/v1/*` call this client's user makes. */
  authHeaders(): Record<string, string>;
  /**
   * Real SSO login, when this client has it wired up — see this file's own
   * top comment. `LoginScreen` renders the "Đăng nhập bằng Microsoft 365"
   * button instead of the manual name/email form when this is present.
   * Resolves the identity on success; rejects (operator sees the message)
   * or resolves `null` (silently returns to the login screen) if the
   * operator cancels — the implementation decides which fits its own flow.
   */
  ssoLogin?(): Promise<AuthenticatedIdentity | null>;
}

const STORAGE_KEY = 'looka_dev_auth_identity_v1';

/**
 * localStorage-backed mock login — see this file's own top comment for the
 * "why" and the exact conditions under which calls made with these headers
 * actually succeed against a real `apps/api`.
 */
export class DevAuthClient implements AuthClient {
  getUser(): AuthenticatedIdentity | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthenticatedIdentity) : null;
    } catch {
      return null;
    }
  }

  async login(identity: AuthenticatedIdentity): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  authHeaders(): Record<string, string> {
    const user = this.getUser();
    // The literal token value is never checked by the API's dev bypass —
    // only that SOME identity was chosen locally. Kept non-empty anyway so
    // network logs never show a bare-missing Authorization header, which
    // would be confusing to debug against a real SSO-backed environment.
    return user ? { Authorization: `Bearer dev-mock:${encodeURIComponent(user.email)}` } : {};
  }
}
