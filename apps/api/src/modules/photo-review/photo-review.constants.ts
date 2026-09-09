/**
 * Shared enums/constants for the "Duyệt ảnh" (photo review) CMS module —
 * see docs/plans/cms-photo-review-plan.md, especially §2 (data model), §4
 * (locking), §5.3/§6.3 (prompt filter), §5.4/R-Q8 (identity threshold).
 */

/** `subject_photo_sets.status` — plan §2/§4. */
export enum PhotoReviewSetStatus {
  PENDING_AUTO = 'PENDING_AUTO',
  READY = 'READY',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  AUTO_FAILED = 'AUTO_FAILED',
}

/** `photo_variants.kind` — plan §2. */
export enum PhotoVariantKind {
  CARD_AUTO = 'CARD_AUTO',
  CARD_AI = 'CARD_AI',
  CARD_UPLOAD = 'CARD_UPLOAD',
}

/** `photo_variants.status` — plan §2. Never hard-deleted; DISCARDED is the closest thing to "removed". */
export enum PhotoVariantStatus {
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
  DISCARDED = 'DISCARDED',
}

/** `variant_upload_outbox.status` — mirrors `capture`'s `OutboxStatus`, see that table's own migration doc comment for why this is a parallel table rather than a shared one. */
export enum VariantOutboxStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  UPLOADED = 'UPLOADED',
  FAILED = 'FAILED',
}

/** Same cap as `capture`'s `OUTBOX_MAX_RETRY_DELAY_SECONDS` — duplicated rather than imported, see this module's own "no structural dependency on `capture`" rule. */
export const VARIANT_OUTBOX_MAX_RETRY_DELAY_SECONDS = 300;

/** `photo_review_events.action` — plan §2. Written on every state-changing action in this module. */
export enum PhotoReviewAction {
  AUTO_GENERATED = 'AUTO_GENERATED',
  AUTO_FAILED = 'AUTO_FAILED',
  REPROCESS = 'REPROCESS',
  AI_REQUESTED = 'AI_REQUESTED',
  AI_ACCEPTED = 'AI_ACCEPTED',
  AI_DISCARDED = 'AI_DISCARDED',
  UPLOAD_REPLACED = 'UPLOAD_REPLACED',
  SET_CURRENT = 'SET_CURRENT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  VIEWED_ORIGINAL = 'VIEWED_ORIGINAL',
}

/**
 * Locking rule (plan §4, critical): every action endpoint EXCEPT
 * `reprocess` (and read-only endpoints) must reject while the set's status
 * is one of these, OR `currentCardVariantId` is still null — see
 * `PhotoReviewService.assertUnlocked`.
 */
export const LOCKED_SET_STATUSES: ReadonlySet<PhotoReviewSetStatus> = new Set([
  PhotoReviewSetStatus.PENDING_AUTO,
  PhotoReviewSetStatus.AUTO_FAILED,
]);

/**
 * Forbidden-edit keyword list (plan §5.3/§6.3) — case-insensitive substring
 * match against the raw Vietnamese prompt text. Deliberately simple for
 * this pass, per the task brief ("case-insensitive substring match on the
 * Vietnamese text is fine"); a real deployment may want stemming/fuzzy
 * matching, tracked as a future improvement, not required now.
 */
export const FORBIDDEN_PROMPT_KEYWORDS: readonly string[] = [
  'cười',
  'mở mắt',
  'bỏ kính',
  'gầy',
  'trẻ hóa',
  'trẻ hoá',
  'đẹp',
  'đổi mắt',
  'đổi mũi',
  'đổi miệng',
];

/** Identity-similarity thresholds — plan §5.3/§5.4/R-Q8. Below reject: below warn: pass clean. */
export const IDENTITY_SIMILARITY_REJECT_THRESHOLD = 0.7;
export const IDENTITY_SIMILARITY_WARN_THRESHOLD = 0.85;

/** Upload validation — plan §5.4. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

/** Sidecar HTTP call timeout (plan §6.4's "chạy nền" budget) — long enough for a real edit, short enough not to hang a request forever when the sidecar is unreachable. */
export const SIDECAR_TIMEOUT_MS = 30_000;

/**
 * Local error-code range for this module (9xxx) — mirrors the numbering
 * convention in `apps/api/src/common/errors/code.constants.error.ts` (each
 * module owns a range) without editing that shared file, which is out of
 * scope for this module (see this module's own top-level doc comment in
 * `photo-review.module.ts`).
 */
export const PHOTO_REVIEW_ERROR_CODE = {
  SET_NOT_FOUND: 9000,
  SET_LOCKED: 9001,
  VARIANT_NOT_FOUND: 9002,
  VARIANT_NOT_IN_SET: 9003,
  VARIANT_DISCARDED: 9004,
  VARIANT_IS_CURRENT: 9005,
  VARIANT_NOT_READY: 9006,
  PROMPT_FORBIDDEN: 9007,
  IDENTITY_MISMATCH: 9008,
  SIDECAR_UNREACHABLE: 9009,
  UPLOAD_INVALID: 9010,
  PHOTO_KIND_NOT_FOUND: 9011,
  PHOTO_KIND_CODE_TAKEN: 9012,
  NOT_REVIEWER: 9013,
  NOT_ADMIN: 9014,
  SOURCE_PHOTO_NOT_FOUND: 9015,
  SESSION_NOT_FOUND: 9016,
  VARIANT_LOCAL_TOKEN_INVALID: 9017,
  VARIANT_NOT_VIEWABLE: 9018,
} as const;
