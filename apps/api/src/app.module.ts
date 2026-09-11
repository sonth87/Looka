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
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';

// SERVICE_TYPE=all (default, dev) — everything in one process, unchanged
// behaviour from before docs/plans/backend-layering-plan.md Phase 0. See
// app-command.module.ts / app-query.module.ts / app-worker.module.ts for
// the split this mirrors; main.ts picks one of the four by SERVICE_TYPE.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: Object.values(configs),
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    FoundationModule,
    SharedModule,
    CaptureModule,
    DeviceManagementModule,
    PhotoReviewModule,
  ],
  controllers: [AppController],
  providers: [ApiKeyMiddleware, DeviceExpiryMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The health check stays open - an uptime probe or load balancer should
    // not need a key, and it exposes nothing sensitive.
    //
    // As of 2026-09-07, CampaignController/DeviceController/PhotoController
    // moved off this shared key entirely onto SsoAuthGuard (bearer token
    // forwarded to the external SSO backend, see docs/LOGIN.md §12 and each
    // controller's own doc comment) - they are CMS/admin surfaces a human
    // operator drives, and api-key was retired from that surface per that
    // date's product decision. They are gone from forRoutes() below entirely
    // rather than merely excluded, since every route on each of those
    // controllers moved (this is also why the historical `devices/config`/
    // `devices/events` excludes below were removed - DeviceController isn't
    // in forRoutes() any more for them to matter against). SessionController
    // stays here because most of its routes are still the genuine capture
    // pipeline (apps/web's unattended kiosk) - only its two CMS-facing GET
    // routes (`listSessions`/`getSessionDetail`, added later for the CMS's
    // SessionsPanel/SessionDetailDrawer) moved to SsoAuthGuard, hence the two
    // excludes below rather than dropping the whole controller. Each exclude
    // matches an exact route shape SessionController only has once (`GET
    // sessions`, `GET sessions/:id`), so nothing else on it is caught by
    // them - see session.controller.ts's own doc comment.
    //
    // DeviceSelfController is deliberately absent here: a kiosk reading its
    // own config authenticates via DeviceCredentialsGuard's device secret
    // instead, never this admin key (see that controller's own doc comment).
    // Its routes (`GET devices/config`, `POST devices/events`) used to need
    // an explicit exclude here because DeviceController's `GET devices/:id`
    // is an unconstrained path segment that also matches those literal
    // strings - see git history on this file for that incident. That hazard
    // no longer applies now that DeviceController isn't gated by this
    // middleware at all.
    consumer
      .apply(ApiKeyMiddleware)
      .exclude(
        { path: 'sessions', method: RequestMethod.GET, version: '1' },
        { path: 'sessions/:id', method: RequestMethod.GET, version: '1' },
      )
      .forRoutes(SessionController);

    // Pass-through when no device headers are sent — see the middleware's
    // own doc comment for why this is safe to attach now, ahead of any web
    // client actually sending them.
    consumer
      .apply(DeviceExpiryMiddleware)
      .forRoutes(SessionController, PhotoController);
  }
}
