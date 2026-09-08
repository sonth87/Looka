/**
 * Pure mapping from the admin portal's `errorCode` (on a 401 response body)
 * to a reason the kiosk UI can actually explain to an operator — see
 * docs/plans (2026-09-08 "kiosk 3" incident): a 401 used to be one
 * undifferentiated "expired or revoked" message, which sent the operator
 * looking at campaign expiry when the real cause was a rotated device
 * secret. Kept Electron-free (unlike `deviceApi.ts`, which imports
 * `secrets.js` -> `electron`) so it can run under plain `node --test` — see
 * `SecretStore.ts`'s own doc comment for the same reasoning.
 *
 * `apps/api`'s `DeviceCredentialsGuard` now throws a `CustomException` whose
 * body is `{ errorCode, message }` (see `common/errors/code.constants.error.ts`)
 * instead of the framework's default `{ errorCode: 401, message }` an
 * `UnauthorizedException` produces. An OLD API (not yet carrying that change)
 * still sends `errorCode: 401`, and any non-JSON/absent body reads as
 * `undefined` here — both map to `'UNKNOWN'`, which is deliberate: this kiosk
 * build must keep working against an API that predates specific reasons,
 * just with the old generic message instead of a specific one.
 */
export type DeviceRejectReason = 'INVALID_SECRET' | 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';

const REJECT_REASON_BY_ERROR_CODE: Record<number, DeviceRejectReason> = {
  5001: 'NOT_FOUND',
  5003: 'EXPIRED',
  5005: 'INVALID_SECRET',
  5008: 'REVOKED',
};

/**
 * `errorCode` arrives as `unknown` because it comes from `JSON.parse`-ing an
 * HTTP response body this kiosk does not control — a stale/old server, a
 * proxy error page, or a malformed response could hand back anything.
 */
export function parseRejectReason(errorCode: unknown): DeviceRejectReason {
  if (typeof errorCode !== 'number') return 'UNKNOWN';
  return REJECT_REASON_BY_ERROR_CODE[errorCode] ?? 'UNKNOWN';
}
