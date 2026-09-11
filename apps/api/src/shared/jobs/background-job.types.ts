/**
 * Contracts for the generic `background_jobs` queue (plan §7 Q18) — non-
 * upload background work (AI card-photo processing, export, future print)
 * that today runs best-effort right after a commit with no retry (see
 * `photo-review.service.ts`'s `reprocess()` call site and
 * `device-event.service.ts`'s post-commit side effects).
 *
 * Deliberately no `@Entity()`/migration yet: Phase 0 (plan §6) is "no
 * behaviour change", and a table with no real writer is dead schema
 * sitting untested until something needs it. The first module that
 * actually enqueues a job (plan §6 Phase 4, `photo-review`'s
 * `PHOTO_REVIEW_PROCESS` kind) adds the entity + migration then, against
 * `shared/database/base.entity.ts`, and implements `IBackgroundJobRepository`
 * against it. This file only fixes the shape everything else codes against.
 */
export type BackgroundJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface BackgroundJob<TPayload = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly payload: TPayload;
  readonly status: BackgroundJobStatus;
  readonly attempts: number;
  readonly idemKey: string;
  readonly correlationId?: string;
}

export interface IBackgroundJobRepository {
  /**
   * Insert a job row — called from inside a domain-event handler, so it
   * runs in the SAME transaction as the state change that triggered it
   * (outbox pattern, spec §9.1). `idemKey` must be unique
   * (`ON CONFLICT (idem_key) DO NOTHING`), matching every other outbox
   * table in this codebase.
   */
  enqueue<TPayload>(
    kind: string,
    payload: TPayload,
    idemKey: string,
    correlationId?: string,
  ): Promise<void>;

  /** Claim up to `limit` PENDING/due-for-retry rows via `FOR UPDATE SKIP LOCKED`. */
  claimNext(limit: number): Promise<BackgroundJob[]>;

  markDone(id: string): Promise<void>;
  markFailed(
    id: string,
    error: string,
    nextRetryAt: Date | null,
  ): Promise<void>;
}

export const BACKGROUND_JOB_REPOSITORY = Symbol('IBackgroundJobRepository');

/** Handles one `kind` of background job — registered per kind by a module. */
export interface IBackgroundJobHandler<TPayload = unknown> {
  readonly kind: string;
  handle(payload: TPayload): Promise<void>;
}
