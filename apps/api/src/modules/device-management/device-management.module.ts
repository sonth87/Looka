import { SsoAuthGuard } from '@app/common/guards';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { PhotoReviewModule } from '@app/modules/photo-review/photo-review.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignController } from './controllers/campaign.controller';
import { CampaignConfigController } from './controllers/campaign-config.controller';
import { CampaignMemberController } from './controllers/campaign-member.controller';
import { CaptureAnglePresetController } from './controllers/capture-angle-preset.controller';
import { DeviceController } from './controllers/device.controller';
import { DeviceSelfController } from './controllers/device-self.controller';
import { MeController } from './controllers/me.controller';
import { Campaign } from './entities/campaign.entity';
import { CampaignMember } from './entities/campaign-member.entity';
import { CaptureAnglePreset } from './entities/capture-angle-preset.entity';
import { Device } from './entities/device.entity';
import { DeviceEvent } from './entities/device-event.entity';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { CampaignMemberGuard } from './guards/campaign-member.guard';
import { DeviceCredentialsGuard } from './guards/device-credentials.guard';
import { ActivationPackageService } from './services/activation-package.service';
import { CampaignService } from './services/campaign.service';
import { CampaignMemberService } from './services/campaign-member.service';
import { CaptureAnglePresetService } from './services/capture-angle-preset.service';
import { DeviceService } from './services/device.service';
import { DeviceEventService } from './services/device-event.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      Device,
      DeviceEvent,
      CaptureAnglePreset,
      CampaignMember,
    ]),
    CaptureModule,
    // For DeviceEventService's best-effort
    // PhotoReviewService.ensureSetForApprovedSession() call — the kiosk-path
    // half of the photo-review auto-creation hook (see that service's own
    // doc comment; imported directly here rather than relying on
    // CaptureModule to re-export it, since CaptureModule's own export list
    // is scoped to its own providers).
    PhotoReviewModule,
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
    CaptureAnglePresetController,
    MeController,
  ],
  providers: [
    CampaignService,
    DeviceService,
    DeviceEventService,
    CampaignMemberService,
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
    CaptureAnglePresetService,
  ],
})
export class DeviceManagementModule {}
