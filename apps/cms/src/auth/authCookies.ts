import type { CookieUser } from './auth.types';

/**
 * Plain `document.cookie` helpers for the SSO session (docs/LOGIN.md §7).
 * Deliberately not HttpOnly (LOGIN.md's own risk note in §7/§11 applies here
 * too) — that's inherent to a frontend-only cookie, not a gap introduced by
 * this file. No dependency added for this (matches this app's existing
 * `api.ts`, which is plain `fetch` with no helper libraries either).
 */

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';
const USER_COOKIE = 'user';

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; samesite=lax${secure}`;
}

function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; samesite=lax`;
}

export function getAccessToken(): string | null {
  return getCookie(ACCESS_TOKEN_COOKIE);
}

/** 1-day expiry, matching LOGIN.md §7's cookie table. */
export function setAccessToken(token: string): void {
  setCookie(ACCESS_TOKEN_COOKIE, token, 1);
}

export function getRefreshToken(): string | null {
  return getCookie(REFRESH_TOKEN_COOKIE);
}

/** 7-day expiry, matching LOGIN.md §7's cookie table. */
export function setRefreshToken(token: string): void {
  setCookie(REFRESH_TOKEN_COOKIE, token, 7);
}

export function getUser(): CookieUser | null {
  const raw = getCookie(USER_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CookieUser;
  } catch {
    return null;
  }
}

/** 7-day expiry, matching LOGIN.md §7's cookie table. */
export function setUser(user: CookieUser): void {
  setCookie(USER_COOKIE, JSON.stringify(user), 7);
}

export function clearAuthCookies(): void {
  deleteCookie(ACCESS_TOKEN_COOKIE);
  deleteCookie(REFRESH_TOKEN_COOKIE);
  deleteCookie(USER_COOKIE);
}

/** LOGIN.md §4.1: all three of access_token/refresh_token/user must be present. */
export function hasValidAuth(): boolean {
  return Boolean(getAccessToken() && getRefreshToken() && getUser());
}
