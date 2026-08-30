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
  controllers: [CampaignController, DeviceController, DeviceSelfController],
  providers: [CampaignService, DeviceService, DeviceEventService, ActivationPackageService, DeviceCredentialsGuard],
  exports: [CampaignService, DeviceService, DeviceEventService],
})
export class DeviceManagementModule {}
