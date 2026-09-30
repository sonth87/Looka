import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AI_EDIT_RECOVERY_CRON } from '../photo-review.constants';
import { PhotoReviewService } from './photo-review.service';

/**
 * Restart-recovery sweep for the AI-edit queue (2026-09-29 user request,
 * item 3: "khi server khởi động hoặc restart... tự động chạy một
 * cron/recovery job quét toàn bộ photo_variants đang ở trạng thái
 * PROCESSING hoặc PENDING và đẩy lại vào BullMQ queue" — PENDING was later
 * dropped as a separate status the same day, "bỏ PENDING đi": a retryable
 * failure now just stays PROCESSING, so this sweep's PROCESSING branch
 * alone covers what used to be two branches, see
 * `PhotoReviewService.requeueStuckAiEditVariants`'s own doc comment).
 * Mirrors
 * `CampaignSubjectPullStuckJobRecoveryWorker`'s own shape (own doc comment
 * — `running` flag + `AdvisoryLockService.withLock` so multiple worker
 * replicas never double-sweep the same rows).
 *
 * Runs once at boot (`OnApplicationBootstrap`, fire-and-forget — Nest's
 * bootstrap sequence must not be held up by a DB sweep) and then every 5
 * minutes (`AI_EDIT_RECOVERY_CRON`). All the actual claim/status logic
 * lives in `PhotoReviewService.requeueStuckAiEditVariants` — this class is
 * only the scheduling/locking wrapper, same split
 * `CampaignSubjectPullStuckJobRecoveryWorker` already established between
 * itself and the command it runs.
 *
 * Only registered on `SERVICE_TYPE=worker`/`all` — see
 * `PhotoReviewModule`'s own doc comment (same conditional-provider array
 * `AiEditProcessor`/`AiEditBackgroundProcessor` already use).
 */
@Injectable()
export class AiEditRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiEditRecoveryService.name);
  private running = false;

  constructor(
    private readonly lock: AdvisoryLockService,
    private readonly photoReview: PhotoReviewService,
  ) {}

  onApplicationBootstrap(): void {
    // Not awaited — see this class's own top doc comment.
    void this.tick(true);
  }

  @Cron(AI_EDIT_RECOVERY_CRON)
  async cronTick(): Promise<void> {
    await this.tick(false);
  }

  private async tick(onBoot: boolean): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.lock.withLock('photo_review_ai_edit_recovery', async () => {
        const result = await this.photoReview.requeueStuckAiEditVariants({
          onBoot,
        });
        if (result.requeued > 0 || result.failed > 0) {
          this.logger.warn(
            `AI-edit recovery sweep (onBoot=${onBoot}): requeued ${result.requeued}, marked ${result.failed} FAILED (attempts exhausted)`,
          );
        } else {
          this.logger.log(
            `AI-edit recovery sweep (onBoot=${onBoot}): nothing to recover`,
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `AI-edit recovery sweep failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
