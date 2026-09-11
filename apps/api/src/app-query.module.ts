import { ApiKeyMiddleware } from '@app/shared/auth/api-key.middleware';
import * as configs from '@app/shared/config';
import { TypeOrmConfigService } from '@app/shared/database/database.service';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { PhotoController } from '@app/modules/capture/controllers/photo.controller';
import { SessionController } from '@app/modules/capture/controllers/session.controller';
import { SharedModule } from '@app/modules/shared/shared.module';
import { DeviceManagementModule } from '@app/modules/device-management/device-management.module';
import { DeviceExpiryMiddleware } from '@app/modules/device-management/middlewares/device-expiry.middleware';
import { PhotoReviewModule } from '@app/modules/photo-review/photo-review.module';
import { FoundationModule } from '@app/shared/foundation.module';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * `SERVICE_TYPE=query` — HTTP reads (CMS listings/dashboards, kiosk status
 * polling). Deliberately does NOT import `ScheduleModule.forRoot()`: with
 * no `ScheduleExplorer` in this process's module graph, any `@Cron()`
 * metadata on a provider instantiated here (e.g. the upload-outbox
 * drainers, still living inside CaptureModule/PhotoReviewModule pending
 * their own module split — plan §6 phases 2/4) is simply never picked up,
 * so no cron runs — this is what the Phase 0 acceptance check
 * ("SERVICE_TYPE=query khởi động được và không đăng ký cron") verifies.
 *
 * This process CAN still write today (its controllers are the same ones
 * app-command.module.ts registers, since business modules are not yet
 * split into command/query sub-modules) — that narrows as each module
 * migrates to `presentation/{kiosk,cms}` + separate command/query
 * sub-modules (plan §6). Do not deploy this as a real read-only replica
 * until that split lands for the modules it serves.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: Object.values(configs),
    }),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    FoundationModule,
    SharedModule,
    CaptureModule,
    DeviceManagementModule,
    PhotoReviewModule,
  ],
  providers: [ApiKeyMiddleware, DeviceExpiryMiddleware],
})
export class AppQueryModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ApiKeyMiddleware)
      .exclude(
        { path: 'sessions', method: RequestMethod.GET, version: '1' },
        { path: 'sessions/:id', method: RequestMethod.GET, version: '1' },
      )
      .forRoutes(SessionController);

    consumer
      .apply(DeviceExpiryMiddleware)
      .forRoutes(SessionController, PhotoController);
  }
}
