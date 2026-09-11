import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CorrelationContext } from '../cqrs/correlation.context';

/**
 * Spec §4 step ① — outermost interceptor, so everything inside (including
 * a validation failure at step ②) carries a correlation id. Reuses an
 * inbound `x-correlation-id` header when the caller (or an upstream proxy)
 * already set one, otherwise mints a UUID. Stashes it on the request object
 * (for `AllExceptionsFilter` / `ResponseTransformInterceptor`, which run
 * outside this class's own `CorrelationContext.run()` closure in the error
 * path) and also opens the AsyncLocalStorage context so any code called
 * deeper in the stack can read it without the request object at all.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { correlationId?: string }>();
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      randomUUID();
    request.correlationId = correlationId;

    const start = Date.now();
    return CorrelationContext.run(correlationId, () =>
      next.handle().pipe(
        tap({
          next: () =>
            this.logger.log(
              `[${correlationId}] ${request.method} ${request.originalUrl} ${Date.now() - start}ms`,
            ),
          error: (err: unknown) =>
            this.logger.warn(
              `[${correlationId}] ${request.method} ${request.originalUrl} ${Date.now() - start}ms ` +
                (err instanceof Error ? err.message : String(err)),
            ),
        }),
      ),
    );
  }
}
