import type { CaptureStep, CaptureTriggerMode } from '@face/core';
import {
  getDeviceCredentials,
  hasDeviceCredentials,
  getLastVerifiedDeviceState,
  setLastVerifiedDeviceState,
} from './secrets.js';

export interface CampaignConfig {
  id: string;
  name: string;
  purpose: 'STUDENT_CARD' | 'KYC_ENROLLMENT';
  expiresAt: string | null;
  consentContent: string | null;
  consentVersion: number;
  captureAngles: CaptureStep[] | null;
  captureMode: CaptureTriggerMode | null;
  autoHoldMs: number | null;
  /**
   * Whether this campaign expects every frame captured with every mapped
   * camera at once, rather than one at a time. Added by an older-server
   * migration, so a config from a server that predates this field is
   * normalized to `false` wherever it is read (see `fetchCampaignConfigResult`
   * and `getDeviceAccessStatus`'s disk-cache fallback below).
   */
  simultaneousCapture: boolean;
  /**
   * Campaign-level switch for local video "stream" recording (§3.1) — off by
   * default, same normalize-on-read treatment as `simultaneousCapture` above
   * for a server/cache predating this field.
   */
  recordVideo: boolean;
}

export type ConfigFetchResult =
  | { status: 'ok'; config: CampaignConfig }
  | { status: 'unauthorized' }
  | { status: 'unreachable' };

/**
 * Fills in fields a server predating them may have omitted, so callers never
 * see `undefined` where the type promises `boolean` — applies to both a
 * fresh `/v1/devices/config` response and a config read back from the disk
 * cache written by an older build of this app.
 */
function normalizeCampaignConfig(config: CampaignConfig): CampaignConfig {
  return {
    ...config,
    simultaneousCapture: config.simultaneousCapture ?? false,
    recordVideo: config.recordVideo ?? false,
  };
}

/**
 * The kiosk's own read of `GET /v1/devices/config` on the admin portal — see
 * docs/plans/multi-camera-device-management-discussion.md §3.3. Deliberately
 * a thin, standalone client rather than reusing `FsClient`: this talks to a
 * different backend (the admin portal, not fs-core) with a different
 * credential (device_id/secret, not an fs-core API key) — the two should
 * never be conflatable into one client just because both are "an HTTP
 * client this app happens to hold."
 *
 * Every response body is `{ statusCode, message, data }` - `apps/api`'s
 * global `ResponseTransformInterceptor` adds that envelope to every handler's
 * return value (see `HttpCaptureSink`'s own identical note), so this unwraps
 * it rather than each caller re-declaring the same shape.
 */
export class DeviceApiClient {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  /**
   * Returns `null` when this kiosk has no device identity yet, or when the
   * admin portal cannot be reached — never throws. A kiosk is offline-first
   * (see the discussion doc's own repeated point on this): a config fetch
   * that fails must leave the caller free to fall back to whatever it was
   * already using, not block capture on a network round-trip.
   *
   * Thin wrapper over `fetchCampaignConfigResult` for callers that only care
   * about the config, not why it's missing.
   */
  async fetchCampaignConfig(): Promise<CampaignConfig | null> {
    const result = await this.fetchCampaignConfigResult();
    return result.status === 'ok' ? result.config : null;
  }

  /**
   * Same request as `fetchCampaignConfig`, but distinguishes *why* a config
   * wasn't returned — the §3.3 fail-closed policy needs this: a confirmed
   * `401` (the server rejecting this device outright) must block immediately,
   * while a network error must not, until it's been unreachable for 24h. See
   * `getDeviceAccessStatus` in this file, which is what actually applies that
   * policy.
   */
  async fetchCampaignConfigResult(): Promise<ConfigFetchResult> {
    const creds = getDeviceCredentials();
    if (!creds || !creds.apiBaseUrl) return { status: 'unreachable' };

    try {
      const res = await this.fetchImpl(`${creds.apiBaseUrl}/v1/devices/config`, {
        headers: {
          'x-device-id': creds.deviceId,
          'x-device-secret': creds.deviceSecret,
        },
      });
      if (res.status === 401) {
        // DeviceCredentialsGuard's own verdict: this device id/secret is
        // wrong, unknown, or its campaign has expired. A confirmed rejection,
        // not a connectivity problem — see fetchCampaignConfigResult's own
        // doc comment.
        return { status: 'unauthorized' };
      }
      if (!res.ok) {
        console.error(`[deviceApi] campaign config fetch failed: ${res.status}`);
        return { status: 'unreachable' };
      }
      const envelope = (await res.json()) as { data: CampaignConfig };
      return { status: 'ok', config: normalizeCampaignConfig(envelope.data) };
    } catch (err) {
      console.error('[deviceApi] campaign config fetch failed:', (err as Error).message);
      return { status: 'unreachable' };
    }
  }

  /**
   * Pushes a batch of stats events to `POST /v1/devices/events` — see
   * docs/plans/multi-camera-device-management-discussion.md §3.4. Returns
   * `false` on any failure (no device identity, network error, non-2xx) so
   * `StatsEventWorker` knows to leave the batch `PENDING` and retry next
   * tick — same offline-first reasoning as `fetchCampaignConfig`.
   */
  async pushEvents(events: { type: string; occurredAt: string; metadata?: Record<string, unknown> }[]): Promise<boolean> {
    const creds = getDeviceCredentials();
    if (!creds || !creds.apiBaseUrl) return false;
    if (events.length === 0) return true;

    try {
      const res = await this.fetchImpl(`${creds.apiBaseUrl}/v1/devices/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': creds.deviceId,
          'x-device-secret': creds.deviceSecret,
        },
        body: JSON.stringify({ events }),
      });
      if (!res.ok) {
        console.error(`[deviceApi] events push failed: ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[deviceApi] events push failed:', (err as Error).message);
      return false;
    }
  }
}

let cached: CampaignConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Process-lifetime cache so every session start does not re-hit the network
 * — a campaign's capture config changes rarely enough that 15 minutes of
 * staleness is an easy trade against calling out before every single run.
 * Falls back to `getDeviceAccessStatus`'s own disk-persisted cache once this
 * in-memory one is stale or the process has just restarted, so a config is
 * only truly lost once the §3.3 24h fail-closed window has also passed.
 */
export async function getCampaignConfig(client = new DeviceApiClient()): Promise<CampaignConfig | null> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const status = await getDeviceAccessStatus(client);
  if (status.config) {
    cached = status.config;
    cachedAt = now;
  }
  return cached;
}

/** How long a kiosk that cannot reach the admin portal keeps operating on its last confirmed-good state, before §3.3 requires it to fail closed. */
const FAIL_CLOSED_AFTER_MS = 24 * 60 * 60 * 1000;

export interface DeviceAccessStatus {
  blocked: boolean;
  /** Set only when `blocked` — why the caller must refuse to run a session. */
  reason?: 'unauthorized' | 'unreachable-too-long';
  /** Best-known config: fresh if the admin portal answered, otherwise the last confirmed-good one from disk. Null when this kiosk has no device identity, or none has ever been confirmed. */
  config: CampaignConfig | null;
}

/**
 * The §3.3 two-outcome policy for a registered kiosk: a *confirmed* rejection
 * (401 — this device id/secret is wrong, or its campaign expired) blocks
 * immediately; being merely unreachable is tolerated for up to 24h since the
 * last time the admin portal was actually reached, only failing closed past
 * that. A kiosk with no device identity at all is not participating in this
 * system (predates it, or was never registered through the CMS) and is left
 * alone — fails open exactly as it always has.
 */
export async function getDeviceAccessStatus(client = new DeviceApiClient()): Promise<DeviceAccessStatus> {
  if (!hasDeviceCredentials()) {
    return { blocked: false, config: null };
  }

  const result = await client.fetchCampaignConfigResult();

  if (result.status === 'ok') {
    setLastVerifiedDeviceState(result.config, Date.now());
    return { blocked: false, config: result.config };
  }

  if (result.status === 'unauthorized') {
    return { blocked: true, reason: 'unauthorized', config: null };
  }

  // Unreachable — fall back to the last confirmed-good state on disk and its age.
  const last = getLastVerifiedDeviceState();
  const lastConfig = last?.config ? normalizeCampaignConfig(last.config as CampaignConfig) : null;
  if (!last || Date.now() - last.verifiedAt >= FAIL_CLOSED_AFTER_MS) {
    return { blocked: true, reason: 'unreachable-too-long', config: lastConfig };
  }
  return { blocked: false, config: lastConfig };
}
