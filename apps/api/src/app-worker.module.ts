import * as configs from '@app/shared/config';
import { TypeOrmConfigService } from '@app/shared/database/database.service';
import { CaptureModule } from '@app/modules/capture/capture.module';
import { SharedModule } from '@app/modules/shared/shared.module';
import { DeviceManagementModule } from '@app/modules/device-management/device-management.module';
import { PhotoReviewModule } from '@app/modules/photo-review/photo-review.module';
import { IdentityModule } from '@app/modules/identity/identity.module';
import { WorkflowModule } from '@app/modules/workflow/workflow.module';
import { StatsModule } from '@app/modules/stats/stats.module';
import { CardTemplateModule } from '@app/modules/card-template/card-template.module';
import { PrintModule } from '@app/modules/print/print.module';
import { FoundationModule } from '@app/shared/foundation.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';

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
 *
 * Also the only host `PhotoReviewModule` actually instantiates
 * `AiEditProcessor` on (2026-09-29, BullMQ `ai-edit` queue) — same
 * `SERVICE_TYPE` check `AiEditProcessor`'s own module registration uses, for
 * the same reason as `ScheduleModule` above: `command`/`query` can still
 * ENQUEUE (`BullModule.forRootAsync` is registered on every host, right
 * below), they must not also CONSUME.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: Object.values(configs),
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    // The `ai-edit` queue's Redis connection (2026-09-29 — `AiEditProcessor`
    // in `PhotoReviewModule`). Duplicated identically across all four
    // `app-*.module.ts` files, same convention `ConfigModule.forRoot()`
    // already uses here — each is a separate bootstrap, not one shared
    // process.
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        },
      }),
      inject: [ConfigService],
    }),
    FoundationModule,
    SharedModule,
    CaptureModule,
    DeviceManagementModule,
    PhotoReviewModule,
    IdentityModule,
    WorkflowModule,
    StatsModule,
    CardTemplateModule,
    PrintModule,
  ],
  controllers: [AppController],
})
export class AppWorkerModule {}
