import { Logger } from '@nestjs/common';
import { CommandBus, ICommand } from '@nestjs/cqrs';
import { AdvisoryLockService } from '../database/advisory-lock.service';

/**
 * Base class for a `@Cron()`-decorated worker under a module's
 * `infrastructure/workers/`. Five-step shape from spec §8.1, mapped to
 * TypeScript:
 *
 *   ① single-flight — `tick()` no-ops if the previous tick is still
 *      running, so a slow tick never overlaps itself in-process.
 *   ② leadership — `AdvisoryLockService.withLock(name, …)`: every replica
 *      of this worker tries the same named Postgres advisory lock, exactly
 *      one wins per tick, nobody waits (spec §8.3). `CommandApi`/`QueryApi`
 *      never call this — only a worker host does.
 *   ③ the actual work goes through `CommandBus`, same as an HTTP write —
 *      a worker is just another kind of host, not a place for business
 *      logic (plan §16 ban list is written against exactly this).
 *   ④ interval — the `@Cron(...)` decorator on the concrete subclass.
 *   ⑤ a failed tick is logged and swallowed, never rethrown — one bad
 *      tick must not kill the whole scheduled loop.
 *
 * @example
 * @Injectable()
 * export class DrainUploadOutboxWorker extends LeaderCronWorker {
 *   constructor(lock: AdvisoryLockService, bus: CommandBus) {
 *     super(lock, bus, 'upload_outbox_drain');
 *   }
 *   @Cron('*\/3 * * * * *')
 *   async run(): Promise<void> {
 *     await this.tick();
 *   }
 *   protected command() { return new DrainUploadOutboxCommand(); }
 * }
 */
export abstract class LeaderCronWorker {
  private readonly logger = new Logger(this.constructor.name);
  private running = false;

  protected constructor(
    private readonly lock: AdvisoryLockService,
    private readonly bus: CommandBus,
    private readonly lockName: string,
  ) {}

  protected async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.lock.withLock(this.lockName, () =>
        this.bus.execute(this.command()),
      );
    } catch (err) {
      this.logger.error(
        `Tick failed for "${this.lockName}": ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  /** Returns the command this tick should execute once it holds the lock. */
  protected abstract command(): ICommand;
}
