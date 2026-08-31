import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignController } from './controllers/campaign.controller';
import { DeviceController } from './controllers/device.controller';
import { DeviceSelfController } from './controllers/device-self.controller';
import { Campaign } from './entities/campaign.entity';
import { Device } from './entities/device.entity';
import { DeviceEvent } from './entities/device-event.entity';
import { DeviceCredentialsGuard } from './guards/device-credentials.guard';
import { ActivationPackageService } from './services/activation-package.service';
import { CampaignService } from './services/campaign.service';
import { DeviceService } from './services/device.service';
import { DeviceEventService } from './services/device-event.service';

@Module({
  imports: [TypeOrmModule.forFeature([Campaign, Device, DeviceEvent])],
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
  controllers: [DeviceSelfController, CampaignController, DeviceController],
  providers: [CampaignService, DeviceService, DeviceEventService, ActivationPackageService, DeviceCredentialsGuard],
  exports: [CampaignService, DeviceService, DeviceEventService],
})
export class DeviceManagementModule {}
