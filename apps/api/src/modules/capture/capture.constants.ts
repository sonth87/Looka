export enum SessionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
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

/** Postgres advisory-free backoff cap: a long outage doesn't push a retry days out. */
export const OUTBOX_MAX_RETRY_DELAY_SECONDS = 300;
