import { registerAs } from '@nestjs/config';

export const security = registerAs('security', () => ({
  apiKey: process.env.API_KEY,
  // External SSO backend base URL — see docs/LOGIN.md §12. Read by
  // SsoAuthGuard for the CMS/admin surface's Bearer-token check
  // (`GET <SSO_BASE_URL>/auth/profile`). No default on purpose: unset means
  // SsoAuthGuard fails closed (see its own doc comment) instead of silently
  // trusting every request the way an accidental fallback URL would.
  ssoBaseUrl: process.env.SSO_BASE_URL,
  // Comma-separated list of emails (case-insensitive) that are granted
  // `users.is_admin = true` the first time they ever log in, but ONLY while
  // no row in `users` has `is_admin = true` yet — see `SsoAuthGuard` and
  // `User` entity doc comments. Without this, there would be no way to
  // grant the very first admin (every CMS/admin route requires one).
  // Leave unset once real admins exist; it has no effect after that point.
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
}));
