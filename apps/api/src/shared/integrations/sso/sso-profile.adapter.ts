import {
  IntegrationOutcome,
  retryable,
  success,
  terminal,
} from '../integration-outcome';

export interface SsoProfileResponse {
  authenticated?: boolean;
  user?: {
    email: string;
    user_code: string;
    name?: string;
    staff_info?: Record<string, unknown> | null;
  };
}

/**
 * Talks to the external SSO backend's `GET /auth/profile` — the only file
 * under `shared/integrations/` that knows this endpoint exists. Everything
 * else about auth (caching, `req.user` shape, admin bootstrap) stays in
 * `SsoAuthGuard` on purpose (plan §4.5: an adapter classifies what
 * happened on the wire, it does not decide who is authorized).
 *
 * A plain function, not an `@Injectable()` class: `SsoAuthGuard` is
 * constructed manually (`new SsoAuthGuard(config, repo)`) in
 * `sso-auth.guard.spec.ts`, which mocks `global.fetch` directly rather
 * than a DI-injected client — keeping this a function means that test
 * suite needed zero changes for this extraction, since the mock still
 * intercepts the same `fetch()` call transparently.
 *
 * Returns `Success` with a `null` value for a 2xx response with an
 * unparseable body — that is a valid transport outcome, not a failure;
 * `SsoAuthGuard` decides what a null profile means (it does not treat it
 * as an error either, matching its behaviour before this extraction).
 */
export async function fetchSsoProfile(
  ssoBaseUrl: string,
  authorization: string,
  refreshToken?: string,
): Promise<IntegrationOutcome<SsoProfileResponse | null>> {
  const headers: Record<string, string> = { Authorization: authorization };
  if (refreshToken) headers['x-refresh-token'] = refreshToken;

  let response: Response;
  try {
    response = await fetch(`${ssoBaseUrl.replace(/\/$/, '')}/auth/profile`, {
      headers,
    });
  } catch (error) {
    return retryable(
      `Could not reach SSO backend at ${ssoBaseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    return terminal(`SSO backend responded ${response.status}`);
  }

  const body = (await response
    .json()
    .catch(() => null)) as SsoProfileResponse | null;
  return success(body);
}
