import * as configs from '@app/shared/config';
import { TypeOrmConfigService } from '@app/shared/database/database.service';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { SharedModule } from '@app/modules/shared/shared.module';
import { DeviceManagementModule } from '@app/modules/device-management/device-management.module';
import { PhotoReviewModule } from '@app/modules/photo-review/photo-review.module';
import { FoundationModule } from '@app/shared/foundation.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * `SERVICE_TYPE=worker` — the ONLY host with `ScheduleModule.forRoot()`
 * (so it is the only process where `@Cron()` metadata gets picked up by a
 * `ScheduleExplorer` and actually runs — see app-query.module.ts's doc
 * comment for why omitting that import elsewhere is sufficient to stop
 * cron there without needing per-module splitting yet). Lowest-uptime
 * requirement of the three hosts (spec §2.1 bản Looka §4.1): a 30s gap in
 * outbox draining delays uploads, it does not lose them.
 *
 * Still imports the full feature modules (no HTTP-only/worker-only module
 * split exists yet — plan §6 phases 2/4), so this process is also, today,
 * HTTP-capable. A real "workers only, no open HTTP port" deployment is a
 * later-phase deliverable once each module has its own `-worker.module.ts`
 * that imports only its worker + the command handlers a worker's commands
 * need, per docs/plans/backend-layering-plan.md §3.
 */
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
})
export class AppWorkerModule {}
