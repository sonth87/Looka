/**
 * Pure parsing/comparison logic for `activation.json`, extracted out of
 * `secrets.ts` (which imports `electron` and so cannot run under plain
 * `node --test` — see `SecretStore.ts`'s own doc comment for the same
 * reasoning `deviceAuth.ts` documents).
 *
 * Exists for the 2026-09-08 "re-load a package onto an already-activated
 * kiosk" fix: `secrets.ts#findAndImportActivationFileIfPresent` used to skip
 * the file entirely once a kiosk had any device identity at all, so the only
 * way to load a re-issued secret onto a running kiosk was to wipe secrets by
 * hand. The new flow (`activationFileSupersedesStored`) needs to tell "this
 * file describes a genuinely different credential" apart from "this is the
 * same activation.json still sitting next to the exe from setup" without
 * importing anything yet.
 */

export interface ParsedActivationPayload {
  deviceId: string;
  deviceSecret: string;
  campaignId: string;
  /** The admin-portal base URL this device talks to — null when the file omits `authApiEndpoint`. */
  apiBaseUrl: string | null;
}

/**
 * Validates and extracts the fields `ActivationPackageService` zips up
 * server-side. Throws on a missing/malformed file rather than returning
 * `null`, so a corrupt or hand-edited activation.json fails loudly instead of
 * silently leaving the kiosk unactivated with no signal why — same reasoning
 * `importActivationFile` documented before this was extracted from it.
 */
export function parseActivationPayload(raw: string): ParsedActivationPayload {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId : null;
  const deviceSecret = typeof parsed.deviceSecret === 'string' ? parsed.deviceSecret : null;
  const campaignId = typeof parsed.campaignId === 'string' ? parsed.campaignId : null;
  if (!deviceId || !deviceSecret || !campaignId) {
    throw new Error('Malformed activation file: missing deviceId/deviceSecret/campaignId');
  }
  const apiBaseUrl = typeof parsed.authApiEndpoint === 'string' ? parsed.authApiEndpoint : null;

  return { deviceId, deviceSecret, campaignId, apiBaseUrl };
}

/**
 * Whether a freshly parsed activation file describes a credential this kiosk
 * does not already have — true when there is no stored credential at all, or
 * when either the device id or the secret differs from what is stored. A
 * file that round-trips back the exact same deviceId+deviceSecret (e.g. an
 * operator re-copying the same activation.json setup left behind) must be a
 * no-op, not a re-import that resets the offline config cache for nothing.
 */
export function activationFileSupersedesStored(
  stored: { deviceId: string; deviceSecret: string } | null,
  parsed: { deviceId: string; deviceSecret: string }
): boolean {
  if (!stored) return true;
  return stored.deviceId !== parsed.deviceId || stored.deviceSecret !== parsed.deviceSecret;
}
