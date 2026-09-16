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

/** A campaign's pinned workflow — see `CampaignWorkflowRefDao` server-side; only present when `workflowVersionId` is set and still resolves to a real (published) version. */
export interface CampaignWorkflowRef {
  id: string;
  code: string;
  versionId: string;
  version: number;
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
  /** "Yêu cầu đăng ký khuôn mặt (embedding)" — whether captured photos get sent to the external face-embedding server. Default `true` server-side (embedding used to always run for every campaign). */
  requiresEmbedding: boolean;
  cardSpec?: CardSpec | null;
  /** Resolved server-side from `workflowVersionId` — send `workflowVersionId` to change the pin, this field is read-only. `null`/absent = no workflow pinned (or the pin no longer resolves). */
  workflow?: CampaignWorkflowRef | null;
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
  requiresEmbedding?: boolean;
  cardSpec?: CardSpec | null;
  /** Must be a PUBLISHED workflow version's id — `workflowId` is derived server-side, not sent here. */
  workflowVersionId?: string;
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
  requiresEmbedding?: boolean;
  cardSpec?: CardSpec | null;
  /** Must be a PUBLISHED workflow version's id; `null` clears the pin. */
  workflowVersionId?: string | null;
}

export type DesktopOs = 'mac' | 'win';

export interface CreateDeviceInput {
  name: string;
  authApiEndpoint?: string;
  os?: DesktopOs;
}

/**
 * One row of `byTrigger`/`byCaptureMode` (cms-8-screens-api-plan.md §2.3,
 * `CampaignBreakdownCountDao` server-side) — grouped counts keyed by
 * `trigger_source` (`AUTO` | `GESTURE` | `SHUTTER` | `EXTERNAL`) or
 * `capture_mode`, NOT a fixed `{AUTO, GESTURE, ...}` object: a category
 * with zero photos simply has no row at all, so callers must look up by
 * key and default missing ones to 0 (see `breakdownCount` below) rather
 * than assume every key is present. `key: null` groups photos from a
 * kiosk build old enough not to report the field.
 */
export interface CampaignBreakdownCount {
  key: string | null;
  count: number;
}

/** Looks up one key's count in a `byTrigger`/`byCaptureMode` array, defaulting a missing (zero-count) key to 0 — see `CampaignBreakdownCount`'s own doc comment for why a key can be absent. */
export function breakdownCount(rows: CampaignBreakdownCount[] | undefined, key: string): number {
  return rows?.find((r) => r.key === key)?.count ?? 0;
}

export interface CampaignStats {
  campaignId: string;
  deviceCount: number;
  sessionsCompleted: number;
  uploadSuccess: number;
  uploadFailed: number;
  retakes: number;
  cbHelpInterventions: number;
  /** Successful face-embedding registrations (2026-09-15) — a CENTER-step capture the external embedding server accepted. */
  embeddingEnrolled: number;
  /** Definitive embedding-registration failures (2026-09-15) — a real server rejection (e.g. "ảnh có N khuôn mặt") or exhausted retries; never counts an in-progress retry. */
  embeddingFailed: number;
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
  byTrigger?: CampaignBreakdownCount[];
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

const CAPTURE_ANGLE_PRESETS_PATH = '/v1/capture-angle-presets';

/** Every preset in one call, active-only unless `includeInactive` — for pickers (e.g. `CaptureAnglesTable`) that need the full catalog at once. Use `listAnglePresetsPaginated` for a management list instead. */
export const listAnglePresets = (includeInactive = false) =>
  request<CaptureAnglePreset[]>(`${CAPTURE_ANGLE_PRESETS_PATH}${includeInactive ? '?includeInactive=true' : ''}`);
export const listAnglePresetsPaginated = (params: {
  page: number;
  limit?: number;
  includeInactive?: boolean;
  q?: string;
}) => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit ?? 20));
  if (params.includeInactive) search.set('includeInactive', 'true');
  if (params.q) search.set('q', params.q);
  return request<Paginated<CaptureAnglePreset>>(`${CAPTURE_ANGLE_PRESETS_PATH}?${search.toString()}`);
};
export const createAnglePreset = (input: CreateAnglePresetInput) =>
  request<CaptureAnglePreset>(CAPTURE_ANGLE_PRESETS_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updateAnglePreset = (id: string, input: UpdateAnglePresetInput) =>
  request<CaptureAnglePreset>(`${CAPTURE_ANGLE_PRESETS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

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

const CAPTURE_CONFIGURATIONS_PATH = '/v1/capture-configurations';

/** Every configuration in one call — for `CampaignForm.tsx`'s picker. Use `listCaptureConfigurationsPaginated` for a management list instead. */
export const listCaptureConfigurations = () => request<CaptureConfiguration[]>(CAPTURE_CONFIGURATIONS_PATH);
export const listCaptureConfigurationsPaginated = (params: { page: number; limit?: number; q?: string }) => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit ?? 20));
  if (params.q) search.set('q', params.q);
  return request<Paginated<CaptureConfiguration>>(`${CAPTURE_CONFIGURATIONS_PATH}?${search.toString()}`);
};
export const getCaptureConfiguration = (id: string) =>
  request<CaptureConfiguration>(`${CAPTURE_CONFIGURATIONS_PATH}/${id}`);
export const createCaptureConfiguration = (input: CreateCaptureConfigurationInput) =>
  request<CaptureConfiguration>(CAPTURE_CONFIGURATIONS_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updateCaptureConfiguration = (id: string, input: UpdateCaptureConfigurationInput) =>
  request<CaptureConfiguration>(`${CAPTURE_CONFIGURATIONS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteCaptureConfiguration = (id: string) =>
  request<{ id: string }>(`${CAPTURE_CONFIGURATIONS_PATH}/${id}`, { method: 'DELETE' });

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
const CAMPAIGNS_PATH = '/v1/campaigns';

export const listCampaignMembers = (campaignId: string, status?: MembershipStatus) => {
  // `QueryPaginateDto` (apps/api/src/common/dto) caps `limit` at 100 — a
  // higher value 400s the whole request. Confirmed against the real
  // running API, not assumed (see this project's own history of shipping
  // "fixes" that were never actually run against a live backend).
  const search = new URLSearchParams({ limit: '100' });
  if (status) search.set('status', status);
  return request<Paginated<CampaignMember>>(`${CAMPAIGNS_PATH}/${campaignId}/members?${search.toString()}`).then(
    (res) => res.items,
  );
};

export const updateCampaignMember = (
  campaignId: string,
  userId: string,
  action: MembershipAction,
  note?: string
) =>
  request<CampaignMember>(`${CAMPAIGNS_PATH}/${campaignId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action, note }),
  });

// --- Campaign kiosk assignments ("Thiết bị & Nhân sự") -----------------------
// 2026-09-14 — reverses the 2026-09-08 removal of the "Cán bộ chụp"/"Thiết
// bị" tabs (see CampaignDetail.tsx's own doc comment for that history) under
// new product direction: gán (assign) a staff user to a specific kiosk
// device within a campaign. Backed by `campaign_kiosk_assignments`
// (device-management module, apps/api), a *different* resource from the
// dead `CampaignMember`/`listCampaignMembers`/`updateCampaignMember` code
// just above (`campaign_members`/`/members`) — that dead code is left
// untouched as a pattern reference only, per this task's own spec. Assigning
// a kiosk auto-approves the assignee's `campaign_members` row server-side as
// a side effect (`CampaignKioskAssignmentService.assign`, D-Q4 "gán = tự
// duyệt") — there is no separate "add member" API call from this client.

export interface CampaignKioskAssignment {
  id: string;
  campaignId: string;
  deviceId: string;
  /** Merged in server-side from `devices`, not a real column — same pattern as `CampaignMember.email` above. */
  deviceName?: string;
  userId: string;
  userEmail?: string;
  userDisplayName?: string | null;
  assignedByUserId?: string | null;
  assignedAt: string;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /v1/campaigns/:id/kiosks` row — one per kiosk device already set up
 * under this campaign, with its current assignee (if any) and a completed-
 * session count merged in server-side (`CampaignKioskAssignmentService.listKiosksForCampaign`).
 * `CampaignAssignmentsPanel` renders its table directly off this endpoint
 * rather than cross-referencing `listDevices()` + `listCampaignAssignments()`
 * itself, since this is a real, separate endpoint from `/assignments` (not
 * just an alias) purpose-built for exactly this dashboard-detail shape.
 */
export interface CampaignKioskSummary {
  deviceId: string;
  deviceName: string;
  status: DeviceStatus;
  assignedUserId?: string | null;
  assignedUserEmail?: string | null;
  assignedUserDisplayName?: string | null;
  sessionsCompleted: number;
}

/** `GET /v1/campaigns/:id/assignments` — every kiosk↔person assignment row for this campaign. Added per this task's spec alongside `listCampaignKiosks`; `CampaignAssignmentsPanel` itself uses the richer `/kiosks` endpoint below, not this one. */
export const listCampaignAssignments = (campaignId: string) =>
  request<CampaignKioskAssignment[]>(`${CAMPAIGNS_PATH}/${campaignId}/assignments`);

export const listCampaignKiosks = (campaignId: string) =>
  request<CampaignKioskSummary[]>(`${CAMPAIGNS_PATH}/${campaignId}/kiosks`);

/** `PUT /v1/campaigns/:id/assignments/:deviceId` — idempotent upsert by `(campaignId, deviceId)`; also works as "đổi người" for an already-assigned kiosk. Requires `campaign:write` (`AssignCampaignKioskDto` server-side). */
export const assignCampaignKiosk = (campaignId: string, deviceId: string, userId: string, note?: string) =>
  request<CampaignKioskAssignment>(`${CAMPAIGNS_PATH}/${campaignId}/assignments/${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ userId, note }),
  });

/** `DELETE /v1/campaigns/:id/assignments/:deviceId` — requires `campaign:write`. Does not revoke the underlying `campaign_members` APPROVED row (left as-is server-side, same as the assign side never touching it as a separate step). */
export const unassignCampaignKiosk = (campaignId: string, deviceId: string) =>
  request<{ campaignId: string; deviceId: string }>(`${CAMPAIGNS_PATH}/${campaignId}/assignments/${deviceId}`, {
    method: 'DELETE',
  });

// --- Users (search, for the kiosk-assignment picker) -------------------------
// `GET /v1/users?q=` — apps/api/src/modules/identity's UserQueryController
// (`ListUsersQueryDto`/`UserReadModel`), the one real search-by-name/email
// listing endpoint found in this repo (requires `user:read` permission,
// separate from the `campaign:write` the assign/unassign calls above need —
// an admin missing `user:read` sees a clear inline error in the picker
// rather than a crash, see `CampaignAssignmentsPanel`). Only the fields this
// client actually uses are declared here, not `UserReadModel`'s full shape.

export interface UserListItem {
  id: string;
  email: string;
  displayName?: string | null;
  code?: string | null;
  isAdmin: boolean;
  status: 'ACTIVE' | 'DISABLED';
}

export interface ListUsersParams {
  q?: string;
  page?: number;
  limit?: number;
}

const USERS_PATH = '/v1/users';

export function listUsers(params: ListUsersParams = {}): Promise<Paginated<UserListItem>> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<UserListItem>>(`${USERS_PATH}${qs ? `?${qs}` : ''}`);
}

/**
 * `GET /v1/users/:id` — `UserListItem` plus `roleCodes` (mirrors the real
 * `UserReadModel`, which carries several more fields this client doesn't
 * use). Needed before `setUserRoles` below: that endpoint REPLACES a user's
 * entire role set, so a caller adding/removing one role must first read
 * this to get the user's other current roles, or it would silently wipe
 * them — see `RolesPage.tsx`'s `applyRoleToUser` helper.
 */
export interface UserDetail extends UserListItem {
  roleCodes: string[];
}
export const getUser = (id: string) => request<UserDetail>(`${USERS_PATH}/${id}`);

// --- Roles & Permissions (phân quyền) -----------------------------------
// Mirrors apps/api/src/modules/identity's role.command.controller.ts,
// role.query.controller.ts, permission.query.controller.ts,
// user-role.command.controller.ts. `GET /v1/roles` and `GET /v1/permissions`
// are plain arrays (small catalogs, not paginated) — only
// `GET /v1/roles/:id/users` is paginated, reusing `UserListItem` above.

export interface Role {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

/** `GET /v1/permissions` row — the full catalog, auto-discovered server-side from every `@RequirePermission()` in the app; read-only from the CMS's perspective (no create/edit UI for a permission itself, only for which ones a role has). */
export interface Permission {
  id: string;
  code: string;
  /** Prefix before `:` in `code` (e.g. `campaign` for `campaign:write`) — used to group the checkbox editor in `RolesPage.tsx`. */
  group: string;
  method?: string | null;
  path?: string | null;
  description?: string | null;
}

export interface CreateRoleInput {
  code: string;
  name: string;
  description?: string;
}

/** `PATCH /v1/roles/:id` — code is immutable, never send it. */
export interface UpdateRoleInput {
  name: string;
  description?: string;
}

const ROLES_PATH = '/v1/roles';
const PERMISSIONS_PATH = '/v1/permissions';

export const listRoles = () => request<Role[]>(ROLES_PATH);
export const getRole = (id: string) => request<Role>(`${ROLES_PATH}/${id}`);
export const createRole = (input: CreateRoleInput) =>
  request<Role>(ROLES_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updateRole = (id: string, input: UpdateRoleInput) =>
  request<Role>(`${ROLES_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

/** `PUT /v1/roles/:id/permissions` — REPLACES the role's entire permission set; always send the full desired list, never a delta. */
export const setRolePermissions = (id: string, permissionCodes: string[]) =>
  request<Role>(`${ROLES_PATH}/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionCodes }) });

/** `DELETE /v1/roles/:id` — refused server-side (isSystem roles can't be deleted); the CMS should disable the delete control for those rather than let this call fail. */
export const deleteRole = (id: string) => request<{ id: string }>(`${ROLES_PATH}/${id}`, { method: 'DELETE' });

export function listRoleUsers(id: string, params: { page?: number; limit?: number } = {}): Promise<Paginated<UserListItem>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<UserListItem>>(`${ROLES_PATH}/${id}/users${qs ? `?${qs}` : ''}`);
}

export const listPermissions = () => request<Permission[]>(PERMISSIONS_PATH);

/** `PUT /v1/users/:id/roles` — REPLACES the user's entire role set with `roleIds`. See `getUser` above for why callers must read current membership first. */
export const setUserRoles = (userId: string, roleIds: string[]) =>
  request<{ userId: string; roleCodes: string[] }>(`${USERS_PATH}/${userId}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds }),
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

/** Every campaign in one call (legacy, unfiltered) — used today for the CampaignList page's summary tiles (total/expired/expiring-soon), which need every row to compute across. Use `listCampaignsPaginated` for the table itself. */
export const listCampaigns = () => request<Campaign[]>(CAMPAIGNS_PATH);
export const listCampaignsPaginated = (params: {
  page: number;
  limit?: number;
  status?: EffectiveStatus;
  q?: string;
}) => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit ?? 20));
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  return request<Paginated<Campaign>>(`${CAMPAIGNS_PATH}?${search.toString()}`);
};
export const getCampaign = (id: string) => request<Campaign>(`${CAMPAIGNS_PATH}/${id}`);
export const createCampaign = (input: CreateCampaignInput) =>
  request<Campaign>(CAMPAIGNS_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updateCampaign = (id: string, input: UpdateCampaignInput) =>
  request<Campaign>(`${CAMPAIGNS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

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
export const deleteCampaign = (id: string) => request<{ id: string }>(`${CAMPAIGNS_PATH}/${id}`, { method: 'DELETE' });

export const getCampaignStats = (campaignId: string) => request<CampaignStats>(`${CAMPAIGNS_PATH}/${campaignId}/stats`);
export const getAllCampaignsStats = () => request<AllCampaignsStats>(`${CAMPAIGNS_PATH}/stats/summary`);

/** Backs the Overview page's trend chart — `days` defaults to 14 both here and server-side. */
export const getCampaignsTimeseries = (days = 14) =>
  request<CampaignsTimeseries>(`${CAMPAIGNS_PATH}/stats/timeseries?days=${days}`);

const DEVICES_PATH = '/v1/devices';

export const listDevices = (campaignId: string) => request<Device[]>(`${CAMPAIGNS_PATH}/${campaignId}/devices`);
export const getDevice = (id: string) => request<Device>(`${DEVICES_PATH}/${id}`);

/**
 * List capture sessions (Phase 11), filterable and paginated — mirrors
 * `ListSessionsQueryDto` server-side. Only params with a value are put on
 * the query string, so callers can pass a partly-filled filter object as-is.
 */
const SESSIONS_PATH = '/v1/sessions';

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
  return request<Paginated<SessionListItem>>(`${SESSIONS_PATH}${qs ? `?${qs}` : ''}`);
}

/** One session with every one of its photos. */
export const getSession = (id: string) => request<SessionDetail>(`${SESSIONS_PATH}/${id}`);

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
const STUDENTS_PATH = '/v1/students';

export function listStudents(params: ListStudentsParams = {}): Promise<Paginated<StudentListItem>> {
  const search = new URLSearchParams();
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<StudentListItem>>(`${STUDENTS_PATH}${qs ? `?${qs}` : ''}`);
}

/** One student, every session across every campaign — photos/videos come with `viewUrl` already resolved. */
export const getStudent = (code: string) => request<StudentDetail>(`${STUDENTS_PATH}/${encodeURIComponent(code)}`);

/**
 * Every signed-in SSO operator may open full-size photos (product decision 3
 * in the Phase 11 plan) — there is no per-admin identity plumbed through to
 * this call yet (the SSO profile isn't threaded into it), so `viewerId`
 * defaults to one fixed identity for every caller.
 */
const PHOTOS_PATH = '/v1/photos';
const VIDEOS_PATH = '/v1/videos';

export const issuePhotoViewLink = (photoId: string, viewerId = 'cms-admin') =>
  request<PhotoViewLink>(`${PHOTOS_PATH}/${photoId}/view-link`, {
    method: 'POST',
    body: JSON.stringify({ viewerId }),
  });

/** Same contract as `issuePhotoViewLink`, for a session's recorded video (`POST /v1/videos/:id/view-link`). */
export const issueVideoViewLink = (videoId: string, viewerId = 'cms-admin') =>
  request<PhotoViewLink>(`${VIDEOS_PATH}/${videoId}/view-link`, {
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
  return fetchActivationZip(`${CAMPAIGNS_PATH}/${campaignId}/devices`, input);
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
  return fetchActivationZip(`${DEVICES_PATH}/${deviceId}/reissue`, input);
}

/**
 * Manually marks a device ACTIVATED — see `DeviceController.activateDevice`'s
 * doc comment server-side: for testing/ops, when an admin wants the device
 * to read as activated without waiting for a real kiosk to call in. Never
 * touches the device secret. Rejected (409, `DEVICE_REVOKED`) for a REVOKED
 * device — reissuing is the only way back in for one of those.
 */
export const activateDevice = (deviceId: string) =>
  request<Device>(`${DEVICES_PATH}/${deviceId}/activate`, { method: 'POST' });

/**
 * "Thu hồi" (revoke) — 2026-09-08: invalidates every secret this device has
 * (current + previous) immediately, no overlap. The explicit hard-stop
 * counterpart to `reissueDevice`'s soft, overlapping rotation — see
 * `DeviceService.revokeDevice`'s own doc comment server-side.
 */
export const revokeDevice = (deviceId: string) =>
  request<Device>(`${DEVICES_PATH}/${deviceId}/revoke`, { method: 'POST' });

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

const REVIEW_SETS_PATH = '/v1/review/sets';
const REVIEW_JOBS_PATH = '/v1/review/jobs';
const REVIEW_VARIANTS_PATH = '/v1/review/variants';

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
  return request<Paginated<ReviewSetListItem>>(`${REVIEW_SETS_PATH}${qs ? `?${qs}` : ''}`);
}

export const getReviewSet = (id: string) => request<ReviewSetDetail>(`${REVIEW_SETS_PATH}/${id}`);

/** "Tạo lại ảnh 4x6" — re-runs the deterministic `CARD_AUTO` pipeline (R-Q1), the one action allowed while a set is locked in `AUTO_FAILED`. */
export const reprocessReviewSet = (id: string) =>
  request<ReviewSetDetail>(`${REVIEW_SETS_PATH}/${id}/reprocess`, { method: 'POST' });

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
  request<AiEditJob>(`${REVIEW_SETS_PATH}/${setId}/ai-edit`, { method: 'POST', body: JSON.stringify(input) });

export const getReviewJob = (jobId: string) => request<AiEditJob>(`${REVIEW_JOBS_PATH}/${jobId}`);

/** Only an explicit accept turns a job's result into a real, addressable version (§5.3) — never auto-applied. */
export const acceptVariant = (variantId: string) =>
  request<PhotoVariant>(`${REVIEW_VARIANTS_PATH}/${variantId}/accept`, { method: 'POST' });

export const discardVariant = (variantId: string) =>
  request<PhotoVariant>(`${REVIEW_VARIANTS_PATH}/${variantId}/discard`, { method: 'POST' });

export const setCurrentVariant = (setId: string, variantId: string) =>
  request<ReviewSetDetail>(`${REVIEW_SETS_PATH}/${setId}/current`, {
    method: 'POST',
    body: JSON.stringify({ variantId }),
  });

export const approveReviewSet = (setId: string, note?: string) =>
  request<ReviewSetDetail>(`${REVIEW_SETS_PATH}/${setId}/approve`, { method: 'POST', body: JSON.stringify({ note }) });

export const rejectReviewSet = (setId: string, note?: string) =>
  request<ReviewSetDetail>(`${REVIEW_SETS_PATH}/${setId}/reject`, { method: 'POST', body: JSON.stringify({ note }) });

export const listReviewEvents = (setId: string) => request<ReviewEvent[]>(`${REVIEW_SETS_PATH}/${setId}/events`);

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

/** Every kind in one call — for a card-spec picker (e.g. `CaptureConfigurationsPage.tsx`). Use `listPhotoKindsPaginated` for a management list instead. */
const PHOTO_KINDS_PATH = '/v1/photo-kinds';

export const listPhotoKinds = () => request<PhotoKind[]>(PHOTO_KINDS_PATH);
export const listPhotoKindsPaginated = (params: { page: number; limit?: number; q?: string; active?: boolean }) => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit ?? 20));
  if (params.q) search.set('q', params.q);
  if (params.active !== undefined) search.set('active', String(params.active));
  return request<Paginated<PhotoKind>>(`${PHOTO_KINDS_PATH}?${search.toString()}`);
};
export const createPhotoKind = (input: CreatePhotoKindInput) =>
  request<PhotoKind>(PHOTO_KINDS_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updatePhotoKind = (id: string, input: UpdatePhotoKindInput) =>
  request<PhotoKind>(`${PHOTO_KINDS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

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

  const res = await fetch(`${baseUrl()}${REVIEW_SETS_PATH}/${setId}/upload`, {
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

// --- In thẻ (print batches/items) & phôi in (card templates) ---------------
// Mirrors apps/api/src/modules/print/** and apps/api/src/modules/card-template/**
// (CMS-only routes; the print-agent's own token-authed routes are out of
// scope here). Same conventions as the review client above: plain
// interfaces mirroring the server DAOs, `request<T>()` for the JSON routes.

export type PrintBatchMode = 'DIRECT' | 'CENTRALIZED';
export type PrintBatchStatus = 'DRAFT' | 'READY' | 'PRINTING' | 'DONE' | 'CANCELLED';
export type PrintItemStatus =
  | 'PENDING'
  | 'RENDERED'
  | 'QUEUED'
  | 'PRINTING'
  | 'PRINTED'
  | 'FAILED'
  | 'REPRINT_REQUESTED'
  | 'CANCELLED';

/** `GET /v1/print/batches` row (mirrors `PrintBatchListItemDao`). */
export interface PrintBatch {
  id: string;
  code: string;
  name: string;
  campaignId?: string | null;
  defaultTemplateId?: string | null;
  printerId?: string | null;
  mode: PrintBatchMode;
  status: PrintBatchStatus;
  itemCount: number;
  printedCount: number;
  failedCount: number;
  sentAt?: string | null;
  doneAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrintBatchInput {
  name: string;
  campaignId?: string;
  defaultTemplateId?: string;
  printerId?: string;
  mode?: PrintBatchMode;
}

export interface UpdatePrintBatchInput {
  name?: string;
  defaultTemplateId?: string;
  printerId?: string;
  mode?: PrintBatchMode;
}

const PRINT_BATCHES_PATH = '/v1/print/batches';

export function listPrintBatches(
  params: { status?: PrintBatchStatus; campaignId?: string; page?: number; limit?: number } = {}
): Promise<Paginated<PrintBatch>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<PrintBatch>>(`${PRINT_BATCHES_PATH}${qs ? `?${qs}` : ''}`);
}

export const getPrintBatch = (id: string) => request<PrintBatch>(`${PRINT_BATCHES_PATH}/${id}`);
export const createPrintBatch = (input: CreatePrintBatchInput) =>
  request<PrintBatch>(PRINT_BATCHES_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updatePrintBatch = (id: string, input: UpdatePrintBatchInput) =>
  request<PrintBatch>(`${PRINT_BATCHES_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const addItemsToPrintBatch = (id: string, itemIds: string[]) =>
  request<PrintBatch>(`${PRINT_BATCHES_PATH}/${id}/items`, { method: 'POST', body: JSON.stringify({ itemIds }) });
export const removeItemFromPrintBatch = (id: string, itemId: string) =>
  request<{ removed: true }>(`${PRINT_BATCHES_PATH}/${id}/items/${itemId}`, { method: 'DELETE' });
/** `POST /v1/print/batches/:id/items/remove {itemIds}` — bulk mirror of `removeItemFromPrintBatch` above, for the CMS's multi-select "Gỡ các mục đã chọn" action. */
export const removeItemsFromPrintBatch = (id: string, itemIds: string[]) =>
  request<{ removed: number }>(`${PRINT_BATCHES_PATH}/${id}/items/remove`, { method: 'POST', body: JSON.stringify({ itemIds }) });
export const renderPrintBatch = (id: string) =>
  request<{ rendered: number; failed: number; errors: Array<{ itemId: string; message: string }> }>(
    `${PRINT_BATCHES_PATH}/${id}/render`,
    { method: 'POST' }
  );
/** `POST /v1/print/batches/:id/send {itemIds?}` — omit/empty `itemIds` sends the whole batch (today's behavior); pass a subset to send only those items. */
export const sendPrintBatch = (id: string, itemIds?: string[]) =>
  request<PrintBatch>(`${PRINT_BATCHES_PATH}/${id}/send`, {
    method: 'POST',
    body: JSON.stringify(itemIds && itemIds.length > 0 ? { itemIds } : {}),
  });
export const cancelPrintBatch = (id: string) =>
  request<PrintBatch>(`${PRINT_BATCHES_PATH}/${id}/cancel`, { method: 'POST' });

/**
 * `GET /v1/print/batches/:id/package` — a zip, not the usual `{data}`
 * envelope, same reasoning `fetchActivationZip` elsewhere in this file
 * already documents for a binary download: fetch manually, read the
 * filename off `Content-Disposition`, hand the caller a `Blob` it can
 * turn into a download link itself (this app's sandboxed preview can't
 * trigger a real file save, but a real CMS deployment can). Optional
 * `itemIds` (omit/empty = whole batch) is sent as repeated `itemIds=`
 * query params — no existing GET endpoint in this file takes an array
 * query param to copy a convention from, see the server-side DTO's own
 * doc comment for why repeated keys was picked.
 */
export async function downloadPrintBatchPackage(id: string, itemIds?: string[]): Promise<{ blob: Blob; filename: string }> {
  const search = new URLSearchParams();
  if (itemIds) itemIds.forEach((itemId) => search.append('itemIds', itemId));
  const qs = search.toString();
  const res = await fetch(`${baseUrl()}${PRINT_BATCHES_PATH}/${id}/package${qs ? `?${qs}` : ''}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text.slice(0, 300) || res.statusText, res.status);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? `${id}.zip` };
}

/** `GET /v1/print/items` row (mirrors `PrintItemListItemDao`). */
export interface PrintItem {
  id: string;
  batchId?: string | null;
  campaignId: string;
  setId: string;
  variantId?: string | null;
  subjectCode: string;
  fullName?: string | null;
  className?: string | null;
  faculty?: string | null;
  templateId?: string | null;
  status: PrintItemStatus;
  printerId?: string | null;
  printedAt?: string | null;
  renderedAt?: string | null;
  errorMessage?: string | null;
  reprintOfItemId?: string | null;
  /** Computed at read time from missing fullName/className/faculty/variantId — never stored, see `PrintItemListItemDao`'s own doc comment. */
  missingFields: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PrintItemDetail extends PrintItem {
  extra?: Record<string, unknown> | null;
  renderedFrontFsFileId?: string | null;
  renderedBackFsFileId?: string | null;
  events: Array<{
    id: string;
    source: string;
    fromStatus?: string | null;
    toStatus: string;
    actorUserId?: string | null;
    message?: string | null;
    at: string;
  }>;
}

export interface PrintItemGroup {
  value: string | null;
  total: number;
  pending: number;
  rendered: number;
  printed: number;
  failed: number;
}

const PRINT_ITEMS_PATH = '/v1/print/items';

export function listPrintItems(
  params: {
    campaignId?: string;
    batchId?: string;
    status?: PrintItemStatus;
    className?: string;
    faculty?: string;
    q?: string;
    page?: number;
    limit?: number;
  } = {}
): Promise<Paginated<PrintItem>> {
  const search = new URLSearchParams();
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.batchId) search.set('batchId', params.batchId);
  if (params.status) search.set('status', params.status);
  if (params.className) search.set('className', params.className);
  if (params.faculty) search.set('faculty', params.faculty);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<PrintItem>>(`${PRINT_ITEMS_PATH}${qs ? `?${qs}` : ''}`);
}

export const listPrintItemGroups = (groupBy: 'className' | 'faculty', campaignId?: string) => {
  const search = new URLSearchParams({ groupBy });
  if (campaignId) search.set('campaignId', campaignId);
  return request<PrintItemGroup[]>(`${PRINT_ITEMS_PATH}/groups?${search.toString()}`);
};

export const getPrintItem = (id: string) => request<PrintItemDetail>(`${PRINT_ITEMS_PATH}/${id}`);
export const updatePrintItem = (id: string, input: { templateId?: string; extra?: Record<string, unknown>; status?: 'CANCELLED' }) =>
  request<PrintItemDetail>(`${PRINT_ITEMS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const renderPrintItem = (id: string) => request<PrintItemDetail>(`${PRINT_ITEMS_PATH}/${id}/render`, { method: 'POST' });
export const reprintPrintItem = (id: string) => request<PrintItemDetail>(`${PRINT_ITEMS_PATH}/${id}/reprint`, { method: 'POST' });

/**
 * Two-step "chọn, rồi tạo" (plan §2.5): creates unattached `PrintItem` rows
 * from APPROVED photo-review sets, either by explicit `setIds` or a
 * campaign+class/faculty filter — response only carries a count, not the
 * created ids (server-side DTO doesn't return them), so a caller wanting to
 * immediately attach the new items to a batch must re-list
 * (`listPrintItems({campaignId, ...})`, unattached rows have `batchId: null`)
 * rather than chain off this response directly.
 */
export const bulkCreatePrintItems = (input: { setIds?: string[]; filter?: { campaignId: string; className?: string; faculty?: string } }) =>
  request<{ created: number; skipped: Array<{ setId: string; reason: string }> }>(`${PRINT_ITEMS_PATH}/bulk`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const bulkApplyPrintTemplate = (input: {
  itemIds?: string[];
  filter?: { campaignId?: string; batchId?: string; className?: string; faculty?: string; status?: PrintItemStatus };
  templateId: string;
}) => request<{ updated: number }>(`${PRINT_ITEMS_PATH}/bulk-template`, { method: 'POST', body: JSON.stringify(input) });

/**
 * `GET /v1/print/items/:id/preview` and `POST /v1/card-templates/:id/preview`
 * both return a raw `image/png` body, not the usual `{data}` envelope — an
 * `<img src="...">` can't attach the `Authorization` header this API
 * requires, so both need a real `fetch()` + blob object URL. Callers own
 * revoking the returned URL (`URL.revokeObjectURL`) once done with it, same
 * as any other object URL.
 */
export async function fetchPreviewPngObjectUrl(path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text.slice(0, 300) || res.statusText, res.status);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const previewPrintItemUrl = (id: string, side: 'front' | 'back' = 'front') =>
  fetchPreviewPngObjectUrl(`${PRINT_ITEMS_PATH}/${id}/preview?side=${side}`);

const CARD_TEMPLATES_PATH = '/v1/card-templates';

export const previewCardTemplateUrl = (
  templateId: string,
  input: { setId?: string; sampleData?: Record<string, string>; side?: 'front' | 'back' }
) => fetchPreviewPngObjectUrl(`${CARD_TEMPLATES_PATH}/${templateId}/preview`, { method: 'POST', body: JSON.stringify(input) });

export type CardTemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type CardTemplateFieldCode =
  | 'fullName'
  | 'studentCode'
  | 'citizenId'
  | 'className'
  | 'faculty'
  | 'major'
  | 'dateOfBirth'
  | 'cardValidUntil'
  | 'cohort'
  | 'campaignCode'
  | 'cardPhoto'
  | 'qrPayload';

/** `GET /v1/card-templates` row (mirrors `CardTemplateListItemDao`). Full CRUD/layout-authoring lives below (`CardTemplateDetail` + friends) — this list-row shape stays as-is since it's also what a batch's template picker (`PrintPage`/`CreateBatchModal`) reads. */
export interface CardTemplate {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: CardTemplateStatus;
  version: number;
  cardSize: { widthMm: number; heightMm: number };
  dpi: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export function listCardTemplates(
  params: { status?: CardTemplateStatus; q?: string; page?: number; limit?: number } = {}
): Promise<Paginated<CardTemplate>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<CardTemplate>>(`${CARD_TEMPLATES_PATH}${qs ? `?${qs}` : ''}`);
}

export interface CardTemplateField {
  field: CardTemplateFieldCode;
  label: string;
  type: 'TEXT' | 'DATE' | 'IMAGE';
}

export const listCardTemplateFields = () => request<CardTemplateField[]>(`${CARD_TEMPLATES_PATH}/fields`);

// --- Phôi in — CRUD + layout editor (Task C) ------------------------------
// Mirrors apps/api/src/modules/card-template/schema/card-template-layout.schema.ts
// exactly (discriminated union on `type`) — verified against the real zod
// schema, not just the plan.

export type CardTemplateAssetKind = 'LOGO' | 'BACKGROUND' | 'FONT';

export interface CardTemplateAssetDao {
  id: string;
  kind: CardTemplateAssetKind;
  fsFileId: string;
  fileName: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  createdAt: string;
}

export interface CardTemplateFont {
  family: string;
  size: number;
  weight?: number;
  color: string;
}

interface CardTemplateElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  unit: 'mm';
  z: number;
}

export interface CardTemplatePhotoElement extends CardTemplateElementBase {
  type: 'PHOTO';
  field: 'cardPhoto';
}

export interface CardTemplateTextElement extends CardTemplateElementBase {
  type: 'TEXT';
  field: CardTemplateFieldCode;
  font: CardTemplateFont;
  autoShrink?: { minSize: number; maxChars: number };
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
}

export interface CardTemplateBarcodeElement extends CardTemplateElementBase {
  type: 'BARCODE';
  field: CardTemplateFieldCode;
  symbology: 'CODE128' | 'QRCODE';
}

export interface CardTemplateImageElement extends CardTemplateElementBase {
  type: 'IMAGE';
  assetId: string;
}

export interface CardTemplateStaticTextElement extends CardTemplateElementBase {
  type: 'STATIC_TEXT';
  text: string;
  font: CardTemplateFont;
  align: 'left' | 'center' | 'right';
}

export type CardTemplateElement =
  | CardTemplatePhotoElement
  | CardTemplateTextElement
  | CardTemplateBarcodeElement
  | CardTemplateImageElement
  | CardTemplateStaticTextElement;

export interface CardTemplateSide {
  background: { color: string; assetId: string | null };
  elements: CardTemplateElement[];
}

/** `GET /v1/card-templates/:id` (mirrors `CardTemplateDetailDao`) — the list-only `CardTemplate` above plus the two layout sides and its assets. */
export interface CardTemplateDetail extends CardTemplate {
  front: CardTemplateSide;
  back: CardTemplateSide;
  createdByUserId?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
  assets: CardTemplateAssetDao[];
}

export interface CardTemplateInput {
  code: string;
  name: string;
  description?: string;
  cardSize?: { widthMm: number; heightMm: number };
  dpi?: number;
  front?: CardTemplateSide;
  back?: CardTemplateSide;
}
export type UpdateCardTemplateInput = Partial<Omit<CardTemplateInput, 'code'>>;

export const getCardTemplate = (id: string) => request<CardTemplateDetail>(`${CARD_TEMPLATES_PATH}/${id}`);
export const createCardTemplate = (input: CardTemplateInput) =>
  request<CardTemplateDetail>(CARD_TEMPLATES_PATH, { method: 'POST', body: JSON.stringify(input) });
export const updateCardTemplate = (id: string, input: UpdateCardTemplateInput) =>
  request<CardTemplateDetail>(`${CARD_TEMPLATES_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteCardTemplate = (id: string) =>
  request<{ deleted: true }>(`${CARD_TEMPLATES_PATH}/${id}`, { method: 'DELETE' });
export const duplicateCardTemplate = (id: string) =>
  request<CardTemplateDetail>(`${CARD_TEMPLATES_PATH}/${id}/duplicate`, { method: 'POST' });
export const publishCardTemplate = (id: string) =>
  request<CardTemplateDetail>(`${CARD_TEMPLATES_PATH}/${id}/publish`, { method: 'POST' });
export const archiveCardTemplate = (id: string) =>
  request<CardTemplateDetail>(`${CARD_TEMPLATES_PATH}/${id}/archive`, { method: 'POST' });

/**
 * `POST /v1/card-templates/:id/assets` (multipart, `file` + `kind` fields) —
 * same manual-`fetch` shape `uploadReplacePhoto` above uses for every
 * multipart upload in this file: no `Content-Type` set by hand (the browser
 * adds the boundary), still unwraps the usual `{ data }` envelope.
 */
export async function uploadCardTemplateAsset(id: string, file: File, kind: CardTemplateAssetKind): Promise<CardTemplateAssetDao> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);

  const res = await fetch(`${baseUrl()}${CARD_TEMPLATES_PATH}/${id}/assets`, {
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

  const envelope = (await res.json()) as { data: CardTemplateAssetDao };
  return envelope.data;
}

export const deleteCardTemplateAsset = (id: string, assetId: string) =>
  request<{ deleted: true }>(`${CARD_TEMPLATES_PATH}/${id}/assets/${assetId}`, { method: 'DELETE' });

// --- Máy in (printer management) ----------------------------------------
// Mirrors apps/api/src/modules/print/{controllers/printer.controller.ts,
// dao/printer-*.dao.ts, dto/*printer*.ts, entities/printer.entity.ts,
// print.constants.ts}. CMS-only (`SsoAuthGuard`+`PermissionsGuard`, needs
// `printer:read`/`printer:write`) — distinct from `PrintBatch`/`PrintItem`
// above (a print JOB, not physical hardware) and from
// `CampaignAssignmentsPanel.tsx` (staff↔kiosk assignment, unrelated).

export type PrinterPrintMode = 'SINGLE_SIDE' | 'DUPLEX';
export type PrinterUsageMode = 'DIRECT' | 'CENTRALIZED';
export type PrinterStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';
export type PrinterConnectionType = 'USB' | 'NETWORK' | 'AGENT';
/** Reasons a human may pick on `POST /v1/printers/:id/stock` — `PRINT` is excluded on purpose: the server writes that one automatically on the real print pipeline's PRINTED transition, so letting an operator pick it here would let the audit trail be forged (see `PrinterStockAdjustDto`'s own doc comment). */
export type PrinterStockAdjustReason = 'REFILL' | 'ADJUST' | 'WASTE';

export interface PrinterConnection {
  type: PrinterConnectionType;
  address?: string | null;
  spoolerName?: string | null;
}

/** `GET /v1/printers` row (mirrors `PrinterListItemDao`). */
export interface Printer {
  id: string;
  name: string;
  model?: string | null;
  printMode: PrinterPrintMode;
  usageMode: PrinterUsageMode;
  location?: string | null;
  /** Kiosk (device) this printer is physically attached to, if any — plain UUID, no cross-campaign device picker exists in this client (the only device-listing endpoint is per-campaign), so the form takes this as free-text UUID input. */
  deviceId?: string | null;
  connection?: PrinterConnection | null;
  status: PrinterStatus;
  lastSeenAt?: string | null;
  lastError?: string | null;
  blankStock: number;
  blankStockUpdatedAt?: string | null;
  lowStockThreshold: number;
  /** Computed server-side: `blankStock <= lowStockThreshold`. */
  lowStock: boolean;
  defaultTemplateId?: string | null;
  /** Computed server-side — the real hash is `select:false` and never sent to this client. */
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `GET /v1/printers/:id/stock-events` row / `POST /v1/printers/:id/stock` response (mirrors `PrinterStockEventDao`). */
export interface PrinterStockEvent {
  id: string;
  printerId: string;
  delta: number;
  reason: string;
  resultingStock: number;
  actorUserId?: string | null;
  note?: string | null;
  at: string;
}

/** `GET /v1/printers/:id` — list row + queue depth + last 20 stock events. */
export interface PrinterDetail extends Printer {
  /** Items QUEUED/PRINTING against this printer right now. */
  queueDepth: number;
  recentStockEvents: PrinterStockEvent[];
}

export interface CreatePrinterInput {
  name: string;
  model?: string;
  printMode?: PrinterPrintMode;
  usageMode?: PrinterUsageMode;
  location?: string;
  deviceId?: string;
  connection?: PrinterConnection;
  blankStock?: number;
  lowStockThreshold?: number;
  defaultTemplateId?: string;
}

/** `PATCH /v1/printers/:id` — everything `CreatePrinterInput` has except `blankStock` (stock only ever moves through `adjustPrinterStock`, so its own audit trail can never be bypassed by a silent PATCH — see server's `UpdatePrinterDto` doc comment), and every field optional (server wraps it in `PartialType`). */
export type UpdatePrinterInput = Partial<Omit<CreatePrinterInput, 'blankStock'>>;

const PRINTERS_PATH = '/v1/printers';

export function listPrinters(
  params: { status?: PrinterStatus; campaignId?: string; q?: string; page?: number; limit?: number } = {}
): Promise<Paginated<Printer>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<Printer>>(`${PRINTERS_PATH}${qs ? `?${qs}` : ''}`);
}

export const createPrinter = (input: CreatePrinterInput) =>
  request<Printer>(PRINTERS_PATH, { method: 'POST', body: JSON.stringify(input) });
export const getPrinter = (id: string) => request<PrinterDetail>(`${PRINTERS_PATH}/${id}`);
export const updatePrinter = (id: string, input: UpdatePrinterInput) =>
  request<Printer>(`${PRINTERS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const adjustPrinterStock = (
  id: string,
  input: { delta: number; reason: PrinterStockAdjustReason; note?: string }
) => request<PrinterStockEvent>(`${PRINTERS_PATH}/${id}/stock`, { method: 'POST', body: JSON.stringify(input) });

export function listPrinterStockEvents(
  id: string,
  params: { page?: number; limit?: number } = {}
): Promise<Paginated<PrinterStockEvent>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<PrinterStockEvent>>(`${PRINTERS_PATH}/${id}/stock-events${qs ? `?${qs}` : ''}`);
}

export const disablePrinter = (id: string) => request<Printer>(`${PRINTERS_PATH}/${id}/disable`, { method: 'POST' });
export const enablePrinter = (id: string) => request<Printer>(`${PRINTERS_PATH}/${id}/enable`, { method: 'POST' });
export const testPrintPrinter = (id: string) =>
  request<{ acknowledged: true; printerId: string }>(`${PRINTERS_PATH}/${id}/test-print`, { method: 'POST' });

/** Plaintext agent token — returned ONLY in this one response, never retrievable again afterwards (`PrinterController.issueToken`'s own doc comment). Callers must show it in a copy-now UI, never stash it for later display. */
export const issuePrinterToken = (id: string) => request<{ token: string }>(`${PRINTERS_PATH}/${id}/token`, { method: 'POST' });

// --- Operations dashboard ----------------------------------------------
// Mirrors apps/api/src/modules/stats's `dashboard`/`review/stats` routes.
// `dashboardKpis` defaults `operatorUserId` server-side to the CALLING
// user (D-Q12) — there is no "every operator, system-wide" mode for this
// endpoint (see its own doc comment: a `stats:read-all` permission for
// viewing another operator's KPIs was never built), so `DashboardPage`
// uses it only for "hoạt động của bạn hôm nay" (the signed-in admin's own
// day-by-day trend), not the headline campaign-wide totals — those come
// from `dashboardActiveCampaigns` instead, which is genuinely campaign-
// wide (no operator scoping).

export interface DashboardKpis {
  captured: { total: number; byDay: Array<{ date: string; count: number }> };
  pendingReview: number;
  /** Real print-module count now that P6 shipped — kept optimistic per the "field thật thì hiển thị" rule rather than assumed stale, but the server DAO's own doc comment origin (pre-P6) is worth remembering if this ever reads as suspiciously 0. */
  printed: number;
  overdue: number;
}

const DASHBOARD_KPIS_PATH = '/v1/dashboard/kpis';

export const getDashboardKpis = (params: { from?: string; to?: string; campaignId?: string } = {}) => {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.campaignId) search.set('campaignId', params.campaignId);
  const qs = search.toString();
  return request<DashboardKpis>(`${DASHBOARD_KPIS_PATH}${qs ? `?${qs}` : ''}`);
};

/** `GET /v1/dashboard/campaigns/active` row — campaign-wide (not operator-scoped), the dashboard's real headline data source. */
export interface DashboardActiveCampaign {
  campaignId: string;
  name: string;
  code?: string | null;
  location?: string | null;
  quota?: number | null;
  captured: number;
  processed: number;
  sessions: number;
  pendingReview: number;
  captureErrors: number;
  notCaptured?: number | null;
  overdue: number;
  /** Sessions in SESSION_STARTED within the last 15 minutes — the closest real signal to "đang hoạt động", NOT the same as a kiosk being online (no such field exists, see this project's own plan doc). Never label this "online" in the UI. */
  inProgressNow: number;
  lastCaptureAt?: string | null;
}

const DASHBOARD_ACTIVE_CAMPAIGNS_PATH = '/v1/dashboard/campaigns/active';

export const getDashboardActiveCampaigns = () => request<DashboardActiveCampaign[]>(DASHBOARD_ACTIVE_CAMPAIGNS_PATH);

export interface ReviewStatsByReviewer {
  reviewerUserId: string | null;
  reviewerName: string;
  approved: number;
  rejected: number;
}

/** `GET /v1/review/stats` (mirrors `ReviewStatsDao`) — used by the dashboard's review-outcome breakdown chart. */
export interface ReviewStats {
  byStatus: Record<string, number>;
  approved: number;
  rejected: number;
  aiEdited: number;
  uploaded: number;
  autoOnly: number;
  byReviewer: ReviewStatsByReviewer[];
  avgReviewHours: number | null;
}

const REVIEW_STATS_PATH = '/v1/review/stats';

export const getReviewStats = (params: { campaignId?: string; from?: string; to?: string } = {}) => {
  const search = new URLSearchParams();
  if (params.campaignId) search.set('campaignId', params.campaignId);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  const qs = search.toString();
  return request<ReviewStats>(`${REVIEW_STATS_PATH}${qs ? `?${qs}` : ''}`);
};

// --- Workflow (eligibility + identification methods config) -----------
// Mirrors apps/api/src/modules/workflow/** (CQRS module: Workflow +
// immutable WorkflowVersion aggregates) and the `identification_methods`
// catalog in device-management. See workflow-config.schema.ts server-side
// for the exact 6-group `config` shape this client passes through mostly
// opaquely — only `eligibility`/`identification` get a structured CMS
// editor (WorkflowConfigEditor.tsx); the other 4 groups are edited as raw
// JSON there, out of scope for a rich editor this pass (no mockup for it,
// and capture/output already overlap with the separate, older
// `CaptureConfiguration` system — a real unification is a bigger, separate
// piece of work).

export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface WorkflowConfigEligibilityRule {
  key: string;
  expr: string;
  message: string;
}

export interface WorkflowConfigEligibility {
  mode: 'NONE' | 'ROSTER' | 'EXTERNAL_API' | 'ROSTER_AND_API';
  api?: { clientCode: string; keyField: string; requiredFields?: string[] };
  rules?: WorkflowConfigEligibilityRule[];
  rosterTemplate?: string;
}

export interface WorkflowConfigIdentification {
  methods: string[];
  lookupKeyField: 'citizenId' | 'studentCode';
}

/** The 6-group `config` jsonb — `capture`/`aiProcessing`/`output`/`printing` stay `Record<string, unknown>` here (edited as raw JSON in the CMS, see this section's own doc comment), only `eligibility`/`identification` get real field types. */
export interface WorkflowConfig {
  capture: Record<string, unknown>;
  identification: WorkflowConfigIdentification;
  eligibility: WorkflowConfigEligibility;
  aiProcessing: Record<string, unknown>;
  output: Record<string, unknown>;
  printing: Record<string, unknown>;
}

export interface WorkflowSummary {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus;
  currentVersionId?: string | null;
}

/** `GET /v1/workflows/:id` (mirrors `WorkflowReadModel`) — `currentConfig` is the current PUBLISHED version's config, or the draft's if never published. */
export interface WorkflowDetail extends WorkflowSummary {
  currentVersion: number | null;
  currentConfig: WorkflowConfig | null;
  campaignCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  isDraft: boolean;
  publishedAt: string | null;
  note: string | null;
}

export interface WorkflowUsage {
  campaignId: string;
  campaignName: string;
  campaignCode?: string | null;
  workflowVersionId: string;
  version: number;
}

const WORKFLOWS_PATH = '/v1/workflows';

export function listWorkflows(params: { status?: WorkflowStatus; q?: string; page?: number; limit?: number } = {}): Promise<Paginated<WorkflowDetail>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<Paginated<WorkflowDetail>>(`${WORKFLOWS_PATH}${qs ? `?${qs}` : ''}`);
}

export const getWorkflow = (id: string) => request<WorkflowDetail>(`${WORKFLOWS_PATH}/${id}`);

export const createWorkflow = (input: { code: string; name: string; description?: string; config: WorkflowConfig }) =>
  request<WorkflowSummary>(WORKFLOWS_PATH, { method: 'POST', body: JSON.stringify(input) });

export const updateWorkflow = (id: string, input: { name: string; description?: string }) =>
  request<WorkflowSummary>(`${WORKFLOWS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

/** `PUT /v1/workflows/:id/config` — `:id` is the WORKFLOW id, not a version id; only works while it has a draft version (`NO_DRAFT_VERSION` `ApiError` otherwise — call `createWorkflowDraftVersion` first). */
export const updateWorkflowConfig = (id: string, input: { config: WorkflowConfig; note?: string }) =>
  request<{ id: string; workflowId: string; version: number; isDraft: boolean }>(`${WORKFLOWS_PATH}/${id}/config`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const publishWorkflow = (id: string) => request<WorkflowSummary>(`${WORKFLOWS_PATH}/${id}/publish`, { method: 'POST' });

/** Clones the current PUBLISHED version's config into a new draft — errors if never published, or a draft already exists. */
export const createWorkflowDraftVersion = (id: string) =>
  request<{ id: string; workflowId: string; version: number; isDraft: boolean }>(`${WORKFLOWS_PATH}/${id}/versions`, { method: 'POST' });

export const archiveWorkflow = (id: string) => request<WorkflowSummary>(`${WORKFLOWS_PATH}/${id}/archive`, { method: 'POST' });

export const deleteWorkflow = (id: string) => request<void>(`${WORKFLOWS_PATH}/${id}`, { method: 'DELETE' });

export const listWorkflowVersions = (id: string) => request<WorkflowVersionSummary[]>(`${WORKFLOWS_PATH}/${id}/versions`);

export const getWorkflowUsage = (id: string) => request<WorkflowUsage[]>(`${WORKFLOWS_PATH}/${id}/usage`);

export interface WorkflowConfigValidation {
  valid: boolean;
  errors: string[];
}

export const validateWorkflowConfig = (config: unknown) =>
  request<WorkflowConfigValidation>(`${WORKFLOWS_PATH}/validate`, { method: 'POST', body: JSON.stringify(config) });

export interface EligibilityApiClient {
  code: string;
  name: string;
  fields: string[];
}

const ELIGIBILITY_API_CLIENTS_PATH = '/v1/eligibility/api-clients';
const ELIGIBILITY_TEST_LOOKUP_PATH = '/v1/eligibility/test-lookup';

export const listEligibilityApiClients = () => request<EligibilityApiClient[]>(ELIGIBILITY_API_CLIENTS_PATH);

export interface EligibilityTestLookupResult {
  success: boolean;
  message: string | null;
  sampleRecord: Record<string, unknown> | null;
}

export const testEligibilityLookup = (clientCode: string, key: string) =>
  request<EligibilityTestLookupResult>(ELIGIBILITY_TEST_LOOKUP_PATH, { method: 'POST', body: JSON.stringify({ clientCode, key }) });

/** `identification_methods` catalog row (mirrors `IdentificationMethodDao`) — the pool `WorkflowConfigEditor`'s identification-methods multi-select picks from, and its own dedicated management screen (`IdentificationMethodsPage.tsx`). */
export interface IdentificationMethod {
  id: string;
  code: string;
  nameVi: string;
  description?: string | null;
  requiresHardware: boolean;
  active: boolean;
  sortOrder: number;
}

const IDENTIFICATION_METHODS_PATH = '/v1/identification-methods';

/** Every method in one call — for a workflow-config form's picker. Use `listIdentificationMethodsPaginated` for a management list instead. */
export const listIdentificationMethods = (includeInactive = false) =>
  request<IdentificationMethod[]>(`${IDENTIFICATION_METHODS_PATH}${includeInactive ? '?includeInactive=true' : ''}`);
export const listIdentificationMethodsPaginated = (params: {
  page: number;
  limit?: number;
  includeInactive?: boolean;
  q?: string;
}) => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit ?? 20));
  if (params.includeInactive) search.set('includeInactive', 'true');
  if (params.q) search.set('q', params.q);
  return request<Paginated<IdentificationMethod>>(`${IDENTIFICATION_METHODS_PATH}?${search.toString()}`);
};

export interface CreateIdentificationMethodInput {
  code: string;
  nameVi: string;
  description?: string;
  requiresHardware?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export const createIdentificationMethod = (input: CreateIdentificationMethodInput) =>
  request<IdentificationMethod>(IDENTIFICATION_METHODS_PATH, { method: 'POST', body: JSON.stringify(input) });

export const updateIdentificationMethod = (id: string, input: Partial<Omit<CreateIdentificationMethodInput, 'code'>>) =>
  request<IdentificationMethod>(`${IDENTIFICATION_METHODS_PATH}/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
