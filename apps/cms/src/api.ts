/**
 * Client for apps/api's device-management module — see
 * docs/plans/multi-camera-device-management-discussion.md §3.4. Types here
 * are a deliberate, separate copy of the server's DAOs: this is a real REST
 * boundary (a different app, a different build), not internal duplication
 * to avoid — the server is free to change its DAO shape without this file
 * needing a workspace dependency on a NestJS app.
 *
 * Auth: every call here is CMS/admin traffic - as of 2026-09-07 the backend
 * checks a Bearer token via SsoAuthGuard (docs/LOGIN.md §12) instead of the
 * old shared x-api-key, so `request()`/`registerDevice()` below attach
 * `Authorization`/`x-refresh-token` read from `auth/authCookies.ts` rather
 * than an api-key header.
 */
import { getAccessToken, getRefreshToken } from './auth/authCookies';

export type CampaignPurpose = 'STUDENT_CARD' | 'KYC_ENROLLMENT';
export type CaptureTriggerMode = 'AUTO' | 'MANUAL' | 'OFF';
export type DeviceStatus = 'REGISTERED' | 'ACTIVATED';

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  purpose: CampaignPurpose;
  expiresAt?: string | null;
  consentContent?: string | null;
  consentVersion: number;
  captureAngles?: Record<string, unknown>[] | null;
  captureMode?: CaptureTriggerMode | null;
  autoHoldMs?: number | null;
  simultaneousCapture: boolean;
  recordVideo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  campaignId: string;
  name: string;
  authApiEndpoint?: string;
  status: DeviceStatus;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  description?: string;
  purpose?: CampaignPurpose;
  expiresAt?: string;
  consentContent?: string;
  captureAngles?: Record<string, unknown>[];
  captureMode?: CaptureTriggerMode;
  autoHoldMs?: number;
  simultaneousCapture?: boolean;
  recordVideo?: boolean;
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  expiresAt?: string | null;
  consentContent?: string;
  captureAngles?: Record<string, unknown>[];
  captureMode?: CaptureTriggerMode;
  autoHoldMs?: number;
  simultaneousCapture?: boolean;
  recordVideo?: boolean;
}

export type DesktopOs = 'mac' | 'win';

export interface CreateDeviceInput {
  name: string;
  authApiEndpoint?: string;
  os?: DesktopOs;
}

export interface CampaignStats {
  campaignId: string;
  deviceCount: number;
  sessionsCompleted: number;
  uploadSuccess: number;
  uploadFailed: number;
  retakes: number;
  cbHelpInterventions: number;
  /**
   * Completed sessions recorded in `sessions` (Phase 11) — distinct from
   * `sessionsCompleted` above, which counts SESSION_COMPLETED device events
   * instead; see `CampaignStatsDao`'s own doc comment server-side.
   */
  sessions: number;
  photos: CampaignPhotoStats;
  byDevice: CampaignDeviceStats[];
  byDay: CampaignDayStats[];
}

export interface CampaignStatsSummaryItem extends CampaignStats {
  campaignName: string;
}

/**
 * One day's point in the Overview page's trend charts — sessions-completed /
 * uploads-success/failed / retake device-event counts, summed across every
 * campaign. Mirrors `CampaignsTimeseriesPointDao` server-side; every day in
 * the requested window is present (zero-filled), so callers never need to
 * handle gaps.
 */
export interface CampaignsTimeseriesPoint {
  date: string;
  sessionsCompleted: number;
  uploadsSuccess: number;
  uploadsFailed: number;
  retakes: number;
}

export interface CampaignsTimeseries {
  points: CampaignsTimeseriesPoint[];
}

export interface AllCampaignsStats {
  totalCampaigns: number;
  totalDevices: number;
  totalSessionsCompleted: number;
  totalUploadSuccess: number;
  totalUploadFailed: number;
  totalRetakes: number;
  totalCbHelpInterventions: number;
  totalSessions: number;
  totalPhotos: CampaignPhotoStats;
  campaigns: CampaignStatsSummaryItem[];
}

// --- Phase 11: capture-session list & extended stats ------------------------
// See docs/plans/04-device-management/phase-11-capture-sessions-and-stats/implementation-plan.md.

/** Photo counts by file-server status — shared by per-campaign and cross-campaign stats. */
export interface CampaignPhotoStats {
  total: number;
  ready: number;
  pending: number;
  failed: number;
}

/** Per-device row in a campaign's stats. */
export interface CampaignDeviceStats {
  deviceId: string;
  deviceName: string;
  sessions: number;
  photosReady: number;
  photosFailed: number;
  lastCaptureAt?: string;
}

/** One day of a campaign's capture history (last 30 days, Vietnam time — computed server-side). */
export interface CampaignDayStats {
  date: string;
  sessions: number;
  photos: number;
}

export type SessionSource = 'WEB' | 'KIOSK';
export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
/** Upload-state filter for `listSessions` — derived from a session's photos server-side, not stored. */
export type SessionListState = 'all' | 'completed' | 'pending' | 'failed';

/**
 * Capture-session list/detail — one row per session regardless of whether it
 * came from the kiosk or apps/web (only kiosk sessions carry a campaignId
 * today, per the product decision to scope the CMS list to kiosk captures).
 */
export interface SessionListItem {
  id: string;
  source: SessionSource;
  deviceId?: string;
  deviceName?: string;
  campaignId?: string;
  subjectCode?: string;
  subjectName?: string;
  status: SessionStatus;
  capturedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  photoCount: number;
  photosReady: number;
  photosPending: number;
  photosFailed: number;
}

/** One captured photo — bytes live only on the file server; this is metadata plus the fs-core file id used to request a view link. */
export interface SessionPhoto {
  id: string;
  stepId: string;
  stepType?: string;
  cameraRole?: string;
  attempt: number;
  mimeType: string;
  bytes: number;
  fsFileId?: string;
  fsStatus?: string;
  localStatus?: string;
  virtualPath?: string;
  capturedAt?: string;
  uploadedAt?: string;
  readyAt?: string;
  uploadError?: string;
}

export interface SessionDetail extends SessionListItem {
  photos: SessionPhoto[];
}

/** Mirrors `PaginationMetaDao` server-side — `totalItems`/`totalPages` are optional there too. */
export interface PaginationMeta {
  itemCount: number;
  totalItems?: number;
  itemsPerPage: number;
  totalPages?: number;
  currentPage: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface ListSessionsParams {
  campaignId?: string;
  deviceId?: string;
  source?: SessionSource;
  from?: string;
  to?: string;
  state?: SessionListState;
  page?: number;
  limit?: number;
}

/** `POST /v1/photos/:id/view-link` response — `url` is a tokenised fs-core link usable directly as an `<img src>` for about 10 minutes. */
export interface PhotoViewLink {
  url: string;
  viewUrl?: string;
  expiresAt: string;
}

/**
 * `Authorization`/`x-refresh-token` for every apps/api call - read fresh on
 * each request rather than cached, same reasoning as authApi.ts's own
 * authHeaders(): the cookies can change between calls (refresh, logout).
 * Only `Authorization` is required by SsoAuthGuard; `x-refresh-token` is
 * included whenever available, matching docs/LOGIN.md §12's header pair.
 */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (refreshToken) headers['x-refresh-token'] = refreshToken;
  return headers;
}

function baseUrl(): string {
  return (window as any).LOOKA_API_BASE_URL ?? 'http://localhost:3100';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /**
     * Domain error code from the API's error envelope (`{ errorCode, message }`,
     * see `HttpResponseError` server-side), e.g. FILE_STORAGE_NOT_READY = 3000.
     * Lets callers branch on the specific failure, not just the HTTP status —
     * two different problems can both come back as a 503.
     */
    public code?: number
  ) {
    super(message);
  }
}

/** Every JSON response is `{ statusCode, message, data }` — apps/api's global ResponseTransformInterceptor. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300) || res.statusText;
    let code: number | undefined;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string; errorCode?: number };
      message = parsed.message || parsed.error || message;
      code = parsed.errorCode;
    } catch {
      /* not JSON; the raw text is the best available */
    }
    throw new ApiError(message, res.status, code);
  }

  const envelope = (await res.json()) as { data: T };
  return envelope.data;
}

export const listCampaigns = () => request<Campaign[]>('/v1/campaigns');
export const getCampaign = (id: string) => request<Campaign>(`/v1/campaigns/${id}`);
export const createCampaign = (input: CreateCampaignInput) =>
  request<Campaign>('/v1/campaigns', { method: 'POST', body: JSON.stringify(input) });
export const updateCampaign = (id: string, input: UpdateCampaignInput) =>
  request<Campaign>(`/v1/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

/**
 * Hard-deletes a campaign — refused with a 409 `ApiError` (see
 * `CampaignController`/`CampaignService` server-side) when it still has any
 * devices or capture sessions attached, since `devices.campaign_id` cascades
 * on delete (a physical kiosk's registration would be destroyed silently)
 * while `sessions.campaign_id` merely goes NULL (capture history would be
 * orphaned). Callers should surface that 409's message as-is rather than
 * retrying — the fix is to remove the campaign's devices first, not to
 * resend the request.
 */
export const deleteCampaign = (id: string) => request<{ id: string }>(`/v1/campaigns/${id}`, { method: 'DELETE' });

export const getCampaignStats = (campaignId: string) => request<CampaignStats>(`/v1/campaigns/${campaignId}/stats`);
export const getAllCampaignsStats = () => request<AllCampaignsStats>('/v1/campaigns/stats/summary');

/** Backs the Overview page's trend chart — `days` defaults to 14 both here and server-side. */
export const getCampaignsTimeseries = (days = 14) =>
  request<CampaignsTimeseries>(`/v1/campaigns/stats/timeseries?days=${days}`);

export const listDevices = (campaignId: string) => request<Device[]>(`/v1/campaigns/${campaignId}/devices`);
export const getDevice = (id: string) => request<Device>(`/v1/devices/${id}`);

/**
 * List capture sessions (Phase 11), filterable and paginated — mirrors
 * `ListSessionsQueryDto` server-side. Only params with a value are put on
 * the query string, so callers can pass a partly-filled filter object as-is.
 */
export function listSessions(params: ListSessionsParams = {}): Promise<Paginated<SessionListItem>> {
  const search = new URLSearchParams();
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.deviceId) search.set('deviceId', params.deviceId);
  if (params.source) search.set('source', params.source);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.state) search.set('state', params.state);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<SessionListItem>>(`/v1/sessions${qs ? `?${qs}` : ''}`);
}

/** One session with every one of its photos. */
export const getSession = (id: string) => request<SessionDetail>(`/v1/sessions/${id}`);

/**
 * Every signed-in SSO operator may open full-size photos (product decision 3
 * in the Phase 11 plan) — there is no per-admin identity plumbed through to
 * this call yet (the SSO profile isn't threaded into it), so `viewerId`
 * defaults to one fixed identity for every caller.
 */
export const issuePhotoViewLink = (photoId: string, viewerId = 'cms-admin') =>
  request<PhotoViewLink>(`/v1/photos/${photoId}/view-link`, {
    method: 'POST',
    body: JSON.stringify({ viewerId }),
  });

/**
 * Shared response handling for the two endpoints that hand back an
 * activation zip instead of the JSON envelope (see DeviceController's own
 * doc comments: both are `StreamableFile`, deliberately excluded from that
 * wrapping) — `registerDevice()` and `reissueDevice()` below are otherwise
 * identical POST-body-in, zip-out calls. The filename comes from the
 * server's `Content-Disposition` header rather than being reconstructed
 * here, so it stays correct if that naming ever changes server-side.
 */
async function fetchActivationZip(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text.slice(0, 300) || res.statusText, res.status);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `looka-kiosk-${Date.now()}.zip`;

  return { blob: await res.blob(), filename };
}

/** Registers a device and returns its activation zip — see `fetchActivationZip`'s own doc comment for the response shape. */
export function registerDevice(
  campaignId: string,
  input: CreateDeviceInput
): Promise<{ blob: Blob; filename: string }> {
  return fetchActivationZip(`/v1/campaigns/${campaignId}/devices`, input);
}

export interface ReissueDeviceInput {
  authApiEndpoint?: string;
  os?: DesktopOs;
}

/**
 * Rotates an existing device's secret and returns a fresh activation zip —
 * see `DeviceController.reissueDevice`'s own doc comment server-side: this
 * works for a device in any status, including ACTIVATED, and an already-
 * running kiosk's old secret stops authenticating the moment this call
 * succeeds. Callers are responsible for confirming that consequence with the
 * operator before calling this for an ACTIVATED device — see
 * `DevicesPanel.tsx`.
 */
export function reissueDevice(
  deviceId: string,
  input: ReissueDeviceInput = {}
): Promise<{ blob: Blob; filename: string }> {
  return fetchActivationZip(`/v1/devices/${deviceId}/reissue`, input);
}

/**
 * Manually marks a device ACTIVATED — see `DeviceController.activateDevice`'s
 * doc comment server-side: for testing/ops, when an admin wants the device
 * to read as activated without waiting for a real kiosk to call in. Never
 * touches the device secret.
 */
export const activateDevice = (deviceId: string) =>
  request<Device>(`/v1/devices/${deviceId}/activate`, { method: 'POST' });
