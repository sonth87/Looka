import type { CaptureStep, CaptureTriggerMode } from '@face/core';
import { FsError, FS_ERROR_CODES } from '@face/fs-client';
import {
  getDeviceCredentials,
  hasDeviceCredentials,
  getLastVerifiedDeviceState,
  setLastVerifiedDeviceState,
} from './secrets.js';
import { parseRejectReason, type DeviceRejectReason } from './deviceAuth.js';

/** Body for `POST /v1/devices/photos` — see `DeviceApiClient.pushDevicePhoto`. */
export interface DevicePhotoInput {
  photoId: string;
  sessionId: string;
  stepId: string;
  attempt: number;
  dataUrl: string;
  /** The subject's CCCD number, when known — see `ApiPhotoUploadClient.routeUpload`'s own doc comment for why this rides along the request. */
  identityNumber?: string;
}

/**
 * Body for `POST /v1/devices/videos` — see `DeviceApiClient.pushDeviceVideo`
 * (2026-09-09, "route kiosk VIDEO uploads through apps/api the same way
 * kiosk PHOTO uploads already work"). No `stepId`/`attempt` the way
 * `DevicePhotoInput` has — see `AddDeviceVideoDto`'s own doc comment
 * server-side for why video needs neither. `identityNumber` added
 * afterward ("đưa vào cùng folder với ảnh của sinh viên đó") — see
 * `DevicePhotoInput.identityNumber`'s own doc comment, same reasoning.
 */
export interface DeviceVideoInput {
  videoId: string;
  sessionId: string;
  cameraRole?: string;
  durationMs?: number;
  dataUrl: string;
  identityNumber?: string;
}

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
  | { status: 'unauthorized'; rejectReason: DeviceRejectReason }
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
        // wrong, unknown, its campaign has expired, or the device was
        // revoked. A confirmed rejection, not a connectivity problem — see
        // fetchCampaignConfigResult's own doc comment. Body must be read
        // BEFORE returning (a past bug here returned first, discarding the
        // reason) — see `HttpExceptionFilter`'s `{ errorCode, message }`
        // envelope this reads (`deviceAuth.ts`'s own doc comment covers the
        // old-API/non-JSON fallback to 'UNKNOWN').
        const body = (await res.json().catch(() => null)) as { errorCode?: unknown } | null;
        return { status: 'unauthorized', rejectReason: parseRejectReason(body?.errorCode) };
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
   * `'ok'` on success, `'unauthorized'` on a confirmed 401 (device
   * id/secret rejected — the caller must stop hammering the endpoint until
   * a new package is loaded, see `statsEvents.ts`'s own backoff), or
   * `'failed'` for anything else (no device identity, network error, other
   * non-2xx). Was a boolean before the 2026-09-08 fix: `StatsEventWorker`
   * used to retry every 401 forever, exactly like every other failure, with
   * no way to tell an operator why. Rows stay `PENDING` on every non-`'ok'`
   * outcome, same offline-first reasoning as `fetchCampaignConfig`.
   */
  async pushEvents(
    events: { type: string; occurredAt: string; metadata?: Record<string, unknown> }[]
  ): Promise<'ok' | 'unauthorized' | 'failed'> {
    const creds = getDeviceCredentials();
    if (!creds || !creds.apiBaseUrl) return 'failed';
    if (events.length === 0) return 'ok';

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
      if (res.status === 401) {
        // Body isn't currently surfaced further than this (StatsEventWorker
        // only needs the tri-state, not the specific reason), but it's read
        // here rather than discarded for the same reason
        // `fetchCampaignConfigResult` reads it — leaving it unread on a 401
        // was the exact bug that made the "kiosk 3" incident opaque.
        await res.json().catch(() => null);
        console.error('[deviceApi] events push rejected: 401');
        return 'unauthorized';
      }
      if (!res.ok) {
        console.error(`[deviceApi] events push failed: ${res.status}`);
        return 'failed';
      }
      return 'ok';
    } catch (err) {
      console.error('[deviceApi] events push failed:', (err as Error).message);
      return 'failed';
    }
  }

  /**
   * Pushes one captured photo's actual bytes to `POST /v1/devices/photos`
   * (Part A of the "route kiosk photo uploads through apps/api" work) — the
   * target `ApiPhotoUploadClient` (uploads.ts) POSTs to instead of fs-core
   * directly, for anything that isn't a video (see that class's own doc
   * comment for why video is untouched).
   *
   * Throws `FsError` on any failure, mirroring `FsClient`'s own error
   * contract — `ApiPhotoUploadClient` is a drop-in `FsClient` substitute for
   * `UploadWorker` (packages/fs-client), which decides retry-vs-permanent
   * purely off `FsError.retryable` (httpStatus 0/429/5xx). A non-FsError
   * here would default to "always retryable", which is the wrong behaviour
   * for e.g. a validation 400 that will never succeed on retry.
   */
  async pushDevicePhoto(input: DevicePhotoInput): Promise<{ photoId: string }> {
    const creds = getDeviceCredentials();
    if (!creds || !creds.apiBaseUrl) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, 'No device credentials/apiBaseUrl configured');
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${creds.apiBaseUrl}/v1/devices/photos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': creds.deviceId,
          'x-device-secret': creds.deviceSecret,
        },
        body: JSON.stringify(input),
      });
    } catch (err) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, (err as Error).message);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new FsError(
        res.status,
        FS_ERROR_CODES.HTTP,
        `devices/photos ${res.status}: ${text.slice(0, 300)}`
      );
    }

    const envelope = (await res.json()) as { data: { photoId: string } };
    return envelope.data;
  }

  /**
   * Pushes one recorded video's actual bytes to `POST /v1/devices/videos`
   * (2026-09-09, "route kiosk VIDEO uploads through apps/api the same way
   * kiosk PHOTO uploads already work") — the exact video counterpart of
   * `pushDevicePhoto` above; see that method's own doc comment for why
   * `FsError` rather than a generic error.
   */
  async pushDeviceVideo(input: DeviceVideoInput): Promise<{ videoId: string }> {
    const creds = getDeviceCredentials();
    if (!creds || !creds.apiBaseUrl) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, 'No device credentials/apiBaseUrl configured');
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${creds.apiBaseUrl}/v1/devices/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': creds.deviceId,
          'x-device-secret': creds.deviceSecret,
        },
        body: JSON.stringify(input),
      });
    } catch (err) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, (err as Error).message);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new FsError(
        res.status,
        FS_ERROR_CODES.HTTP,
        `devices/videos ${res.status}: ${text.slice(0, 300)}`
      );
    }

    const envelope = (await res.json()) as { data: { videoId: string } };
    return envelope.data;
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
  /**
   * Set only when `reason === 'unauthorized'` — the specific server-side
   * cause (secret rotated, revoked, campaign expired, device gone), so the
   * kiosk UI can tell those apart instead of one undifferentiated message
   * (the 2026-09-08 "kiosk 3" incident: an operator went looking at campaign
   * expiry when the real cause was a rotated device secret). `'UNKNOWN'`
   * against an API that predates this, or any body that failed to parse.
   */
  rejectReason?: DeviceRejectReason;
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
    return { blocked: true, reason: 'unauthorized', rejectReason: result.rejectReason, config: null };
  }

  // Unreachable — fall back to the last confirmed-good state on disk and its age.
  const last = getLastVerifiedDeviceState();
  const lastConfig = last?.config ? normalizeCampaignConfig(last.config as CampaignConfig) : null;
  if (!last || Date.now() - last.verifiedAt >= FAIL_CLOSED_AFTER_MS) {
    return { blocked: true, reason: 'unreachable-too-long', config: lastConfig };
  }
  return { blocked: false, config: lastConfig };
}
