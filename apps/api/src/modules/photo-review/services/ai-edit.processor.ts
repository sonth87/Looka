import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AI_EDIT_BACKGROUND_CONCURRENCY,
  AI_EDIT_BACKGROUND_QUEUE_NAME,
  AI_EDIT_QUEUE_NAME,
  AI_EDIT_USER_WORKER_CONCURRENCY,
  AiEditJobKind,
} from '../photo-review.constants';
import type { AiEditJobData, AiEditLane } from './ai-edit.job';
import { AiEditSlotGate } from './ai-edit-slot-gate';
import { PhotoReviewService } from './photo-review.service';

// Re-exported for backward compatibility — both this module's own DB specs
// and `PhotoReviewService` import `AiEditJobData` from here; the type now
// actually lives in `ai-edit.job.ts` alongside `aiEditJobId`/`AI_EDIT_JOB_OPTS`
// (2026-09-29, so `PhotoReviewService` does not need to import from a
// `services/ai-edit.processor.ts` file it is itself imported BY — avoids a
// two-file import cycle between the processor and the service it calls
// into).
export type { AiEditJobData } from './ai-edit.job';

/**
 * The two processors for the AI-edit BullMQ queues (2026-09-29, rewritten
 * for user-priority preemption — see `AiEditSlotGate`'s own doc comment for
 * the full design and the trade-offs it deliberately does NOT try to solve
 * (aborting an already-running job)).
 *
 * `PhotoReviewService.reprocess()`/`aiEdit()` create the `DRAFT`
 * `photo_variants` row, then `enqueueAiEditJob` claims it (`DRAFT`/
 * `PENDING`/stale-`PROCESSING` → `PROCESSING`, `ai_attempts += 1`) and adds
 * a job to whichever queue matches the caller's lane — `AI_EDIT_QUEUE_NAME`
 * (this file's `AiEditProcessor`) for a direct user click, or
 * `AI_EDIT_BACKGROUND_QUEUE_NAME` (`AiEditBackgroundProcessor`) for a
 * kiosk auto-run or an `AiEditRecoveryService` sweep requeue.
 *
 * Both processors do the SAME two things around the actual work — acquire
 * one `AiEditSlotGate` slot (own lane-aware priority), then call
 * `PhotoReviewService.runQueuedAiEditJob` (the shared stale-check +
 * dispatch to `processReprocessJob`/`processAiEditJob`) — they differ only
 * in `@Processor`'s own queue name/concurrency and which lane they pass to
 * `gate.acquire`.
 *
 * `job.name` (`AiEditJobKind.REPROCESS`/`AI_EDIT`) still picks which
 * `PhotoReviewService.process*Job` method eventually runs (via
 * `runQueuedAiEditJob`) — same two values as before this rework.
 *
 * Neither `process*Job` method rethrows for an expected AI-call failure —
 * see their own doc comments — so this class's `process()` return is
 * normally `void` either way; letting a genuine bug's exception escape here
 * instead is exactly what BullMQ's own failed-job tracking is for.
 *
 * Both only instantiated on `SERVICE_TYPE=worker`/`all` — see
 * `PhotoReviewModule`'s own doc comment for why `command`/`query` register
 * both queues (to enqueue) but neither processor (to consume).
 */

/**
 * Shared body for both processors (2026-09-29 dedup fix — `AiEditProcessor`
 * and `AiEditBackgroundProcessor` used to be a line-for-line copy of each
 * other, differing only in their own `@Processor` options and which lane
 * literal they passed to `gate.acquire`). `@Injectable()` here is required,
 * not decorative: the concrete subclasses below declare no constructor of
 * their own, so TypeScript only emits the `design:paramtypes` metadata
 * Nest's DI needs onto a decorated class — this one.
 */
@Injectable()
abstract class LanedAiEditProcessor extends WorkerHost {
  protected abstract readonly lane: AiEditLane;
  protected abstract readonly logger: Logger;

  constructor(
    protected readonly photoReview: PhotoReviewService,
    protected readonly gate: AiEditSlotGate,
  ) {
    super();
  }

  async process(job: Job<AiEditJobData>): Promise<void> {
    const release = await this.gate.acquire(this.lane);
    try {
      this.logger.log(
        `[${this.lane}] processing ${job.name} job ${job.id} (variant ${job.data.variantId}, origin=${job.data.origin ?? 'unknown'})`,
      );
      await this.photoReview.runQueuedAiEditJob(
        job.name as AiEditJobKind,
        job.data,
      );
    } finally {
      release();
    }
  }
}

// Concurrency deliberately ABOVE `AiEditSlotGate`'s own capacity — see
// `AI_EDIT_USER_WORKER_CONCURRENCY`'s own doc comment for why (2026-09-29
// fix for the dead lane-priority branch).
@Processor(AI_EDIT_QUEUE_NAME, { concurrency: AI_EDIT_USER_WORKER_CONCURRENCY })
export class AiEditProcessor extends LanedAiEditProcessor {
  protected readonly lane: AiEditLane = 'user';
  protected readonly logger = new Logger(AiEditProcessor.name);
}

@Processor(AI_EDIT_BACKGROUND_QUEUE_NAME, {
  concurrency: AI_EDIT_BACKGROUND_CONCURRENCY,
})
export class AiEditBackgroundProcessor extends LanedAiEditProcessor {
  protected readonly lane: AiEditLane = 'background';
  protected readonly logger = new Logger(AiEditBackgroundProcessor.name);
}
