import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AI_EDIT_JOB_CONCURRENCY,
  AI_EDIT_QUEUE_NAME,
  AiEditJobKind,
} from '../photo-review.constants';
import { PhotoReviewService } from './photo-review.service';

export interface AiEditJobData {
  setId: string;
  variantId: string;
  /** Only set for `AiEditJobKind.AI_EDIT` — `reprocess()` needs nothing beyond `setId`/`variantId`, see `PhotoReviewService.processReprocessJob`'s own doc comment. */
  payload?: { cfg?: number; steps?: number; seed?: number };
}

/**
 * The one processor for the `ai-edit` BullMQ queue (2026-09-29 — "đẩy vào
 * queue, lock lại chỉ cho 1 tiến trình chạy, xử lý concurrence 10").
 * `PhotoReviewService.reprocess()`/`aiEdit()` create the `PROCESSING`
 * `photo_variants` row and enqueue here (`enqueueAiEditJob`) instead of
 * calling the real `/edit` service inline — this class is what actually
 * makes that call, asynchronously, via `@nestjs/bullmq`'s `WorkerHost`.
 *
 * `job.name` (`AiEditJobKind.REPROCESS`/`AI_EDIT`) picks which
 * `PhotoReviewService.process*Job` method to call — those already have
 * their own internal `try`/`catch` (unchanged from before this queue
 * existed) that mark the `photo_variants` row `FAILED` on any AI-call
 * failure and never rethrow, so this method's return is normally `void`
 * either way; letting an exception escape here instead (a genuine bug in
 * the processing method itself, not an expected AI failure) is exactly
 * what BullMQ's own retry/failed-job tracking is for — no separate
 * "last-resort catch" needed the way the old raw-SQL-queue worker needed
 * one (Redis, not `photo_variants`, is this job's own source of truth for
 * whether it succeeded).
 *
 * `concurrency: AI_EDIT_JOB_CONCURRENCY` (10) is BullMQ's own per-process
 * option — set once here, not reimplemented as a manual claim-batch limit
 * — chosen to match the real `/edit` service's own documented queue depth
 * (its integration guide: "503 Queue đã đầy (mặc định 10 job)").
 *
 * Only instantiated on `SERVICE_TYPE=worker`/`all` — see
 * `PhotoReviewModule`'s own doc comment for why `command`/`query` register
 * the queue (to enqueue) but not this processor (to consume).
 */
@Processor(AI_EDIT_QUEUE_NAME, { concurrency: AI_EDIT_JOB_CONCURRENCY })
export class AiEditProcessor extends WorkerHost {
  private readonly logger = new Logger(AiEditProcessor.name);

  constructor(private readonly photoReview: PhotoReviewService) {
    super();
  }

  async process(job: Job<AiEditJobData>): Promise<void> {
    this.logger.log(
      `processing ${job.name} job ${job.id} (variant ${job.data.variantId})`,
    );
    if ((job.name as AiEditJobKind) === AiEditJobKind.REPROCESS) {
      await this.photoReview.processReprocessJob(
        job.data.setId,
        job.data.variantId,
      );
    } else {
      await this.photoReview.processAiEditJob(
        job.data.setId,
        job.data.variantId,
        job.data.payload ?? {},
      );
    }
  }
}
