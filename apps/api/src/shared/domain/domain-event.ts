/**
 * Base class for a domain event raised by an aggregate.
 *
 * Per docs/plans/backend-layering-plan.md §4.2/§4.3: an aggregate method
 * that changes state raises one of these from *inside itself* (never from
 * the handler), and `UnitOfWork.run()` dispatches every raised event —
 * synchronously, awaited — to its registered handler(s) BEFORE commit, so
 * side effects (outbox rows, audit rows, stats) land in the same
 * transaction as the state change. This is spec §4 step ⑤ and §9.3.
 *
 * Naming: camelCase per plan §7 Q17 (Looka convention, not dynaform's
 * snake_case-in-TS).
 */
export abstract class DomainEvent {
  readonly occurredOn: Date;
  readonly aggregateId: string;
  readonly correlationId: string;
  abstract readonly eventName: string;

  protected constructor(aggregateId: string, correlationId?: string) {
    this.occurredOn = new Date();
    this.aggregateId = aggregateId;
    this.correlationId = correlationId ?? crypto.randomUUID();
  }
}
