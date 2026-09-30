import { SsoAuthGuard } from '@app/shared/auth/index';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { StatsModule } from '@app/modules/stats/stats.module';
import { WorkflowModule } from '@app/modules/workflow/workflow.module';
import { BullModule } from '@nestjs/bullmq';
import { Module, Provider } from '@nestjs/common';
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
import {
  AI_EDIT_BACKGROUND_QUEUE_NAME,
  AI_EDIT_QUEUE_NAME,
} from './photo-review.constants';
import { PHOTO_AI_PORT } from './application/ports/photo-ai.port';
import { AiEditRecoveryService } from './services/ai-edit-recovery.service';
import { AiEditSlotGate } from './services/ai-edit-slot-gate';
import {
  AiEditBackgroundProcessor,
  AiEditProcessor,
} from './services/ai-edit.processor';
import { AiImageEditClient } from './services/ai-image-edit.client';
import { PhotoAiAdapter } from './services/photo-ai.adapter';
import { PhotoKindService } from './services/photo-kind.service';
import { PhotoReviewSidecarService } from './services/photo-review-sidecar.service';
import { PhotoReviewService } from './services/photo-review.service';
import { ReviewAssignmentService } from './services/review-assignment.service';
import { VariantUploadWorkerService } from './services/variant-upload-worker.service';

// `AiEditProcessor` actually CONSUMES the `ai-edit` BullMQ queue (real
// background work, a persistent Redis connection) — only instantiated on
// `worker`/`all`, matching `ScheduleModule.forRoot()`'s own "only the
// worker host runs background work" split (see app-query.module.ts's own
// doc comment, "SERVICE_TYPE=query khởi động được và không đăng ký cron").
// `command`/`query` still get `BullModule.registerQueue()` below (so
// `PhotoReviewService.enqueueAiEditJob` can inject the `Queue` and add jobs
// to it) — they just never run the processor that drains it.
// AiEditSlotGate (2026-09-29, priority-preemption rework) is only ever
// acquired by these two processors — safe to keep conditional alongside
// them rather than a permanent module-level provider, and simpler than
// giving `command`/`query` a gate they never touch.
const aiEditProcessorProvider: Provider[] = ['worker', 'all'].includes(
  process.env.SERVICE_TYPE ?? 'all',
)
  ? [
      AiEditProcessor,
      AiEditBackgroundProcessor,
      AiEditSlotGate,
      AiEditRecoveryService,
    ]
  : [];

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
 * `WorkflowModule` is a deliberate exception to that same "no cross-module
 * dependency" posture (2026-09-28, `ai_pipeline_steps` executor):
 * `PhotoReviewService.reprocess()` reads a campaign's pinned workflow
 * version's `config.aiProcessing` via `WorkflowCatalogReadRepository`
 * (already exported for exactly this kind of cross-module read — see that
 * class's own doc comment, and `device-management/services/campaign.service.ts`
 * for the existing precedent this follows). `workflow` has no dependency
 * back on this module, so this does not create a cycle.
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
 *
 * `PhotoReviewService` raises `PhotoSetStatusChangedEvent` (see
 * `domain/event/photo-set-status-changed.event.ts`) on every real
 * `subject_photo_sets.status` transition, via the shared in-process
 * domain-event mechanism (`shared/cqrs`, `@Global` `DomainEventDispatcher`)
 * — NOT a Nest-level import of `PrintModule` (which reacts to it for the
 * CENTRALIZED print flow's auto-attach/withdraw rule; see that module's own
 * doc comment). This module still has no knowledge of `PrintModule` or
 * printing at all — it only ever raises a generic status-change event.
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
    // For `WorkflowCatalogReadRepository.getVersionRef` — see this module's
    // own top doc comment.
    WorkflowModule,
    // Registers BOTH AI-edit queues (so `@InjectQueue`/`enqueueAiEditJob`
    // resolves on every host, for either lane) — see
    // `aiEditProcessorProvider`'s own comment above for why the thing that
    // actually DRAINS them is conditional. `AI_EDIT_BACKGROUND_QUEUE_NAME`
    // added 2026-09-29 (priority-preemption rework) — see that constant's
    // own doc comment.
    BullModule.registerQueue(
      { name: AI_EDIT_QUEUE_NAME },
      { name: AI_EDIT_BACKGROUND_QUEUE_NAME },
    ),
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
    AiImageEditClient,
    { provide: PHOTO_AI_PORT, useClass: PhotoAiAdapter },
    // Drains `variant_upload_outbox` to fs-core in the background — the
    // local-first counterpart of `capture`'s `UploadWorkerService`, kept as
    // a sibling here rather than folded into that one; see this service's
    // own doc comment for why.
    VariantUploadWorkerService,
    // Drains both AI-edit BullMQ queues (user lane + background lane) — the
    // real `/edit`/pipeline call now runs here, asynchronously, instead of
    // inline inside `reprocess()`/`aiEdit()`'s own HTTP request (2026-09-29,
    // reworked same day for user-priority preemption — `AiEditSlotGate` is
    // the shared in-process semaphore both processors acquire from, and
    // `AiEditRecoveryService` is the restart-recovery sweep). Conditional —
    // see this array's own definition above `@Module`.
    ...aiEditProcessorProvider,
    // `@UseGuards()` on ReviewController/PhotoKindController.
    SsoAuthGuard,
    ReviewerRoleGuard,
  ],
  // `PHOTO_AI_PORT` exported for `AppController`'s consolidated `GET
  // /health` (I-Q9) to ping the AI image-edit service's own reachability/
  // model-loaded state through the port, same as `PhotoReviewService` does
  // — `AppController` has no reason to know `PhotoAiAdapter`/
  // `AiImageEditClient` exist at all. Neither concrete client needs
  // exporting any more: both are only ever injected inside this module now
  // (by `PhotoAiAdapter`).
  exports: [PhotoReviewService, PhotoKindService, PHOTO_AI_PORT],
})
export class PhotoReviewModule {}
