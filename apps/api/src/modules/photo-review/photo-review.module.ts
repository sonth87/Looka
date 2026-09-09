import { SsoAuthGuard } from '@app/common/guards';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoKindController } from './controllers/photo-kind.controller';
import { ReviewController } from './controllers/review.controller';
import { PhotoKind } from './entities/photo-kind.entity';
import { PhotoReviewEvent } from './entities/photo-review-event.entity';
import { PhotoVariant } from './entities/photo-variant.entity';
import { SubjectPhotoSet } from './entities/subject-photo-set.entity';
import { ReviewerRoleGuard } from './guards/reviewer-role.guard';
import { PhotoKindService } from './services/photo-kind.service';
import { PhotoReviewSidecarService } from './services/photo-review-sidecar.service';
import { PhotoReviewService } from './services/photo-review.service';

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
    TypeOrmModule.forFeature([SubjectPhotoSet, PhotoVariant, PhotoReviewEvent, PhotoKind]),
    FileStorageModule,
  ],
  controllers: [ReviewController, PhotoKindController],
  providers: [
    PhotoReviewService,
    PhotoKindService,
    PhotoReviewSidecarService,
    // `@UseGuards()` on ReviewController/PhotoKindController.
    SsoAuthGuard,
    ReviewerRoleGuard,
  ],
  exports: [PhotoReviewService, PhotoKindService],
})
export class PhotoReviewModule {}
