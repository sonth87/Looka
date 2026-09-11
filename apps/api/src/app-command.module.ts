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
 * `SERVICE_TYPE=command` — HTTP writes (kiosk capture, CMS admin writes).
 * Highest-uptime host (spec §2.1 bản Looka §4.1): a kiosk mid-session
 * losing writes loses photos. No `ScheduleModule.forRoot()` — this process
 * never runs a `@Cron()` job (that's app-worker.module.ts's job); business
 * modules are not yet split into command/query/worker sub-modules (plan §6
 * phases 1-4), so this still imports the same full feature modules as
 * app.module.ts today — the split narrows module-by-module as each one
 * migrates, not all at once.
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
export class AppCommandModule implements NestModule {
  // Mirrors app.module.ts's configure() — see that file's doc comment for
  // the reasoning behind each exclude/forRoutes call.
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
