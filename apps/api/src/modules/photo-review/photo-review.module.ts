import { SsoAuthGuard } from '@app/shared/auth/index';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { StatsModule } from '@app/modules/stats/stats.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoKindController } from './controllers/photo-kind.controller';
import { ReviewAssignmentController } from './controllers/review-assignment.controller';
import { ReviewController } from './controllers/review.controller';
import { VariantContentController } from './controllers/variant-content.controller';
import { PhotoKind } from './entities/photo-kind.entity';
import { PhotoReviewEvent } from './entities/photo-review-event.entity';
import { PhotoVariant } from './entities/photo-variant.entity';
import { ReviewAssignment } from './entities/review-assignment.entity';
import { SubjectPhotoSet } from './entities/subject-photo-set.entity';
import { VariantUploadOutboxEntry } from './entities/variant-upload-outbox.entity';
import { ReviewerRoleGuard } from './guards/reviewer-role.guard';
import { PhotoKindService } from './services/photo-kind.service';
import { PhotoReviewSidecarService } from './services/photo-review-sidecar.service';
import { PhotoReviewService } from './services/photo-review.service';
import { ReviewAssignmentService } from './services/review-assignment.service';
import { VariantUploadWorkerService } from './services/variant-upload-worker.service';

/**
 * "Duyệt ảnh" (photo review) CMS module —
 * docs/plans/cms-photo-review-plan.md. A brand-new module, deliberately
 * with NO structural dependency on `device-management` (campaigns) or
 * `capture` (sessions/photos/videos) — both are owned/edited by other
 * agents concurrently in this codebase, per this module's own task brief.
 * Every cross-boundary read goes through plain SQL against the relevant
 * table name (see `PhotoReviewService`'s own top comment), and every
 * cross-boundary id (`campaignId`, `sourceSessionId`, `sourcePhotoId`,
 * `actorUserId`) is a plain uuid column with no foreign key.
 *
 * `User` (for `SsoAuthGuard`) is provided globally by `SharedModule`
 * (`@Global()`), so it does not need to be imported here — see that
 * module's own doc comment.
 *
 * The one deliberate exception to "no cross-module dependency" is
 * `FileStorageModule`: reusing `FileStorageService.clientForTenant`/
 * `uploadRaw`/`issueViewLink` (already public, unmodified by this task) is
 * exactly what the plan calls for (§3 — "cùng cơ chế virtual_path/fs-core
 * đã có, không phát minh lại").
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubjectPhotoSet,
      PhotoVariant,
      PhotoReviewEvent,
      PhotoKind,
      ReviewAssignment,
      // Not injected as a `Repository` anywhere (see that entity's own doc
      // comment — every read/write against it goes through raw SQL, the
      // same convention `capture`'s `UploadOutboxEntry` is actually used
      // under); registered here purely so it participates in this app's
      // schema tooling.
      VariantUploadOutboxEntry,
    ]),
    FileStorageModule,
    // For ReviewStatsService (stats hooks in PhotoReviewService) and
    // StatsQueryService (`GET /v1/review/stats`, ReviewController) — a
    // leaf module with no dependency back on this one, see its own doc
    // comment.
    StatsModule,
  ],
  controllers: [
    ReviewController,
    ReviewAssignmentController,
    PhotoKindController,
    VariantContentController,
  ],
  providers: [
    PhotoReviewService,
    ReviewAssignmentService,
    PhotoKindService,
    PhotoReviewSidecarService,
    // Drains `variant_upload_outbox` to fs-core in the background — the
    // local-first counterpart of `capture`'s `UploadWorkerService`, kept as
    // a sibling here rather than folded into that one; see this service's
    // own doc comment for why.
    VariantUploadWorkerService,
    // `@UseGuards()` on ReviewController/PhotoKindController.
    SsoAuthGuard,
    ReviewerRoleGuard,
  ],
  // `PhotoReviewSidecarService` exported for `AppController`'s consolidated
  // `GET /health` (I-Q9) to ping the AI sidecar's own reachability —
  // nothing else outside this module calls it directly.
  exports: [PhotoReviewService, PhotoKindService, PhotoReviewSidecarService],
})
export class PhotoReviewModule {}
