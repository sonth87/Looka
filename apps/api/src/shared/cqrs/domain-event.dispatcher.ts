import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { DomainEvent } from '../domain/domain-event';
import {
  DOMAIN_EVENT_HANDLER_METADATA,
  IDomainEventHandler,
} from './domain-event-handler.decorator';

/**
 * Collects every `@OnDomainEvent(...)` provider at startup and, on
 * `dispatch()`, awaits each matching handler in registration order —
 * synchronously, so `UnitOfWork.run()` can call this BEFORE commit (plan
 * §4.2, spec §4 step ⑤). This is deliberately not `@nestjs/cqrs`'s
 * `EventBus`: that bus is fire-and-forget (`publish()` returns void), which
 * cannot be awaited before a commit — see plan §1's translation table.
 */
@Injectable()
export class DomainEventDispatcher implements OnModuleInit {
  private readonly logger = new Logger(DomainEventDispatcher.name);
  private readonly handlersByEventName = new Map<
    string,
    IDomainEventHandler[]
  >();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance as object | undefined;
      if (!instance || typeof instance !== 'object') continue;

      const eventName = Reflect.getMetadata(
        DOMAIN_EVENT_HANDLER_METADATA,
        instance.constructor,
      ) as string | undefined;
      if (!eventName) continue;

      const handler = instance as unknown as IDomainEventHandler;
      if (typeof handler.handle !== 'function') {
        throw new Error(
          `${instance.constructor.name} is decorated @OnDomainEvent("${eventName}") but has no handle() method.`,
        );
      }

      const list = this.handlersByEventName.get(eventName) ?? [];
      list.push(handler);
      this.handlersByEventName.set(eventName, list);
      this.logger.log(
        `Registered ${instance.constructor.name} for domain event "${eventName}"`,
      );
    }
  }

  async dispatch(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = this.handlersByEventName.get(event.eventName) ?? [];
      if (handlers.length === 0) {
        this.logger.debug(
          `No handler registered for domain event "${event.eventName}" — ignored.`,
        );
        continue;
      }
      for (const handler of handlers) {
        await handler.handle(event);
      }
    }
  }
}
