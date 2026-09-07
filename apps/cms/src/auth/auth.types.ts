/**
 * Types for the SSO identity/session layer — mirrors docs/LOGIN.md §9,
 * trimmed to what this app actually reads. Fields the CMS doesn't use
 * (e.g. most of `StaffInfo`) are kept optional rather than omitted, since
 * they still come back on the real `/auth/profile` response and callers may
 * want them later (e.g. showing the signed-in name in the header).
 */

export interface StaffAssignment {
  org_code: string;
  unit_code: string;
  display_code: string;
  staff_code: string;
  role_code: string;
  assignment_type: string;
  unit_name: string;
}

export interface StaffInfo {
  code: string;
  display_code: string;
  name: string;
  staff_no: string;
  staff_assignments: StaffAssignment[];
}

/** The `user` object embedded in `/auth/profile` and refresh-token responses. */
export interface AuthUser {
  email: string;
  user_code: string;
  name?: string;
  phone?: string | null;
  provider?: string;
  staff_info?: StaffInfo;
}

/** `GET /auth/profile` response (LOGIN.md §9's `ConfigProfileUser`). */
export interface AuthProfileResponse {
  authenticated: boolean;
  user: AuthUser;
  needsRefresh: boolean;
  sessionValid?: boolean;
  layer?: 1 | 2 | 3 | null;
}

/** `POST /auth/refresh-token` response (LOGIN.md §9's `NewRefreshTokenResponse`). */
export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  user?: AuthUser;
}

/** Minimal shape stored in the `user` cookie (LOGIN.md §3.3/§7) — not the full profile. */
export interface CookieUser {
  email: string;
  user_code: string;
}
