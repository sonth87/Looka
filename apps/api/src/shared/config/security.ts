import { registerAs } from '@nestjs/config';

export const security = registerAs('security', () => {
  // 2026-09-30 fix (confirmed audit finding): PhotoService/SessionVideoService/
  // PhotoReviewService's unauthenticated local-content view-link routes used
  // to sign with `apiKey` below — the SAME static secret apps/web ships to
  // every browser client (`window.LOOKA_API_KEY`). Anyone holding it could
  // compute a valid signature for any photo/video/variant id themselves,
  // bypassing SSO and every reviewer-scope check those routes are meant to
  // sit behind. A dedicated, server-only secret closes that. Falls back to
  // `apiKey` only so a deployment that has not set this yet does not break —
  // that fallback does NOT actually close the gap above, only setting this
  // env var does.
  const viewLinkSigningSecret = process.env.VIEW_LINK_SIGNING_SECRET;
  if (!viewLinkSigningSecret) {
    console.warn(
      '[security] VIEW_LINK_SIGNING_SECRET is not set — local-content view links ' +
        '(photo/video/variant) fall back to signing with API_KEY, which apps/web ' +
        'also ships to every browser client. Set VIEW_LINK_SIGNING_SECRET to a ' +
        'server-only value to stop those links being forgeable by anyone who holds ' +
        'API_KEY.',
    );
  }
  return {
    apiKey: process.env.API_KEY,
    viewLinkSigningSecret: viewLinkSigningSecret ?? process.env.API_KEY,
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
  };
});
