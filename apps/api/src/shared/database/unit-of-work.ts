import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DomainEventDispatcher } from '../cqrs/domain-event.dispatcher';
import { ConstraintErrorTranslator } from './constraint-error.translator';
import { TransactionContext } from './transaction-context';

/**
 * "Repository bị CẤM gọi SaveChanges" (spec §9.1) — this is the one place
 * allowed to open, commit, or roll back a transaction. `TransactionalCommandHandler`
 * (shared/cqrs) wraps every command handler's `handle()` in exactly this,
 * so a command handler never calls this directly either.
 *
 * Sequence per call, matching spec §4 steps ④⑤:
 *   BEGIN → run fn (repositories read `TransactionContext.manager()`) →
 *   dispatch every domain event raised during fn, awaited, still inside the
 *   transaction → COMMIT. On any error: ROLLBACK, translate the Postgres
 * error into a typed exception (constraint name → ApplicationException),
 * then rethrow.
 */
@Injectable()
export class UnitOfWork {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TransactionContext,
    private readonly dispatcher: DomainEventDispatcher,
    private readonly translator: ConstraintErrorTranslator,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { result, events } = await this.context.run(
        queryRunner.manager,
        fn,
      );
      // Dispatch BEFORE commit (spec §4 step ⑤ / plan §9.3) so outbox/audit/
      // stats side effects land in the SAME transaction as the state change.
      await this.dispatcher.dispatch(events);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
      throw this.translator.translate(err);
    } finally {
      await queryRunner.release();
    }
  }
}
