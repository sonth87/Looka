import { CardTemplateModule } from '@app/modules/card-template/card-template.module';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { IdentityModule } from '@app/modules/identity/identity.module';
import { StatsModule } from '@app/modules/stats/stats.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintAgentController } from './controllers/print-agent.controller';
import { PrintBatchController } from './controllers/print-batch.controller';
import { PrintItemController } from './controllers/print-item.controller';
import { PrinterAgentController } from './controllers/printer-agent.controller';
import { PrinterController } from './controllers/printer.controller';
import { PrintBatch } from './entities/print-batch.entity';
import { PrintItem } from './entities/print-item.entity';
import { PrintItemEvent } from './entities/print-item-event.entity';
import { Printer } from './entities/printer.entity';
import { PrinterStockEvent } from './entities/printer-stock-event.entity';
import { PrinterAgentGuard } from './guards/printer-agent.guard';
import { PrintBatchService } from './services/print-batch.service';
import { PrintItemService } from './services/print-item.service';
import { PrintPackageService } from './services/print-package.service';
import { PrinterService } from './services/printer.service';

/**
 * P6 — cms-8-screens-api-plan.md §2.5/§2.7, the last backend phase of the
 * 8-screen plan. Plain leaf-module style (`entities/`, `dto/`, `dao/`,
 * `services/`, `controllers/`) — same reasoning every prior plain module's
 * own doc comment gives: print/printer state machines are each a handful
 * of `if`s, not an invariant complex enough to warrant the DDD-lite layout
 * `identity`/`workflow` use.
 *
 * Covers BOTH §2.5 ("đợt in thẻ") and §2.7 ("quản lý máy in") in one
 * module — they are tightly coupled in practice (`print_items.printer_id`,
 * the PRINT-transition stock decrement is one transaction spanning both
 * tables) and the task brief explicitly leaves "module(s)" open; splitting
 * them would only buy two more `IdentityModule`/`CardTemplateModule`
 * import blocks for no real isolation benefit, since neither ever needs to
 * be deployed independently of the other.
 *
 * `IdentityModule` is imported for `PermissionsGuard`'s own DI graph — the
 * same per-consuming-module resolution gotcha every prior phase's module
 * doc comment documents (P1/P4/P5). `CardTemplateModule` is a REAL
 * dependency (not just raw SQL) so `PrintItemService.render`/`preview` can
 * inject `CardTemplateService`/`CardTemplateRenderService` and reuse the
 * actual render engine — see that module's own updated doc comment.
 * `StatsModule` is imported for `PrintStatsService` (lives in `modules/stats`,
 * see that service's own doc comment for why).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrintBatch,
      PrintItem,
      PrintItemEvent,
      Printer,
      PrinterStockEvent,
    ]),
    IdentityModule,
    CardTemplateModule,
    FileStorageModule,
    StatsModule,
  ],
  controllers: [
    PrintItemController,
    PrintBatchController,
    PrintAgentController,
    PrinterController,
    PrinterAgentController,
  ],
  providers: [
    PrintItemService,
    PrintBatchService,
    PrinterService,
    PrintPackageService,
    PrinterAgentGuard,
  ],
})
export class PrintModule {}
