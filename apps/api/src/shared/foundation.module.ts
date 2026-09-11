import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
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
 */
@Global()
@Module({
  imports: [DiscoveryModule],
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
  ],
})
export class FoundationModule {}
