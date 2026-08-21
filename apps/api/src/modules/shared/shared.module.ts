import { Global, Module } from '@nestjs/common';

/**
 * Global module for cross-cutting providers shared across feature modules.
 * `CommonService<T>` itself is not registered here - it's an abstract base
 * class each feature module extends with its own repository, not a shared
 * provider.
 *
 * Empty for now; add providers/controllers here as they're built.
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class SharedModule {}
