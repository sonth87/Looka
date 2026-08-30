import type { CaptureStep, CaptureTriggerMode } from '@face/core';
import { getDeviceCredentials } from './secrets.js';

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
   */
  async fetchCampaignConfig(): Promise<CampaignConfig | null> {
    const creds = getDeviceCredentials();
    if (!creds || !creds.apiBaseUrl) return null;

    try {
      const res = await this.fetchImpl(`${creds.apiBaseUrl}/v1/devices/config`, {
        headers: {
          'x-device-id': creds.deviceId,
          'x-device-secret': creds.deviceSecret,
        },
      });
      if (!res.ok) {
        console.error(`[deviceApi] campaign config fetch failed: ${res.status}`);
        return null;
      }
      const envelope = (await res.json()) as { data: CampaignConfig };
      return envelope.data;
    } catch (err) {
      console.error('[deviceApi] campaign config fetch failed:', (err as Error).message);
      return null;
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
 * Returns the last good config if a refresh fails, rather than losing it.
 */
export async function getCampaignConfig(client = new DeviceApiClient()): Promise<CampaignConfig | null> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const fresh = await client.fetchCampaignConfig();
  if (fresh) {
    cached = fresh;
    cachedAt = now;
  }
  return cached;
}
