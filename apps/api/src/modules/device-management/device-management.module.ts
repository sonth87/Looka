import { SsoAuthGuard } from '@app/shared/auth/index';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { PhotoReviewModule } from '@app/modules/photo-review/photo-review.module';
import { IdentityModule } from '@app/modules/identity/identity.module';
import { WorkflowModule } from '@app/modules/workflow/workflow.module';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { StatsModule } from '@app/modules/stats/stats.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignController } from './controllers/campaign.controller';
import { CampaignConfigController } from './controllers/campaign-config.controller';
import { CampaignKioskAssignmentController } from './controllers/campaign-kiosk-assignment.controller';
import { CampaignMemberController } from './controllers/campaign-member.controller';
import { CampaignSubjectController } from './controllers/campaign-subject.controller';
import { CampaignSubjectLookupController } from './controllers/campaign-subject-lookup.controller';
import { CampaignSubjectPhotoStatusController } from './controllers/campaign-subject-photo-status.controller';
import { CaptureAnglePresetController } from './controllers/capture-angle-preset.controller';
import { DeviceController } from './controllers/device.controller';
import { DeviceSelfController } from './controllers/device-self.controller';
import { IdentificationMethodController } from './controllers/identification-method.controller';
import { MeController } from './controllers/me.controller';
import { Campaign } from './entities/campaign.entity';
import { CampaignKioskAssignment } from './entities/campaign-kiosk-assignment.entity';
import { CampaignMember } from './entities/campaign-member.entity';
import { CampaignSubject } from './entities/campaign-subject.entity';
import { CampaignSubjectImport } from './entities/campaign-subject-import.entity';
import { CaptureAnglePreset } from './entities/capture-angle-preset.entity';
import { Device } from './entities/device.entity';
import { DeviceEvent } from './entities/device-event.entity';
import { EligibilityCheckLog } from './entities/eligibility-check-log.entity';
import { IdentificationMethod } from './entities/identification-method.entity';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { CampaignMemberGuard } from './guards/campaign-member.guard';
import { DeviceCredentialsGuard } from './guards/device-credentials.guard';
import { ActivationPackageService } from './services/activation-package.service';
import { CampaignService } from './services/campaign.service';
import { CampaignKioskAssignmentService } from './services/campaign-kiosk-assignment.service';
import { CampaignMemberService } from './services/campaign-member.service';
import { CampaignSubjectService } from './services/campaign-subject.service';
import { CaptureAnglePresetService } from './services/capture-angle-preset.service';
import { DeviceService } from './services/device.service';
import { DeviceEventService } from './services/device-event.service';
import { IdentificationMethodService } from './services/identification-method.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      Device,
      DeviceEvent,
      CaptureAnglePreset,
      CampaignMember,
      CampaignKioskAssignment,
      CampaignSubjectImport,
      CampaignSubject,
      IdentificationMethod,
      EligibilityCheckLog,
    ]),
    // `CampaignSubjectService.importRoster` uploads the parsed error report
    // (and the original file) via `FileStorageService` — same reasoning
    // `IdentityModule` imports it for `UserCommandController.uploadAvatar`.
    FileStorageModule,
    CaptureModule,
    // For DeviceEventService's best-effort
    // PhotoReviewService.ensureSetForApprovedSession() call — the kiosk-path
    // half of the photo-review auto-creation hook (see that service's own
    // doc comment; imported directly here rather than relying on
    // CaptureModule to re-export it, since CaptureModule's own export list
    // is scoped to its own providers).
    PhotoReviewModule,
    // For `PermissionsGuard` on campaign.controller.ts's
    // create/update/delete routes (2026-09-11 security fix,
    // cms-8-screens-api-plan.md §7 I-Q) — Nest resolves a class passed to
    // `@UseGuards()` through this module's own DI graph, so the exporting
    // module must be imported here, not just referenced by path.
    IdentityModule,
    // For `CampaignService`'s injected `WorkflowCatalogReadRepository` —
    // cms-8-screens-api-plan.md §2.2/P2's config merge into `CampaignDao`/
    // `CampaignConfigDao`. One-directional: `WorkflowModule` never imports
    // `DeviceManagementModule` back (it uses `capture-angles.validator.ts`
    // as a plain function import, not a Nest module dependency — see that
    // validator's own re-export note in `workflow/application/validate-workflow-config.ts`).
    WorkflowModule,
    // For `DeviceEventService`'s `CaptureStatsService` hook and
    // `CampaignSubjectService`'s `CampaignSnapshotService` refresh-after-
    // import call — cms-8-screens-api-plan.md §2.9/P4. NOT transitively
    // available through `CaptureModule`/`PhotoReviewModule` above (neither
    // re-exports `StatsModule`), so imported directly here too.
    StatsModule,
  ],
  // DeviceSelfController MUST come before DeviceController: Nest/Express
  // matches routes in registration order, and DeviceController's `GET
  // devices/:id` is a dynamic segment that matches the literal string
  // "config" before DeviceSelfController's own `GET devices/config` route
  // ever gets a chance — which silently ran every device-credential-gated
  // config fetch through ApiKeyMiddleware instead (a kiosk's device
  // credentials were never a valid x-api-key, so every kiosk request failed
  // with "API key required" rather than reaching DeviceCredentialsGuard at
  // all). Caught only by an actual live round-trip test against a real
  // Postgres, not by any unit test — those exercise each controller/guard in
  // isolation and never see the two composed together through Nest's router.
  //
  // 2026-09-08: `CaptureAnglePresetController`/`CampaignMemberController`/
  // `CampaignConfigController`/`MeController` added — none of them declare a
  // bare `:id`-shaped GET under `devices/...` or `campaigns/...` that could
  // shadow (or be shadowed by) any route above, so no analogous ordering
  // constraint applies to them; still listed after the two devices
  // controllers to keep that documented ordering constraint visually
  // undisturbed.
  controllers: [
    DeviceSelfController,
    CampaignController,
    DeviceController,
    CampaignConfigController,
    CampaignMemberController,
    CampaignKioskAssignmentController,
    CampaignSubjectController,
    CampaignSubjectLookupController,
    CampaignSubjectPhotoStatusController,
    IdentificationMethodController,
    CaptureAnglePresetController,
    MeController,
  ],
  providers: [
    CampaignService,
    DeviceService,
    DeviceEventService,
    CampaignMemberService,
    CampaignKioskAssignmentService,
    CampaignSubjectService,
    IdentificationMethodService,
    CaptureAnglePresetService,
    ActivationPackageService,
    DeviceCredentialsGuard,
    // `@UseGuards()` on CampaignController/DeviceController/etc - see those
    // controllers' own doc comments.
    SsoAuthGuard,
    AdminRoleGuard,
    CampaignMemberGuard,
  ],
  exports: [
    CampaignService,
    DeviceService,
    DeviceEventService,
    CampaignMemberService,
    CampaignKioskAssignmentService,
    CampaignSubjectService,
    CaptureAnglePresetService,
  ],
})
export class DeviceManagementModule {}
