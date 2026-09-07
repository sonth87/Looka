import { registerAs } from '@nestjs/config';

export const security = registerAs('security', () => ({
  apiKey: process.env.API_KEY,
  // External SSO backend base URL — see docs/LOGIN.md §12. Read by
  // SsoAuthGuard for the CMS/admin surface's Bearer-token check
  // (`GET <SSO_BASE_URL>/auth/profile`). No default on purpose: unset means
  // SsoAuthGuard fails closed (see its own doc comment) instead of silently
  // trusting every request the way an accidental fallback URL would.
  ssoBaseUrl: process.env.SSO_BASE_URL,
}));
