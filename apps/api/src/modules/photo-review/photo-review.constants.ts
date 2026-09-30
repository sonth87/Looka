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

/**
 * `photo_variants.status` — plan §2, reworked 2026-09-29 (AI-edit queue
 * lifecycle + user-priority preemption, migration
 * `1841000000000-PhotoVariantAiQueueLifecycle`), then simplified same-day
 * (user request: "bỏ PENDING đi" — drop the separate PENDING status). Never
 * hard-deleted; DISCARDED is the closest thing to "removed".
 *
 * Lifecycle:
 * ```
 *   DRAFT ──(enqueueAiEditJob claims it)──▶ PROCESSING ──▶ DONE (success)
 *                                               │
 *                                               ├──▶ (retryable/timeout
 *                                               │     failure, ai_attempts <
 *                                               │     AI_EDIT_MAX_ATTEMPTS)
 *                                               │     STAYS PROCESSING — only
 *                                               │     `note`/`updated_at`
 *                                               │     change. Once stale
 *                                               │     (no live BullMQ job for
 *                                               │     `AI_EDIT_RECOVERY_-
 *                                               │     PROCESSING_STALE_MS`),
 *                                               │     AiEditRecoveryService's
 *                                               │     sweep re-claims it —
 *                                               │     same path a genuine
 *                                               │     crash recovery takes.
 *                                               │
 *                                               └──▶ FAILED (permanent/business
 *                                                     failure — forbidden
 *                                                     prompt, identity
 *                                                     mismatch, missing
 *                                                     source, or attempts
 *                                                     exhausted — never
 *                                                     auto-retried)
 * ```
 * There is deliberately NO separate "waiting to retry" status any more — a
 * retryable failure is indistinguishable, at the DB level, from a run that
 * simply hasn't finished yet (or crashed mid-flight): both are just
 * `PROCESSING` with no live job and an aging `updated_at`. This folds what
 * used to be two recovery-sweep branches (`PENDING`, `PROCESSING`-stale)
 * into one, and keeps the CMS's own polling contract simpler — a variant is
 * either still "in flight" (`DRAFT`/`PROCESSING`) or it has settled
 * (`DONE`/`FAILED`); there is nothing in between for `AiEditModal` to special
 * -case.
 * - `DRAFT`: the row exists (created in the same transaction as its
 *   `AUTO_GENERATED`/`AI_REQUESTED` audit event) but has not yet been
 *   claimed onto a BullMQ queue. A DRAFT stuck long enough (no live job)
 *   means `enqueueAiEditJob` itself failed/crashed before ever calling
 *   `queue.add` — the recovery sweep re-claims it.
 * - `PROCESSING`: claimed (guarded UPDATE bumped `ai_attempts`) and
 *   enqueued/running on `ai-edit` (user lane) or `ai-edit-background`
 *   (kiosk auto-run / recovery-requeued lane) — OR a retryable failure is
 *   sitting here waiting for the next sweep tick to re-claim it (see the
 *   lifecycle diagram above).
 * - `DONE` (renamed from `READY` — no behavioral change, see the migration's
 *   own doc comment for why): the AI/auto pipeline produced a usable image.
 *   `acceptVariant`/`setCurrent` still require this status; `uploadVariant`
 *   still creates a variant directly in this status (no queue involved).
 * - `FAILED`: a permanent, never-auto-retried failure — forbidden-prompt
 *   rejection, identity-mismatch, a missing source photo, the AI service's
 *   own Terminal/Unavailable outcome, or a Retryable/Timeout failure that
 *   already exhausted `AI_EDIT_MAX_ATTEMPTS`.
 * - `DISCARDED`: unchanged — a reviewer explicitly discarded this variant.
 */
export enum PhotoVariantStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
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

/**
 * The BullMQ `ai-edit` queue's name (`BullModule.registerQueue`/
 * `@InjectQueue`/`@Processor` all reference this same string) — 2026-09-29
 * ("đẩy vào queue, lock lại chỉ cho 1 tiến trình chạy, xử lý concurrence
 * 10"). This is now the **user lane** (2026-09-29, priority-preemption
 * follow-up, see `AI_EDIT_BACKGROUND_QUEUE_NAME`): a user-clicked
 * `POST .../reprocess` or `POST .../ai-edit` always enqueues here. Job NAME
 * within either queue doubles as which `PhotoReviewService` flow created
 * it, so `AiEditProcessor`/`AiEditBackgroundProcessor` know which
 * `process*Job` method to call — same two values as the old `AiEditJobKind`
 * enum this replaces.
 */
export const AI_EDIT_QUEUE_NAME = 'ai-edit';
export enum AiEditJobKind {
  REPROCESS = 'reprocess',
  AI_EDIT = 'ai-edit',
}

/**
 * The **background lane** (2026-09-29, user-priority-preemption follow-up)
 * — kiosk auto-runs (`DeviceEventService`'s best-effort `reprocess()` call,
 * origin `AUTO`) and `AiEditRecoveryService`'s requeued jobs (origin
 * `RECOVERY`) both enqueue here instead of `AI_EDIT_QUEUE_NAME`, so they can
 * never fill every `AiEditSlotGate` slot and starve a user's own click —
 * see that gate's own doc comment for the full reasoning (BullMQ
 * `opts.priority` alone cannot RESERVE a slot, only pick who gets the next
 * free one, so a single shared queue was not enough on its own).
 */
export const AI_EDIT_BACKGROUND_QUEUE_NAME = 'ai-edit-background';

/**
 * `AiEditProcessor`'s own concurrency (`@Processor(AI_EDIT_QUEUE_NAME, {
 * concurrency: AI_EDIT_JOB_CONCURRENCY })`) — lowered 2026-09-29 (user
 * request: user-initiated AI-gen must always be able to jump ahead of
 * whatever is already running) from 10 down to 3. This is now also the
 * `AiEditSlotGate` capacity shared by BOTH `AiEditProcessor` and
 * `AiEditBackgroundProcessor` — see that gate's own doc comment for why a
 * process-wide semaphore, not just BullMQ's own per-queue concurrency
 * option, is what actually gives the user lane its "next free slot always
 * goes to a user job first" guarantee.
 */
export const AI_EDIT_JOB_CONCURRENCY = 3;

/**
 * `AiEditProcessor`'s own BullMQ concurrency (how many jobs the Worker will
 * FETCH/run its `process()` on at once) — deliberately kept ABOVE
 * `AI_EDIT_JOB_CONCURRENCY` (the `AiEditSlotGate` capacity), not equal to
 * it (2026-09-29 fix: with the two equal, a freshly-clicked user job could
 * never become a gate `userWaiters` entry until an ALREADY-held user slot
 * freed — so a released slot with zero VISIBLE user waiters was quietly
 * handed to a waiting background job instead, ahead of the fresh click; see
 * `AiEditSlotGate`'s own doc comment for the full "user always wins the
 * next slot" guarantee this was silently breaking). The buffer lets a
 * burst of fresh clicks be fetched by BullMQ and immediately start
 * `await`ing `gate.acquire('user')` — actually visible as `userWaiters` —
 * even while all `AI_EDIT_JOB_CONCURRENCY` gate slots are already held.
 * Those extra fetched-but-gated jobs do no real work (no GPU/AI call
 * happens until the gate actually grants them a slot), so this does not
 * raise real concurrent AI-call load — `AiEditSlotGate.capacity` still
 * bounds that to `AI_EDIT_JOB_CONCURRENCY`.
 */
export const AI_EDIT_USER_WORKER_CONCURRENCY = AI_EDIT_JOB_CONCURRENCY + 2;

/**
 * `AiEditBackgroundProcessor`'s own BullMQ concurrency — MUST stay strictly
 * below `AI_EDIT_JOB_CONCURRENCY` (never let the background lane alone
 * claim every gate slot). Set to 1: the real `/edit` GPU service processes
 * one request at a time anyway (its own internal queue, FIFO — see
 * `AiImageEditClient`'s own doc comment), so every additional in-flight
 * background request just sits ahead of a user's on that same server-side
 * queue without adding real throughput. With exactly 1, a freshly-clicked
 * user job waits behind at most one already-running GPU call, and 2 of the
 * 3 gate slots stay free for more user jobs to start immediately.
 */
export const AI_EDIT_BACKGROUND_CONCURRENCY = 1;

/**
 * How many times `enqueueAiEditJob` will claim (and therefore run) one
 * variant before a Timeout/Retryable failure is treated as permanent
 * (`FAILED` instead of left `PROCESSING` for the next sweep retry) — see
 * `resolveAiJobFailureStatus`.
 */
export const AI_EDIT_MAX_ATTEMPTS = 5;

/**
 * Per-set cap on simultaneously in-flight (`DRAFT`/`PROCESSING` — the latter
 * includes a retryable failure awaiting its next sweep attempt, see
 * `PhotoVariantStatus`'s own doc comment) `CARD_AI` variants `aiEdit()` will
 * allow (2026-09-29 hardening).
 * `aiEdit()` — unlike `reprocess()` — has no single-flight guard at all:
 * every `POST .../ai-edit` call creates a brand-new variant and a brand-new
 * job, so nothing stopped a scripted/compromised reviewer token from
 * queuing an unbounded number of jobs for the same set. A real reviewer
 * never needs more than a couple of edits in flight on one set at once.
 */
export const AI_EDIT_MAX_IN_FLIGHT_PER_SET = 5;

/** `AiEditRecoveryService`'s periodic sweep interval — every 5 minutes, plus once at boot. */
export const AI_EDIT_RECOVERY_CRON = '0 */5 * * * *';
/** A PROCESSING variant (whether genuinely crashed mid-run, or a retryable failure just waiting for its next attempt — see `PhotoVariantStatus`'s own doc comment, there is no separate status for the latter) is only recovered once it has been stale (no live BullMQ job, `updated_at` this old) for at least this long — short enough that a crash/retry recovers promptly, long enough not to race an in-flight job that just hasn't written its terminal state yet. */
export const AI_EDIT_RECOVERY_PROCESSING_STALE_MS = 60_000;
/** A DRAFT variant older than this (on a periodic — not boot — sweep) is recovered; at boot every stale DRAFT row older than `AI_EDIT_RECOVERY_BOOT_GRACE_MS` is swept instead, rather than every one regardless of age. */
export const AI_EDIT_RECOVERY_MIN_AGE_MS = 5 * 60_000;
/**
 * Minimum age used in PLACE of `AI_EDIT_RECOVERY_PROCESSING_STALE_MS`/
 * `AI_EDIT_RECOVERY_MIN_AGE_MS` for the boot sweep only (2026-09-30 fix —
 * confirmed audit finding). The boot sweep used to use age 0 for both, on
 * the assumption that "nothing from a PREVIOUS process can still be
 * genuinely in flight right after a fresh start" — true for a single-process
 * deployment, but not for this app's split `command`/`worker` `SERVICE_TYPE`
 * deployment: a `command` host keeps serving `POST .../reprocess`/`ai-edit`
 * the whole time a `worker` host is restarting, so a row that host claims
 * (or creates as DRAFT) in the gap between the sweep's own `getJobs` Redis
 * listing and its candidate SELECT is at least 0ms old and missing from that
 * listing — the sweep then re-claims it as `RECOVERY`, stealing it onto the
 * background lane out from under the request that just claimed it. Comfortably
 * longer than `enqueueAiEditJob`'s own 5s `queue.add` timeout, so a claim
 * racing the sweep this way is always past that window by the time this
 * grace period alone would let the sweep touch it.
 */
export const AI_EDIT_RECOVERY_BOOT_GRACE_MS = 15_000;
/** Upper bound per sweep tick, so one huge backlog cannot make a single tick run unboundedly long. */
export const AI_EDIT_RECOVERY_BATCH_LIMIT = 500;

/**
 * Who actually triggered one `ai-edit`/`ai-edit-background` job — threaded
 * through `AiEditJobData.origin` purely for logging/observability (it is
 * NOT part of the DB claim guard, which is status+`ai_attempts` only).
 * `USER` is the one case `enqueueAiEditJob`'s caller decides the LANE from
 * (see `PhotoReviewService.reprocess`/`aiEdit`'s own doc comments) — the
 * literal "ưu tiên cho hành động người dùng chủ động bấm nút gen bằng AI"
 * requirement this whole rework exists for.
 */
export enum AiEditJobOrigin {
  /** A CMS reviewer's own direct click — `ReviewController.reprocess`'s `req.user?.id`-carrying call, or `POST .../ai-edit`. Always the user lane. */
  USER = 'user',
  /** The kiosk's own best-effort auto-run right after a session is approved (`DeviceEventService.recordBatch`) — always the background lane. */
  AUTO = 'auto',
  /** `AiEditRecoveryService`'s periodic sweep re-enqueuing a stuck/crashed row — always the background lane. */
  RECOVERY = 'recovery',
}

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

/**
 * Most sets one `POST /v1/review/sets/approve|reject` call may name. Each set
 * is its own transaction, processed sequentially (see
 * `PhotoReviewService.decideMany`), so this bounds the request's wall time
 * rather than a payload size.
 */
export const MAX_REVIEW_BULK_SETS = 200;

/** Upload validation — plan §5.4. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
];

/** Sidecar HTTP call timeout (plan §6.4's "chạy nền" budget) — long enough for a real edit, short enough not to hang a request forever when the sidecar is unreachable. */
export const SIDECAR_TIMEOUT_MS = 30_000;

/**
 * `review_assignments.group_field` allowlist (plan §5.2, feature 13) — the
 * 3 real denormalized columns on `SubjectPhotoSet`, not full jsonb-discovered
 * generality (that table has no `extra` jsonb of its own, unlike
 * `campaign_subjects`).
 */
export const REVIEW_ASSIGNMENT_GROUP_FIELDS = [
  'className',
  'faculty',
  'major',
] as const;

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
  OUT_OF_SCOPE: 9019,
  INVALID_GROUP_FIELD: 9020,
  PRINT_ITEM_ALREADY_EXPORTED: 9021,
  AI_EDIT_IN_FLIGHT_LIMIT: 9022,
} as const;
