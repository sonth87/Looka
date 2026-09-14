import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { DomainEventDispatcher } from './cqrs/domain-event.dispatcher';
import { ConstraintErrorTranslator } from './database/constraint-error.translator';
import { AdvisoryLockService } from './database/advisory-lock.service';
import { TransactionContext } from './database/transaction-context';
import { UnitOfWork } from './database/unit-of-work';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';
import { ErrorCodeRegistry } from './errors/error-code.registry';
import { LoggingInterceptor } from './http/logging.interceptor';

/**
 * The shared-kernel providers from docs/plans/backend-layering-plan.md §3
 * (`shared/domain`, `shared/cqrs`, `shared/database`, `shared/errors`
 * primitives) in one `@Global()` module, imported once by each root module
 * (app.module.ts / app-command.module.ts / app-query.module.ts /
 * app-worker.module.ts). `@Global()` because every feature module's
 * handlers need `UnitOfWork`, and repeating this import per module would
 * just be noise — it holds no business logic, only the plumbing every
 * layer's ban list (plan §8) is written against.
 *
 * `AllExceptionsFilter` is provided here (not just exported) so `main.ts`
 * can resolve it via `app.get(AllExceptionsFilter)` — it needs the same
 * `ConstraintErrorTranslator` singleton that feature modules register their
 * constraints into, so it cannot be `new`'d standalone.
 *
 * `CqrsModule.forRoot()` (added when `modules/identity` became this app's
 * first real `@nestjs/cqrs` consumer): imported here, once, rather than in
 * every future `<module>.module.ts` — a plain `CqrsModule` import (no
 * `forRoot()`) creates its own non-global `CommandBus`/`QueryBus`, isolated
 * per importing module, which would give every feature module its OWN bus
 * instead of one shared one. `forRoot()`'s `global: true` makes this
 * import's `CommandBus`/`QueryBus`/`EventBus` singletons for the whole
 * process, matching every other provider in this module. Each of the four
 * root modules (`app.module.ts`/`app-command`/`app-query`/`app-worker`) is
 * its own separate Nest application (own OS process when `SERVICE_TYPE` is
 * set), so this still means four independent bus instances overall — one
 * per process, which is correct; nothing here shares state across
 * processes.
 */
@Global()
@Module({
  imports: [DiscoveryModule, CqrsModule.forRoot()],
  providers: [
    TransactionContext,
    UnitOfWork,
    AdvisoryLockService,
    ConstraintErrorTranslator,
    ErrorCodeRegistry,
    DomainEventDispatcher,
    AllExceptionsFilter,
    LoggingInterceptor,
  ],
  exports: [
    TransactionContext,
    UnitOfWork,
    AdvisoryLockService,
    ConstraintErrorTranslator,
    ErrorCodeRegistry,
    DomainEventDispatcher,
    AllExceptionsFilter,
    LoggingInterceptor,
    CqrsModule,
  ],
})
export class FoundationModule {}
