import { ApiKeyMiddleware } from '@app/common/middlewares';
import * as configs from '@app/config';
import { TypeOrmConfigService } from '@app/database/database.service';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { PhotoController } from '@app/modules/capture/controllers/photo.controller';
import { SessionController } from '@app/modules/capture/controllers/session.controller';
import { SharedModule } from '@app/modules/shared/shared.module';
import { DeviceManagementModule } from '@app/modules/device-management/device-management.module';
import { CampaignController } from '@app/modules/device-management/controllers/campaign.controller';
import { DeviceController } from '@app/modules/device-management/controllers/device.controller';
import { DeviceExpiryMiddleware } from '@app/modules/device-management/middlewares/device-expiry.middleware';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: Object.values(configs),
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    SharedModule,
    CaptureModule,
    DeviceManagementModule,
  ],
  controllers: [AppController],
  providers: [ApiKeyMiddleware, DeviceExpiryMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The health check stays open - an uptime probe or load balancer should
    // not need a key, and it exposes nothing sensitive.
    //
    // CampaignController/DeviceController are the CMS/admin surface (create
    // campaigns, register devices) - gated by the same shared key as capture.
    // DeviceSelfController is deliberately absent here: a kiosk reading its
    // own config authenticates via DeviceCredentialsGuard's device secret
    // instead, never this admin key (see that controller's own doc comment).
    consumer
      .apply(ApiKeyMiddleware)
      .forRoutes(SessionController, PhotoController, CampaignController, DeviceController);

    // Pass-through when no device headers are sent — see the middleware's
    // own doc comment for why this is safe to attach now, ahead of any web
    // client actually sending them.
    consumer
      .apply(DeviceExpiryMiddleware)
      .forRoutes(SessionController, PhotoController);
  }
}
