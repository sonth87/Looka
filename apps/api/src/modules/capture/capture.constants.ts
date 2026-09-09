export enum SessionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * Which path produced a session — see
 * docs/plans/04-device-management/phase-11-capture-sessions-and-stats/implementation-plan.md
 * §3 D1. WEB is the default (matches the DB column default) since every row
 * created before this enum existed came from `apps/web`.
 */
export enum SessionSource {
  WEB = 'WEB',
  KIOSK = 'KIOSK',
}

/**
 * Upload-state filter for `GET /v1/sessions?state=`, derived from a
 * session's photos rather than stored — see `SessionService`'s list query
 * for the exact "ready/pending/failed" definitions (session-list.dao.ts).
 */
export enum SessionListState {
  ALL = 'all',
  COMPLETED = 'completed',
  PENDING = 'pending',
  FAILED = 'failed',
}

export enum OutboxStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  UPLOADED = 'UPLOADED',
  FAILED = 'FAILED',
}

/** Largest capture accepted, before base64 expansion. */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];

/**
 * Largest kiosk video accepted, before base64 expansion (2026-09-09, "route
 * kiosk video uploads through apps/api" — see `AddDeviceVideoDto`/
 * `SessionVideoService.addDeviceVideo`). Real recordings are 600KB-3MB
 * (live-confirmed) — 15mb raw (~20mb once base64-inflated by ~33%) leaves
 * generous headroom under `main.ts`'s 25mb JSON body limit while still
 * rejecting a pathological multi-minute recording outright rather than
 * timing out mid-request.
 */
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;

export const ALLOWED_VIDEO_MIME_TYPES = ['video/webm', 'video/mp4'];

/** Postgres advisory-free backoff cap: a long outage doesn't push a retry days out. */
export const OUTBOX_MAX_RETRY_DELAY_SECONDS = 300;
