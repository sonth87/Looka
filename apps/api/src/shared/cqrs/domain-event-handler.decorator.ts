import 'reflect-metadata';
import { DomainEvent } from '../domain/domain-event';

export const DOMAIN_EVENT_HANDLER_METADATA = Symbol(
  'DOMAIN_EVENT_HANDLER_METADATA',
);

export interface IDomainEventHandler<TEvent extends DomainEvent = DomainEvent> {
  handle(event: TEvent): Promise<void>;
}

/**
 * Marks a provider as the handler for one domain event, keyed by that
 * event's `eventName` string (not the class — see the decorator's own
 * README note in domain-event.dispatcher.ts for why a string key). Handlers
 * run inside the same transaction as the aggregate change that raised the
 * event, BEFORE commit (plan §4.2/§4.3, spec §4 step ⑤) — throwing here
 * rolls the whole use case back, which is correct: an event handler that
 * can't record its side effect means the use case didn't really succeed.
 *
 * @example
 * @Injectable()
 * @OnDomainEvent('SessionCompleted')
 * export class EnqueueUploadOnSessionCompleted implements IDomainEventHandler<SessionCompletedEvent> {
 *   async handle(event: SessionCompletedEvent): Promise<void> { ... }
 * }
 */
export function OnDomainEvent(eventName: string): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, eventName, target);
  };
}
