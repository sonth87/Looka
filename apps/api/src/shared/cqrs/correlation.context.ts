import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationState {
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationState>();

/**
 * Request-scoped correlation id, set by `LoggingInterceptor` at the host
 * boundary (spec §4 step ①: "outermost, so everything inside — including a
 * validation failure — has a trace"). Anything downstream (handlers,
 * `UnitOfWork`, adapters) can read it without it being threaded through
 * every function signature.
 */
export class CorrelationContext {
  static run<T>(correlationId: string, fn: () => T): T {
    return storage.run({ correlationId }, fn);
  }

  static current(): string | undefined {
    return storage.getStore()?.correlationId;
  }
}
