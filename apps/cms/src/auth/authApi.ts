import { loginSSOBeUrl } from './env';
import { getAccessToken, getRefreshToken } from './authCookies';
import type { AuthProfileResponse, RefreshTokenResponse } from './auth.types';

/**
 * Auth-only client hitting the SSO backend (docs/LOGIN.md §2's `axiosInstance`
 * role) — a conceptually separate client from `../api.ts`'s `apiService`
 * equivalent, which talks to apps/api and is untouched by this module. Plain
 * `fetch`, matching `api.ts`'s existing style (no axios instance added).
 */

export class AuthApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function authBaseUrl(): string {
  return loginSSOBeUrl.replace(/\/$/, '');
}

/**
 * Header fallback for a domain-different consuming app (LOGIN.md §12): this
 * CMS's dev origin (localhost:3200) is not the SSO backend's origin, so
 * cross-site cookies can be dropped by the browser even with
 * `credentials: 'include'` + `SameSite=None`. Sending both cookie and header
 * "in parallel" (§12.1) means the request still works either way.
 */
function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (refreshToken) headers['x-refresh-token'] = refreshToken;
  return headers;
}

async function assertOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    throw new AuthApiError(`${label} failed (${res.status})`, res.status);
  }
}

/** `GET /auth/profile` — LOGIN.md §3.3 step 4. */
export async function getProfile(): Promise<AuthProfileResponse> {
  const res = await fetch(`${authBaseUrl()}/auth/profile`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  await assertOk(res, 'GET /auth/profile');
  return res.json() as Promise<AuthProfileResponse>;
}

/** `GET /auth/logout` — LOGIN.md §6. */
export async function logoutRequest(): Promise<void> {
  const res = await fetch(`${authBaseUrl()}/auth/logout`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  await assertOk(res, 'GET /auth/logout');
}

/** `POST /auth/refresh-token` — LOGIN.md §5. */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResponse> {
  const res = await fetch(`${authBaseUrl()}/auth/refresh-token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  await assertOk(res, 'POST /auth/refresh-token');
  return res.json() as Promise<RefreshTokenResponse>;
}
