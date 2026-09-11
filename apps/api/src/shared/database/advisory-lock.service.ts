import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Postgres advisory-lock leadership (spec §8.3): every replica of a worker
 * tries the same named lock; exactly one wins per tick, nobody waits, no
 * extra infra (no Redis lock, no platform leader-election). `CommandApi`
 * and `QueryApi` have no background processes, so they never call this —
 * only `LeaderCronWorker` (shared/workers) does.
 */
@Injectable()
export class AdvisoryLockService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Session-level lock: acquire → run `fn` → always unlock, even on error.
   * Use for a worker tick that does NOT need to run inside a Postgres
   * transaction of its own (it typically calls a command that opens its
   * own `UnitOfWork` transaction internally).
   */
  async withLock(name: string, fn: () => Promise<void>): Promise<boolean> {
    const key = AdvisoryLockService.lockKey(name);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [key],
      )) as Array<{
        locked: boolean;
      }>;
      if (!rows[0]?.locked) return false;
      try {
        await fn();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [key]);
      }
      return true;
    } finally {
      await runner.release();
    }
  }

  /**
   * Transaction-scoped lock: held until `manager`'s current transaction
   * ends (commit or rollback) — no explicit unlock call, Postgres releases
   * it automatically. Use this from inside code that is already running in
   * a transaction and wants the lock to cover exactly that transaction.
   */
  async withTransactionLock<T>(
    manager: EntityManager,
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const key = AdvisoryLockService.lockKey(name);
    const raw: unknown = await manager.query(
      'SELECT pg_try_advisory_xact_lock($1) AS locked',
      [key],
    );
    const rows = raw as Array<{ locked: boolean }>;
    if (!rows[0]?.locked) return undefined;
    return fn();
  }

  /**
   * Postgres advisory locks key on a signed 32/64-bit int, not a string.
   * Folds `name` into a stable 32-bit hash — a handful of named jobs
   * (spec §8.2's six workers, this system's background_jobs kinds) makes
   * collision risk irrelevant in practice.
   */
  private static lockKey(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return hash;
  }
}
