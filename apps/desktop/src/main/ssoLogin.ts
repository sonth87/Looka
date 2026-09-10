import { BrowserWindow } from 'electron';

/**
 * Real Microsoft 365 (DNU) SSO login for the kiosk — the same SSO the CMS
 * already uses (docs/LOGIN.md §3.2/§3.3), replacing the renderer's
 * `DevAuthClient` mock (`packages/ui/src/lib/authClient.ts`). This module is
 * the piece that doc comment always said was missing: "needs the school's
 * SSO administrator to confirm an accepted `continueUrl`" — resolved per
 * `docs/plans/campaign-config-sso-card-photo-discussion.md` §7 finding #1 by
 * reusing the CMS's own origin as `continueUrl` (already confirmed working —
 * that is literally how CMS itself logs in) rather than inventing a new
 * `looka://` scheme SSO was never told about.
 *
 * Flow (mirrors LOGIN.md §3.3 exactly, just driven from the main process
 * instead of a browser tab):
 *   1. Open a modal `BrowserWindow` at `${ssoBaseUrl}?continueUrl=<cmsBaseUrl>/desktop-callback`.
 *   2. The operator authenticates with the school's real Microsoft 365 login
 *      inside that window — this process never sees a password.
 *   3. SSO redirects the window to `<cmsBaseUrl>/desktop-callback?access_token=…
 *      &refresh_token=…&email=…&user_code=…` — caught here in `will-redirect`/
 *      `will-navigate` *before* it actually loads, so the CMS's callback page
 *      (`apps/cms/src/components/DesktopCallbackPage.tsx`) is a pure fallback,
 *      not the real hand-off mechanism.
 *   4. The window closes itself; the parsed tokens resolve the promise.
 *
 * Config is read from `process.env` with dev-friendly defaults matching
 * `apps/cms/.env.local`'s real test SSO — there is no settings-file wiring
 * for this yet (unlike the file-service credentials in `secrets.ts`), so a
 * packaged production build currently needs these two variables set in the
 * machine's environment before launch. Left as a known gap rather than
 * silently hardcoding a real production URL this session cannot confirm.
 */

const DEFAULT_SSO_BASE_URL = 'https://test-login.dainam.edu.vn/';
const DEFAULT_CMS_BASE_URL = 'http://localhost:3200';

// Exported for ssoLogin.test.ts — pure URL/parsing logic, no Electron
// dependency, unlike openSsoLoginWindow below (which node:test's plain-Node
// runner can never exercise: BrowserWindow only exists inside a real
// Electron process).
export function ssoBaseUrl(): string {
  return (process.env.VITE_URL_LOGIN_SSO ?? DEFAULT_SSO_BASE_URL).trim();
}

export function cmsBaseUrl(): string {
  return (process.env.VITE_URL_CMS ?? DEFAULT_CMS_BASE_URL).trim().replace(/\/$/, '');
}

export function callbackUrl(): string {
  return `${cmsBaseUrl()}/desktop-callback`;
}

export function loginUrl(): string {
  const base = ssoBaseUrl();
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}continueUrl=${encodeURIComponent(callbackUrl())}`;
}

export interface SsoLoginResult {
  accessToken: string;
  refreshToken: string;
  email: string;
  userCode: string;
}

/**
 * Parses the same four query params LOGIN.md §3.3 documents; `null` if this
 * URL isn't (yet) the callback carrying them.
 *
 * `user_code` is NOT required for login (2026-09-10 correction — an earlier
 * pass required it here, same as `access_token`/`refresh_token`, but that
 * was wrong: login must work without one). It defaults to `''`, same as
 * `email`, and is still saved when present — see `ssoAuthClient.ts`'s
 * `StoredSsoIdentity.userCode`/`getUserCode()`.
 */
export function parseCallback(url: string): SsoLoginResult | null {
  if (!url.startsWith(callbackUrl())) return null;
  const query = new URL(url).searchParams;
  const accessToken = query.get('access_token');
  const refreshToken = query.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    email: query.get('email') ?? '',
    userCode: query.get('user_code') ?? '',
  };
}

/**
 * Opens the SSO login window and resolves once the operator finishes (or
 * cancels by closing the window). Only one at a time — a second call while
 * one is already open just focuses the existing window instead of opening a
 * duplicate, same pattern `cameraSetupWindow.ts` uses.
 */
let openWindow: BrowserWindow | null = null;

export function openSsoLoginWindow(parent?: BrowserWindow | null): Promise<SsoLoginResult | null> {
  if (openWindow) {
    openWindow.focus();
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 680,
      title: 'Đăng nhập Microsoft 365',
      autoHideMenuBar: true,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    openWindow = win;

    let settled = false;
    const finish = (result: SsoLoginResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (!win.isDestroyed()) win.close();
    };

    const tryIntercept = (event: { preventDefault: () => void }, url: string) => {
      const result = parseCallback(url);
      if (result) {
        event.preventDefault();
        finish(result);
      }
    };

    win.webContents.on('will-redirect', tryIntercept);
    win.webContents.on('will-navigate', tryIntercept);

    // Fallback: the callback page actually loaded (interception missed the
    // hop) — DesktopCallbackPage.tsx has nothing more to tell us than the
    // URL itself, so read the query string straight off the loaded page.
    win.webContents.on('did-navigate', (_event, url) => {
      const result = parseCallback(url);
      if (result) finish(result);
    });

    win.on('closed', () => {
      openWindow = null;
      finish(null);
    });

    win.loadURL(loginUrl());
  });
}
