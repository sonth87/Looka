import { IdentityModule } from '@app/modules/identity/identity.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignStatsExtraController } from './controllers/campaign-stats-extra.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { StatsOpsController } from './controllers/stats-ops.controller';
import { StatsDailyCapture } from './entities/stats-daily-capture.entity';
import { StatsDailyIdentification } from './entities/stats-daily-identification.entity';
import { StatsDailyPrint } from './entities/stats-daily-print.entity';
import { StatsDailyReview } from './entities/stats-daily-review.entity';
import { StatsCampaignSnapshot } from './entities/stats-campaign-snapshot.entity';
import { StatsJob } from './entities/stats-job.entity';
import { CampaignSnapshotService } from './services/campaign-snapshot.service';
import { CaptureStatsService } from './services/capture-stats.service';
import { PrintStatsService } from './services/print-stats.service';
import { ReviewStatsService } from './services/review-stats.service';
import { StatsJobService } from './services/stats-job.service';
import { StatsQueryService } from './services/stats-query.service';
import { StatsRebuildService } from './services/stats-rebuild.service';
import { DailyRecomputeWorker } from './workers/daily-recompute.worker';
import { SnapshotRefreshWorker } from './workers/snapshot-refresh.worker';

/**
 * `StatsModule` — cms-8-screens-api-plan.md §2.9/P4. A leaf module: it
 * depends on nothing else (every cross-boundary read is plain SQL against
 * table names, same convention `photo-review`/`device-management` already
 * use), so every other feature module can import it without risking a
 * cycle. `AdvisoryLockService` (used by the two cron workers) comes from
 * the already-`@Global()` `FoundationModule` — no explicit import needed.
 *
 * `StatsDailyPrint`'s entity/table now has a real writer: `PrintStatsService`
 * (P6, added 2026-09-14) — see that service's own doc comment for why it
 * lives here rather than inside `modules/print`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StatsDailyCapture,
      StatsDailyIdentification,
      StatsDailyReview,
      StatsDailyPrint,
      StatsCampaignSnapshot,
      StatsJob,
    ]),
    // For `PermissionsGuard` on `StatsOpsController.rebuild()` —
    // `@UseGuards()` resolves a guard's own constructor deps against the
    // CONSUMING module's DI graph, not a pre-built singleton from where the
    // guard class was exported (same gotcha already documented for
    // `device-management`/`workflow` in P1 — see those modules' own import
    // comments), so `IdentityModule` must be imported here too, not just
    // referenced by class.
    IdentityModule,
  ],
  controllers: [
    DashboardController,
    StatsOpsController,
    CampaignStatsExtraController,
  ],
  providers: [
    CaptureStatsService,
    ReviewStatsService,
    PrintStatsService,
    CampaignSnapshotService,
    StatsJobService,
    StatsQueryService,
    StatsRebuildService,
    SnapshotRefreshWorker,
    DailyRecomputeWorker,
  ],
  exports: [
    CaptureStatsService,
    ReviewStatsService,
    PrintStatsService,
    CampaignSnapshotService,
    StatsQueryService,
    StatsJobService,
  ],
})
export class StatsModule {}
