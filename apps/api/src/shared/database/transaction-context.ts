import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DomainEvent } from '../domain/domain-event';

interface TransactionState {
  readonly manager: EntityManager;
  readonly pendingEvents: DomainEvent[];
}

export interface RunResult<T> {
  readonly result: T;
  readonly events: readonly DomainEvent[];
}

const storage = new AsyncLocalStorage<TransactionState>();

/**
 * Carries the current `EntityManager` and the domain events raised so far,
 * for the lifetime of one `UnitOfWork.run()` call — repositories read it
 * instead of a manager being threaded through every method signature
 * (plan §4.4). Nothing outside `UnitOfWork` writes to this; it is the one
 * seam between "inside a transaction" and "outside one" that the ban list
 * (plan §8 #6, #7) is written against.
 */
@Injectable()
export class TransactionContext {
  /**
   * Called by `UnitOfWork` only. Runs `fn` with `manager` bound to this
   * async context, then returns both `fn`'s result and every domain event
   * registered during the call — draining happens here, inside the
   * context, so callers never have to worry about calling it too late.
   */
  async run<T>(
    manager: EntityManager,
    fn: () => Promise<T>,
  ): Promise<RunResult<T>> {
    const state: TransactionState = { manager, pendingEvents: [] };
    const result = await storage.run(state, fn);
    return { result, events: state.pendingEvents };
  }

  /** Repository read/write methods call this for the manager bound to the current transaction. */
  manager(): EntityManager {
    const state = storage.getStore();
    if (!state) {
      throw new Error(
        'TransactionContext.manager() called outside UnitOfWork.run() — ' +
          'a repository must only be used from inside a command/query handler (plan §4.4, ban #6).',
      );
    }
    return state.manager;
  }

  /** Repository.save() calls this with `aggregate.domainEvents` right after persisting. */
  registerEvents(events: readonly DomainEvent[]): void {
    const state = storage.getStore();
    if (!state) {
      throw new Error(
        'TransactionContext.registerEvents() called outside UnitOfWork.run() — ' +
          'every write must go through UnitOfWork (plan §4.2, ban #6).',
      );
    }
    state.pendingEvents.push(...events);
  }
}
