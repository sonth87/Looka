/**
 * Thin client for the "chọn campaign" API surface — `GET /v1/me`,
 * `GET /v1/me/campaigns`, `POST /v1/campaigns/:id/join`,
 * `GET /v1/campaigns/:id/config` — built by the device-management module
 * per docs/plans/campaign-config-sso-card-photo-discussion.md §3.2.2.
 * Consumed by `CampaignPickerScreen`/`CampaignHomeScreen`.
 *
 * Base URL follows the exact same runtime-configured-global convention
 * `apps/web/src/App.tsx` already uses for `HttpCaptureSink`
 * (`window.LOOKA_API_BASE_URL`, default `http://localhost:3100`) rather
 * than inventing a second convention.
 */

export type CampaignEffectiveStatus = 'UPCOMING' | 'OPEN' | 'EXPIRED' | 'PAUSED' | 'CLOSED';
export type CampaignMembershipStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface CampaignSummary {
  id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  quotaPlanned?: number | null;
  effectiveStatus: CampaignEffectiveStatus;
  quotaReached: boolean;
  requiredCameraCount: number;
  /**
   * The real `CaptureStep[]` — present on the actual `GET /v1/me/campaigns`
   * response (confirmed against a live server 2026-09-08), just not
   * previously typed/used here. `.length` is "số ảnh cần chụp" (target
   * photo count) — distinct from `requiredCameraCount` (how many distinct
   * cameras those steps need). A prior version of `CampaignHomeScreen`
   * showed `requiredCameraCount` for BOTH numbers by mistake; fixed the
   * same day this comment was added.
   */
  captureAngles?: CampaignCaptureStep[] | null;
  /** `MembershipDao` — status only; no requestedAt/note on the list view, see `me.dao.ts`. */
  membership: { status: CampaignMembershipStatus };
}

/** `AuthenticatedUser` as `SsoAuthGuard` attaches it — see apps/api's common/guards/sso-auth.guard.ts. */
export interface MeResponse {
  id: string;
  ssoUserCode: string;
  email: string;
  displayName?: string | null;
  isAdmin: boolean;
  roles: string[];
}

export interface CampaignCaptureStep {
  id: string;
  type: string;
  instruction: string;
  angleCode?: string;
  isCardSource?: boolean;
  cameraRole?: string;
  pose?: { yaw?: { target: number; tolerance: number }; pitch?: { target: number; tolerance: number } };
}

export interface CampaignConfig {
  id: string;
  name: string;
  captureAngles: CampaignCaptureStep[];
  /**
   * "Quay video trong lúc chụp" — present on the real `CampaignConfigDao`
   * response (apps/api's `campaign-config.controller.ts`) but missed here
   * until 2026-09-08, the same kind of stale-typing gap `CampaignSummary`
   * had for `captureAngles`. Kept optional/defaulted at the call site rather
   * than required, so a backend that predates this field doesn't need a
   * type assertion to keep compiling.
   */
  recordVideo?: boolean;
  recordVideoRoles?: string[] | null;
  cardSpec?: Record<string, unknown> | null;
  requiredCameraCount: number;
}

function apiBaseUrl(): string {
  return (globalThis as { LOOKA_API_BASE_URL?: string }).LOOKA_API_BASE_URL ?? 'http://localhost:3100';
}

export class CampaignPortalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'CampaignPortalApiError';
  }
}

async function call<T>(path: string, authHeaders: Record<string, string>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new CampaignPortalApiError(`Không kết nối được máy chủ: ${(err as Error).message}`, 0);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* not JSON - keep the raw text */
    }
    throw new CampaignPortalApiError(message || `HTTP ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  // apps/api wraps every response as `{statusCode, message, data}`
  // (apps/cms's api.ts's request() already unwraps this the same way) — this
  // client used to return the raw envelope, so a caller expecting an array
  // (e.g. fetchMyCampaigns) got `{statusCode, message, data: [...]}` instead
  // and `campaigns.map(...)` crashed with "...map is not a function" the
  // instant the picker screen tried to render (2026-09-08, reported live
  // against the desktop app's SSO login flow).
  const envelope = (await res.json()) as { data?: T };
  return envelope.data as T;
}

export function fetchMe(authHeaders: Record<string, string>): Promise<MeResponse> {
  return call<MeResponse>('/v1/me', authHeaders);
}

export function fetchMyCampaigns(authHeaders: Record<string, string>): Promise<CampaignSummary[]> {
  return call<CampaignSummary[]>('/v1/me/campaigns', authHeaders);
}

export function joinCampaign(campaignId: string, authHeaders: Record<string, string>): Promise<void> {
  return call<void>(`/v1/campaigns/${campaignId}/join`, authHeaders, { method: 'POST' });
}

export function fetchCampaignConfig(
  campaignId: string,
  authHeaders: Record<string, string>,
): Promise<CampaignConfig> {
  return call<CampaignConfig>(`/v1/campaigns/${campaignId}/config`, authHeaders);
}

export interface SelfEnrollDeviceResult {
  deviceId: string;
  deviceSecret: string;
  apiBaseUrl: string;
  campaignId: string | null;
}

/**
 * `POST /v1/devices/self-enroll` (SSO user token, no device credentials
 * needed — this IS how a kiosk gets its first device credentials). Ties
 * this kiosk to `campaignId` so the *separate*, still device-credential-
 * gated stats/events pipeline (`apps/desktop/src/main/statsEvents.ts`'s
 * `DeviceApiClient`, unrelated to the SSO-authenticated campaign-config
 * fetch this file's other functions use) has something to authenticate
 * with — see `apps/desktop/src/renderer/CampaignGate.tsx`'s own doc comment
 * on why this call exists at all: without it, `SESSION_REPORT` events (what
 * makes a captured session show up in the CMS's photo-review list) silently
 * never leave the kiosk, with no error surfaced anywhere (2026-09-08 field
 * report — "ấn lưu nhưng CMS không thấy thông tin ảnh chụp").
 */
/**
 * `GET /v1/campaigns/:id/roster/lookup?citizenId=...` result — see
 * `apps/api`'s `RosterLookupResultDao`. `found: false` is a normal, expected
 * result (a scan simply not matching this campaign's expected-student
 * roster), not an error — callers branch on this boolean directly rather
 * than on a caught exception, so a transient network/API failure (thrown by
 * `call()` below as a `CampaignPortalApiError`) is never confused with a
 * genuine no-match. See `FaceCaptureApp.tsx`'s `handleCccdScan`.
 */
export interface RosterLookupResult {
  found: boolean;
  studentCode?: string;
  studentName?: string;
  className?: string;
  major?: string;
  academicYear?: string;
  citizenId?: string;
}

/**
 * The kiosk's own call, made the moment `apps/desktop/src/main/cccdWatcher.ts`
 * reports a freshly scanned CCCD number (2026-09-09 "quét CCCD thay cho
 * nhập mã SV" feature) — gated server-side the same way `fetchCampaignConfig`
 * already is (`CampaignMemberGuard`: an SSO-logged-in, APPROVED member of an
 * OPEN campaign), so a failure here is a transient/authorization issue, not
 * something this call needs to special-case.
 */
export function lookupRosterByCitizenId(
  campaignId: string,
  citizenId: string,
  authHeaders: Record<string, string>,
): Promise<RosterLookupResult> {
  return call<RosterLookupResult>(
    `/v1/campaigns/${campaignId}/roster/lookup?citizenId=${encodeURIComponent(citizenId)}`,
    authHeaders,
  );
}

export function selfEnrollDevice(
  input: { hostname: string; fingerprint: string; os?: string; campaignId?: string },
  authHeaders: Record<string, string>,
): Promise<SelfEnrollDeviceResult> {
  return call<SelfEnrollDeviceResult>('/v1/devices/self-enroll', authHeaders, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
