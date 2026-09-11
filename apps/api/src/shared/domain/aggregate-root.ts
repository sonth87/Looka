import { DomainEvent } from './domain-event';

/**
 * Base class for every aggregate under a module's `domain/aggregate/` folder.
 *
 * Ban list (plan §8, items 2-3): an aggregate never imports `typeorm`,
 * `@nestjs/*`, `shared/database`, or `shared/integrations`. It receives
 * primitives and value objects, changes its own fields, calls `raise()`
 * for anything another part of the system needs to react to, and returns
 * a `Result` — it never calls out, never persists itself, never throws
 * for a predictable business outcome.
 */
export abstract class AggregateRoot<TId> {
  private readonly _id: TId;
  private _domainEvents: DomainEvent[] = [];

  protected constructor(id: TId) {
    this._id = id;
  }

  get id(): TId {
    return this._id;
  }

  get domainEvents(): ReadonlyArray<DomainEvent> {
    return [...this._domainEvents];
  }

  /** Called from inside a state-changing method — never from a handler. */
  protected raise(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /** Called by UnitOfWork after it has dispatched every raised event. */
  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  equals(other?: AggregateRoot<TId>): boolean {
    if (!other) return false;
    return this._id === other._id;
  }
}
