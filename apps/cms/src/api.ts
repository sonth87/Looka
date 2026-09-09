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
export type DeviceStatus = 'REGISTERED' | 'ACTIVATED' | 'REVOKED';

/** Admin override on top of the inferred (date-based) status — see `campaign-config-sso-card-photo-discussion.md` §3.1.2. `null`/absent means "để tự động suy". */
export type ManualStatus = 'PAUSED' | 'CLOSED';

/** Server-computed status (§3.1.2's `effectiveStatus` formula) — not stored, just returned alongside the campaign. Optional here because this field is new (2026-09-08 plan) and may not exist yet on every backend response this client talks to. */
export type EffectiveStatus = 'UPCOMING' | 'OPEN' | 'EXPIRED' | 'PAUSED' | 'CLOSED';

export interface AnglePoseAxis {
  target: number;
  tolerance: number;
}

/** `card_spec` jsonb column — §3.1.1/§3.5. Every field optional: an older campaign (or a backend not yet shipping this column) simply has no card spec, and `CampaignForm`'s "Ảnh thẻ" section falls back to sane defaults. */
export interface CardSpec {
  size?: string;
  dpi?: number;
  backgroundColor?: string;
  /** `[min, max]` fraction of frame height the head should occupy. */
  headHeightRatio?: [number, number];
  /** `[min, max]` fraction of frame height the eye line should sit at, from the top. */
  eyeLineRatio?: [number, number];
  retouch?: {
    enabled?: boolean;
    strength?: 'LIGHT' | 'MEDIUM' | 'STRONG';
  };
}

export interface Campaign {
  id: string;
  /** "Mã campaign", e.g. `2026DOT01` — §3.1.1. Optional/nullable so this client doesn't break against a campaign created before this field existed. */
  code?: string | null;
  name: string;
  description?: string;
  purpose: CampaignPurpose;
  /** "Khóa" (K20…) — §3.1.1, not required by the BRD. */
  cohort?: string | null;
  /** "Thời gian chụp" — start of the capture window; `null` = no lower bound. */
  startsAt?: string | null;
  expiresAt?: string | null;
  /** "Số lượng cần chụp" (planned SV count) — `null`/absent = không giới hạn. */
  quotaPlanned?: number | null;
  manualStatus?: ManualStatus | null;
  /** See `EffectiveStatus`'s own doc comment — server-computed, may be absent. */
  effectiveStatus?: EffectiveStatus;
  quotaReached?: boolean;
  /** Read-only "cần tối đa K camera" summary — distinct non-empty `cameraRole` values in `captureAngles`. May be absent on an older backend; `CaptureAnglesTable` also computes this client-side as a fallback. */
  requiredCameraCount?: number;
  consentContent?: string | null;
  consentVersion: number;
  captureAngles?: Record<string, unknown>[] | null;
  /**
   * @deprecated Capture-mode/simultaneous-capture moved to the kiosk's own
   * device settings (Camera Setup) — see
   * `campaign-config-sso-card-photo-discussion.md` §3.1.1 (Q11 đã chốt) and
   * §3.9. Kept here, still optional, purely so this client doesn't crash
   * reading an older campaign row or a backend still mid-migration; the new
   * `CampaignForm` never reads or writes these three fields.
   */
  captureMode?: CaptureTriggerMode | null;
  /** @deprecated see `captureMode`. */
  autoHoldMs?: number | null;
  /** @deprecated see `captureMode`. */
  simultaneousCapture?: boolean;
  recordVideo: boolean;
  /** `null`/absent = every camera role records; otherwise the explicit subset. */
  recordVideoRoles?: string[] | null;
  cardSpec?: CardSpec | null;
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
  /**
   * Secret rotation with overlap (2026-09-08 — see docs/ROADMAP.md's dated
   * entry): non-null means a `reissueDevice` call rotated the secret and
   * the kiosk hasn't loaded the new package yet — the OLD secret is still
   * valid, no time limit, until it does (or an admin revokes). This is the
   * single source of truth for that "chưa nạp gói mới" chip — there is no
   * separate boolean, mirroring the API's own `Device` entity.
   */
  secretRotatedAt?: string | null;
  /** Last time this device's secret successfully authenticated — "xác thực gần nhất". */
  lastAuthAt?: string | null;
  /** Last time this device's secret was rejected — paired with `lastAuthFailReason`. */
  lastAuthFailedAt?: string | null;
  lastAuthFailReason?: 'INVALID_SECRET' | 'EXPIRED' | 'REVOKED' | null;
  /** Set when `revokeDevice` was called — display-only, the actual source of truth is `status === 'REVOKED'`. */
  revokedAt?: string | null;
  /**
   * Self-enrollment fields (`campaign-config-sso-card-photo-discussion.md`
   * §3.3's `devices` schema additions: `hostname`, `fingerprint`,
   * `last_user_id`) — a device that self-enrolled from the kiosk (rather
   * than the legacy admin zip-registration flow) may carry these; all three
   * are optional/undefined for a device registered the old way, or if this
   * backend hasn't shipped self-enroll yet. `DevicesPanel` renders "—" for
   * whichever of these is absent rather than assuming they exist.
   */
  hostname?: string | null;
  fingerprint?: string | null;
  /** Display name of the last SSO user this device authenticated as — exact shape/field-name guessed (the plan only specifies `last_user_id` as a user-id column server-side); render "—" if absent. */
  lastUserId?: string | null;
  lastUserName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  code?: string;
  name: string;
  description?: string;
  purpose?: CampaignPurpose;
  cohort?: string;
  startsAt?: string;
  expiresAt?: string;
  quotaPlanned?: number | null;
  manualStatus?: ManualStatus | null;
  consentContent?: string;
  captureAngles?: Record<string, unknown>[];
  recordVideo?: boolean;
  recordVideoRoles?: string[] | null;
  cardSpec?: CardSpec | null;
}

export interface UpdateCampaignInput {
  code?: string;
  name?: string;
  description?: string;
  cohort?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  quotaPlanned?: number | null;
  manualStatus?: ManualStatus | null;
  consentContent?: string;
  captureAngles?: Record<string, unknown>[];
  recordVideo?: boolean;
  recordVideoRoles?: string[] | null;
  cardSpec?: CardSpec | null;
}

export type DesktopOs = 'mac' | 'win';

export interface CreateDeviceInput {
  name: string;
  authApiEndpoint?: string;
  os?: DesktopOs;
}

/**
 * Capture counts by trigger source (`campaign-config-sso-card-photo-discussion.md`
 * §3.7.1) — `GESTURE` (held hand gesture, `MANUAL` capture mode) and
 * `SHUTTER` (on-screen button, any mode) are both shown to the operator
 * under one combined "Thủ công" tile per Q15's decision; `AUTO` is "Tự
 * động"; `EXTERNAL` (a side camera fired alongside CENTER) has no tile of
 * its own today. Optional on every stats shape below — absent entirely on
 * a backend that hasn't shipped §3.7 yet, not just zero-filled.
 */
export interface CaptureTriggerBreakdown {
  AUTO: number;
  GESTURE: number;
  SHUTTER: number;
  EXTERNAL: number;
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
  /** Per-operator ("cán bộ chụp") breakdown — see `CampaignOperatorStats`'s own doc comment. */
  byOperator: CampaignOperatorStats[];
  byDay: CampaignDayStats[];
  byTrigger?: CaptureTriggerBreakdown;
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

/**
 * Per-operator ("cán bộ chụp"/giảng viên) row in a campaign's stats
 * (2026-09-09) — `operatorUserId: null` groups every session with no
 * operator identity recorded (a kiosk build/session predating this) under
 * one row rather than dropping those sessions from the count; see
 * `CampaignOperatorStatsDao`'s own doc comment server-side.
 */
export interface CampaignOperatorStats {
  operatorUserId: string | null;
  operatorName: string;
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

/** One recorded video — no stepId/attempt (a video is never retaken); bytes live only on the file server, same as SessionPhoto. */
export interface SessionVideo {
  id: string;
  cameraRole?: string;
  mimeType: string;
  bytes: number;
  durationMs?: number;
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
  videos: SessionVideo[];
}

/**
 * "Đang chụp" info for a student row — `campaign-config-sso-card-photo-discussion.md`
 * §3.8.2's planned `StudentListItemDao.lastSession { deviceName, capturedAt,
 * photoCount }` addition (not yet shipped as of this pass; every field
 * optional so `CampaignStudentsPanel` degrades to "—" against the current API shape).
 */
export interface StudentLastSession {
  deviceName?: string;
  capturedAt?: string;
  photoCount?: number;
}

/** One row of `GET /v1/students` — one per distinct mã sinh viên, not per session (a student may have several, across campaigns/days). */
export interface StudentListItem {
  subjectCode: string;
  subjectName?: string;
  sessionCount: number;
  totalPhotos: number;
  lastCapturedAt?: string;
  campaignIds: string[];
  lastSession?: StudentLastSession;
}

/** A photo/video inside a student's session summary, with viewUrl already resolved server-side — see StudentService.getStudentDetail's own doc comment (apps/api) for why. */
export interface StudentSessionPhoto {
  id: string;
  cameraRole?: string;
  mimeType: string;
  fsStatus?: string;
  viewUrl?: string;
  viewUrlExpiresAt?: string;
}

export interface StudentSessionVideo {
  id: string;
  cameraRole?: string;
  mimeType: string;
  durationMs?: number;
  fsStatus?: string;
  viewUrl?: string;
  viewUrlExpiresAt?: string;
}

/** One of a student's sessions, inside `GET /v1/students/:code` — a summary, not the full SessionDetail; click through to SessionDetailDrawer (via `id`) for the full single-session view. */
export interface StudentSessionSummary {
  id: string;
  source: SessionSource;
  deviceId?: string;
  deviceName?: string;
  campaignId?: string;
  status: SessionStatus;
  capturedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  photos: StudentSessionPhoto[];
  videos: StudentSessionVideo[];
}

/** `GET /v1/students/:code` — every session the student has, across every campaign (ignores whatever campaign filter reached the list page). */
export interface StudentDetail {
  subjectCode: string;
  subjectName?: string;
  sessions: StudentSessionSummary[];
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

// --- Capture-angle catalog (C3 "Góc chụp") -----------------------------------
// See docs/plans/campaign-config-sso-card-photo-discussion.md §3.1.6 and
// docs/plans/ui-redesign-plan.md §3 C3. Endpoint paths are exactly as given in
// this app's task spec (`GET/POST/PATCH /v1/capture-angle-presets`); field
// names below are a literal reading of §3.1.6's `capture_angle_presets`
// column list (camelCased) since no DTO was visible from this concurrent
// backend workstream at build time — reconcile if the real response differs.

export type CameraRoleName = 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

export interface AnglePoseDefault {
  yaw?: AnglePoseAxis;
  pitch?: AnglePoseAxis;
  roll?: AnglePoseAxis;
}

export interface CaptureAnglePreset {
  id: string;
  /** Unique, locked after creation — `FRONT`, `LEFT_30`, `SMILE`, ... */
  code: string;
  labelVi: string;
  instructionVi?: string | null;
  poseDefault: AnglePoseDefault;
  preferredCameraRole: CameraRoleName;
  /** One of the 5 seeded original angles — editable but not deletable (§3.1.6). */
  isSystem: boolean;
  active: boolean;
  sortOrder?: number;
  /** "Dùng N cp" column in the C3 mockup — how many campaigns currently reference this preset. Field name guessed (not in §3.1.6's column list); render "—" if absent rather than 0. */
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateAnglePresetInput {
  code: string;
  labelVi: string;
  instructionVi?: string;
  poseDefault: AnglePoseDefault;
  preferredCameraRole: CameraRoleName;
  active?: boolean;
  sortOrder?: number;
}

export interface UpdateAnglePresetInput {
  labelVi?: string;
  instructionVi?: string;
  poseDefault?: AnglePoseDefault;
  preferredCameraRole?: CameraRoleName;
  active?: boolean;
  sortOrder?: number;
}

export const listAnglePresets = () => request<CaptureAnglePreset[]>('/v1/capture-angle-presets');
export const createAnglePreset = (input: CreateAnglePresetInput) =>
  request<CaptureAnglePreset>('/v1/capture-angle-presets', { method: 'POST', body: JSON.stringify(input) });
export const updateAnglePreset = (id: string, input: UpdateAnglePresetInput) =>
  request<CaptureAnglePreset>(`/v1/capture-angle-presets/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

// --- Capture Configurations ("Cấu hình chụp" — reusable template) ----------
// Item 10 of the 2026-09-09 task brief: a reusable capture template an admin
// manages independently of any one campaign — "Configuration 1: 3 camera,
// gán trái/phải/chính giữa, chụp tỉ lệ 4x6, cộng các tham số khác". Deliberately
// a preset, not a live link: `CampaignForm.tsx`'s "Chọn từ cấu hình có sẵn"
// copies one of these onto the campaign's own `captureAngles`/`cardSpec`
// fields ONCE, at creation/edit time — editing this configuration later, or
// deleting it, never touches any campaign that already copied its values in.
// Endpoints: `GET/POST/PATCH/DELETE /v1/capture-configurations` (device-management
// module, apps/api).

export interface CaptureConfiguration {
  id: string;
  name: string;
  description?: string | null;
  captureAngles: Record<string, unknown>[];
  cardSpec?: CardSpec | null;
  /** Read-only "cần tối đa K camera" hint — same derivation as `Campaign.requiredCameraCount`. */
  requiredCameraCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCaptureConfigurationInput {
  name: string;
  description?: string;
  captureAngles: Record<string, unknown>[];
  cardSpec?: CardSpec | null;
}

export interface UpdateCaptureConfigurationInput {
  name?: string;
  description?: string;
  captureAngles?: Record<string, unknown>[];
  cardSpec?: CardSpec | null;
}

export const listCaptureConfigurations = () => request<CaptureConfiguration[]>('/v1/capture-configurations');
export const getCaptureConfiguration = (id: string) =>
  request<CaptureConfiguration>(`/v1/capture-configurations/${id}`);
export const createCaptureConfiguration = (input: CreateCaptureConfigurationInput) =>
  request<CaptureConfiguration>('/v1/capture-configurations', { method: 'POST', body: JSON.stringify(input) });
export const updateCaptureConfiguration = (id: string, input: UpdateCaptureConfigurationInput) =>
  request<CaptureConfiguration>(`/v1/capture-configurations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteCaptureConfiguration = (id: string) =>
  request<{ id: string }>(`/v1/capture-configurations/${id}`, { method: 'DELETE' });

// --- Campaign members ("Cán bộ chụp") ----------------------------------------
// See docs/plans/campaign-config-sso-card-photo-discussion.md §2.3/§3.2.2 for
// the `campaign_members`/`users` schema this mirrors, and this app's task
// spec for the exact endpoint paths and PATCH body shape.

export type MembershipStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type MembershipAction = 'approve' | 'reject' | 'revoke';

export interface CampaignMember {
  userId: string;
  /** Real columns on `CampaignMemberDao` as of 2026-09-08 — merged in server-side from `users` by `userId` (see `CampaignMemberService.attachIdentity`), not a `campaign_members` column itself. */
  email: string;
  displayName?: string | null;
  status: MembershipStatus;
  requestedAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  note?: string | null;
}

/**
 * REGRESSION FIX (2026-09-08): `GET /v1/campaigns/:id/members` returns a
 * paginated `{items, meta}` wrapper (`@ApiResponsePaginatedDecorator` on
 * the controller, `Promise<Pagination<CampaignMemberDao>>` on the service)
 * — this used to be typed/parsed as a bare array, so every caller's
 * `members?.filter(...)` threw `TypeError: members.filter is not a
 * function` at render time (no error boundary catches it), crashing to a
 * blank white screen. `status` lets a caller (e.g. the compact pending-
 * approvals card) fetch only what it needs instead of every member; `limit`
 * defaults high since this is an admin-only per-campaign list, not
 * expected to need real pagination controls in the UI yet.
 */
export const listCampaignMembers = (campaignId: string, status?: MembershipStatus) => {
  // `QueryPaginateDto` (apps/api/src/common/dto) caps `limit` at 100 — a
  // higher value 400s the whole request. Confirmed against the real
  // running API, not assumed (see this project's own history of shipping
  // "fixes" that were never actually run against a live backend).
  const search = new URLSearchParams({ limit: '100' });
  if (status) search.set('status', status);
  return request<Paginated<CampaignMember>>(`/v1/campaigns/${campaignId}/members?${search.toString()}`).then(
    (res) => res.items,
  );
};

export const updateCampaignMember = (
  campaignId: string,
  userId: string,
  action: MembershipAction,
  note?: string
) =>
  request<CampaignMember>(`/v1/campaigns/${campaignId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action, note }),
  });

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

export interface ListStudentsParams {
  campaignId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

/**
 * "Sinh viên đã chụp" (2026-09-08) — grouped by subjectCode, global across
 * campaigns unless filtered. Reachable from both the CMS (via the SSO
 * headers `request()` already attaches) and apps/web (via its own api-key) —
 * see apps/api's `ApiKeyOrSsoGuard`.
 */
export function listStudents(params: ListStudentsParams = {}): Promise<Paginated<StudentListItem>> {
  const search = new URLSearchParams();
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<StudentListItem>>(`/v1/students${qs ? `?${qs}` : ''}`);
}

/** One student, every session across every campaign — photos/videos come with `viewUrl` already resolved. */
export const getStudent = (code: string) => request<StudentDetail>(`/v1/students/${encodeURIComponent(code)}`);

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

/** Same contract as `issuePhotoViewLink`, for a session's recorded video (`POST /v1/videos/:id/view-link`). */
export const issueVideoViewLink = (videoId: string, viewerId = 'cms-admin') =>
  request<PhotoViewLink>(`/v1/videos/${videoId}/view-link`, {
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
 * Rotates an existing device's secret WITH OVERLAP and returns a fresh
 * activation zip — see `DeviceController.reissueDevice`'s own doc comment
 * server-side: this works for a device in any status, including ACTIVATED,
 * and (2026-09-08, fixing the "kiosk 3" incident — see docs/ROADMAP.md's
 * dated entry) no longer stops an already-running kiosk from authenticating.
 * The old secret stays valid, no time limit, until either the new one is
 * used or the device is explicitly revoked via `revokeDevice` below — so
 * this no longer needs an operator confirmation before calling it for an
 * ACTIVATED device (that confirmation used to exist because this call used
 * to revoke on the spot; see `DevicesPanel.tsx`).
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
 * touches the device secret. Rejected (409, `DEVICE_REVOKED`) for a REVOKED
 * device — reissuing is the only way back in for one of those.
 */
export const activateDevice = (deviceId: string) =>
  request<Device>(`/v1/devices/${deviceId}/activate`, { method: 'POST' });

/**
 * "Thu hồi" (revoke) — 2026-09-08: invalidates every secret this device has
 * (current + previous) immediately, no overlap. The explicit hard-stop
 * counterpart to `reissueDevice`'s soft, overlapping rotation — see
 * `DeviceService.revokeDevice`'s own doc comment server-side.
 */
export const revokeDevice = (deviceId: string) =>
  request<Device>(`/v1/devices/${deviceId}/revoke`, { method: 'POST' });

// --- Photo review (apps/cms/src/photo-review) --------------------------------
// Mirrors docs/plans/cms-photo-review-plan.md §2 (data model) and §7 (API
// table) exactly for endpoint paths; field names are a literal camelCase
// reading of §2's column lists, since the review-page backend workstream
// (R1/R2 in §9) was concurrent with this UI pass and no real DTO was visible
// at build time. Every optional field below is optional because of that —
// reconcile names here first if the real API disagrees, per this app's task
// spec ("keep all new API-calling code in small, easy-to-adjust functions").

export type ReviewSetStatus = 'PENDING_AUTO' | 'AUTO_FAILED' | 'READY' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
export type PhotoVariantKind = 'CARD_AUTO' | 'CARD_AI' | 'CARD_UPLOAD';
export type PhotoVariantStatus = 'PROCESSING' | 'READY' | 'FAILED' | 'DISCARDED';
export type AiEditRegion = 'OUTSIDE_FACE' | 'GLASSES' | 'HAIR' | 'FULL';

/** One row of `GET /v1/review/sets` — a subject's photo profile within one campaign (§2's `subject_photo_sets`), with the current card photo's view-link already resolved server-side per §7's endpoint doc comment. */
export interface ReviewSetListItem {
  id: string;
  campaignId: string;
  campaignName?: string;
  kindId?: string;
  kindLabel?: string;
  subjectCode: string;
  subjectName?: string;
  status: ReviewSetStatus;
  currentCardVariantId?: string | null;
  /** Short-lived view-link for the grid thumbnail — absent while locked (no current variant yet). */
  currentCardViewUrl?: string | null;
  currentCardVariantKind?: PhotoVariantKind | null;
  currentCardVersion?: number | null;
  hasAi?: boolean;
  hasUpload?: boolean;
  /** From the originating session's photo metadata (`fallback: true`) — a side angle that was actually captured with CENTER because the assigned camera was missing. */
  hasFallback?: boolean;
  /** Populated when `status` is `AUTO_FAILED` — e.g. "mặt quá nhỏ". */
  failReason?: string | null;
  updatedAt: string;
}

/** Mirrors `ReviewOriginalPhotoDao` (apps/api/src/modules/photo-review/dao/review-set.dao.ts) exactly — no `viewUrl` is embedded here, unlike `PhotoVariant`; callers must resolve one per photo via `issuePhotoViewLink`, same as `SessionDetailDrawer` does for `SessionPhoto`. */
export interface ReviewOriginalPhoto {
  id: string;
  stepId: string;
  stepType?: string;
  cameraRole?: string;
  attempt: number;
  mimeType: string;
  fsFileId?: string;
  fsStatus?: string;
  capturedAt?: string;
}

export interface ReviewOriginalVideo {
  id: string;
  cameraRole?: string;
  durationMs?: number;
  viewUrl?: string;
}

/** One `photo_variants` row (§2) — a version of the card photo, never deleted, only ever `DISCARDED`. */
export interface PhotoVariant {
  id: string;
  setId: string;
  version: number;
  kind: PhotoVariantKind;
  status: PhotoVariantStatus;
  viewUrl?: string;
  prompt?: string | null;
  regionMode?: AiEditRegion | null;
  modelId?: string | null;
  seed?: number | null;
  identitySimilarity?: number | null;
  qualityReport?: Record<string, unknown> | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdAt: string;
  note?: string | null;
}

/** One `photo_review_events` row (§2) — audit log entry shown in the detail page's "Lịch sử" strip. */
export interface ReviewEvent {
  id: string;
  setId: string;
  variantId?: string | null;
  action: string;
  actorUserId?: string | null;
  actorName?: string | null;
  payload?: Record<string, unknown> | null;
  at: string;
}

/** `GET /v1/review/sets/:id` — the full profile: originals (read-only), video, every card-photo version, and the event log. */
export interface ReviewSetDetail extends ReviewSetListItem {
  sourceSessionId?: string;
  sourceCapturedAt?: string;
  sourceDeviceName?: string;
  originalPhotos: ReviewOriginalPhoto[];
  videos: ReviewOriginalVideo[];
  variants: PhotoVariant[];
  events: ReviewEvent[];
}

export interface ListReviewSetsParams {
  campaignId?: string;
  kindId?: string;
  status?: ReviewSetStatus;
  hasAi?: boolean;
  hasUpload?: boolean;
  missingCard?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

/** `GET /v1/review/sets?campaignId&kindId&status&hasAi&hasUpload&missingCard&q&page` (§7). */
export function listReviewSets(params: ListReviewSetsParams = {}): Promise<Paginated<ReviewSetListItem>> {
  const search = new URLSearchParams();
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.kindId) search.set('kindId', params.kindId);
  if (params.status) search.set('status', params.status);
  if (params.hasAi) search.set('hasAi', 'true');
  if (params.hasUpload) search.set('hasUpload', 'true');
  if (params.missingCard) search.set('missingCard', 'true');
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<ReviewSetListItem>>(`/v1/review/sets${qs ? `?${qs}` : ''}`);
}

export const getReviewSet = (id: string) => request<ReviewSetDetail>(`/v1/review/sets/${id}`);

/** "Tạo lại ảnh 4x6" — re-runs the deterministic `CARD_AUTO` pipeline (R-Q1), the one action allowed while a set is locked in `AUTO_FAILED`. */
export const reprocessReviewSet = (id: string) =>
  request<ReviewSetDetail>(`/v1/review/sets/${id}/reprocess`, { method: 'POST' });

export interface AiEditInput {
  prompt: string;
  region: AiEditRegion;
  fromVariantId?: string;
}

export type AiEditJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

/** `GET /v1/review/jobs/:id` poll response — a running "Sửa bằng AI" job (§5.3/§6.4). */
export interface AiEditJob {
  id: string;
  status: AiEditJobStatus;
  previewUrl?: string;
  identitySimilarity?: number;
  seed?: number;
  durationMs?: number;
  modelId?: string;
  /** The variant to `acceptVariant`/`discardVariant` once the job is DONE. */
  resultVariantId?: string;
  error?: string;
}

/** `POST /v1/review/sets/:id/ai-edit` — creates a background job; a 422 (surfaced as `ApiError`) means the prompt was refused by the keyword filter (§5.3/§6.2 rule 4). */
export const requestAiEdit = (setId: string, input: AiEditInput) =>
  request<AiEditJob>(`/v1/review/sets/${setId}/ai-edit`, { method: 'POST', body: JSON.stringify(input) });

export const getReviewJob = (jobId: string) => request<AiEditJob>(`/v1/review/jobs/${jobId}`);

/** Only an explicit accept turns a job's result into a real, addressable version (§5.3) — never auto-applied. */
export const acceptVariant = (variantId: string) =>
  request<PhotoVariant>(`/v1/review/variants/${variantId}/accept`, { method: 'POST' });

export const discardVariant = (variantId: string) =>
  request<PhotoVariant>(`/v1/review/variants/${variantId}/discard`, { method: 'POST' });

export const setCurrentVariant = (setId: string, variantId: string) =>
  request<ReviewSetDetail>(`/v1/review/sets/${setId}/current`, {
    method: 'POST',
    body: JSON.stringify({ variantId }),
  });

export const approveReviewSet = (setId: string, note?: string) =>
  request<ReviewSetDetail>(`/v1/review/sets/${setId}/approve`, { method: 'POST', body: JSON.stringify({ note }) });

export const rejectReviewSet = (setId: string, note?: string) =>
  request<ReviewSetDetail>(`/v1/review/sets/${setId}/reject`, { method: 'POST', body: JSON.stringify({ note }) });

export const listReviewEvents = (setId: string) => request<ReviewEvent[]>(`/v1/review/sets/${setId}/events`);

/**
 * "Loại ảnh" — `GET/POST/PATCH /v1/photo-kinds` (ADMIN only, §7). No DELETE
 * endpoint exists (same never-hard-delete convention as capture angle
 * presets/photo variants elsewhere in this API) — "xóa" in the CMS is a
 * PATCH setting `active: false`, see `PhotoKindsPage.tsx`. Reuses the
 * `CardSpec` interface already declared above (`campaigns.card_spec`) —
 * a `photo_kinds` row's `cardSpec` is the same shape, just the reusable
 * default a campaign of that kind starts from.
 */
export interface PhotoKind {
  id: string;
  code: string;
  labelVi: string;
  cardSpec: CardSpec;
  qualityProfile?: Record<string, unknown> | null;
  promptHints: string[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePhotoKindInput {
  code: string;
  labelVi: string;
  cardSpec: CardSpec;
  qualityProfile?: Record<string, unknown>;
  promptHints?: string[];
  active?: boolean;
}

export interface UpdatePhotoKindInput {
  labelVi?: string;
  cardSpec?: CardSpec;
  qualityProfile?: Record<string, unknown>;
  promptHints?: string[];
  active?: boolean;
}

export const listPhotoKinds = () => request<PhotoKind[]>('/v1/photo-kinds');
export const createPhotoKind = (input: CreatePhotoKindInput) =>
  request<PhotoKind>('/v1/photo-kinds', { method: 'POST', body: JSON.stringify(input) });
export const updatePhotoKind = (id: string, input: UpdatePhotoKindInput) =>
  request<PhotoKind>(`/v1/photo-kinds/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export interface UploadReplaceResult {
  variant: PhotoVariant;
  /** e.g. "có thể không phải cùng người" — identity-similarity warning band 0.70–0.85 (§5.4/R-Q8), non-fatal. */
  warning?: string;
}

/**
 * `POST /v1/review/sets/:id/upload` (multipart) — mirrors `fetchActivationZip`'s
 * reasoning for why this isn't the plain `request()` helper: this endpoint
 * needs a `FormData` body (no `Content-Type` set manually — the browser adds
 * the multipart boundary) rather than a JSON one, but still returns the
 * normal `{ data }` envelope, unlike the zip endpoints.
 */
export async function uploadReplacePhoto(setId: string, file: File): Promise<UploadReplaceResult> {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${baseUrl()}/v1/review/sets/${setId}/upload`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: form,
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

  const envelope = (await res.json()) as { data: UploadReplaceResult };
  return envelope.data;
}
