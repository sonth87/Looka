import { UnitOfWork } from '../database/unit-of-work';

/**
 * Base class every command handler under `application/commands/handler/`
 * extends. `execute()` is `CommandBus`'s entry point; it is intentionally
 * NOT overridable — `handle()` is, and it always runs inside
 * `UnitOfWork.run()` (spec §4 steps ④⑤, plan §4.2). This is where "one use
 * case, one transaction" is enforced structurally rather than by
 * convention: a handler cannot open its own transaction because it never
 * sees the `DataSource`.
 *
 * Deliberately does NOT `implements ICommandHandler<TCommand, TResult>`:
 * that type from `@nestjs/cqrs` is a conditional type keyed on a concrete
 * command class, and TypeScript cannot resolve it for an open generic
 * parameter here — subclasses should add that `implements` clause
 * themselves with their concrete command/result types (matching every
 * handler in dynaform-service); this base class only needs to be
 * structurally compatible, which a plain `execute(command): Promise<TResult>`
 * method already is.
 */
export abstract class TransactionalCommandHandler<TCommand, TResult> {
  protected constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(command: TCommand): Promise<TResult> {
    return this.unitOfWork.run(() => this.handle(command));
  }

  protected abstract handle(command: TCommand): Promise<TResult>;
}
