import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError, TypeORMError } from 'typeorm';
import { ConstraintErrorTranslator } from '../database/constraint-error.translator';
import { CorrelationContext } from '../cqrs/correlation.context';
import { ApplicationException } from './application.exception';
import { CustomException } from './custom.exception';

interface ErrorEnvelope {
  statusCode: number;
  errorCode: string | number;
  message: string;
  correlationId?: string;
}

/**
 * The ONE global exception filter (plan §2 gap #4, §4.8). It replaces the
 * two overlapping filters this codebase had before — `HttpExceptionFilter`
 * (bare `@Catch()`, mapped `QueryFailedError` to 422) and
 * `TypeOrmExceptionFilter` (`@Catch(TypeORMError)`, hardcoded 500) — which
 * gave inconsistent status codes for the same underlying Postgres error
 * depending on registration order. Every exception now goes through
 * exactly one `resolve()` switch, in this priority:
 *
 *   1. `ApplicationException` (new typed hierarchy) → its own httpStatus
 *   2. `CustomException` (legacy, kept for modules not yet migrated)
 *   3. Postgres error → `ConstraintErrorTranslator` (constraint name →
 *      typed exception when registered; SQLSTATE-based default otherwise —
 *      unregistered unique violations keep the previous 422 behaviour so
 *      not-yet-migrated code sees no change until it registers its
 *      constraints)
 *   4. Any other `HttpException` (ValidationPipe's `BadRequestException`, …)
 *   5. Unknown → 500, generic message, full detail only in the server log
 *
 * Response body stays additively compatible with the old `{errorCode,
 * message}` shape (`HttpResponseError`) — `statusCode` and `correlationId`
 * are new fields, nothing existing was renamed or removed.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly constraintTranslator: ConstraintErrorTranslator,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const correlationId =
      request?.correlationId ?? CorrelationContext.current();

    const envelope = this.resolve(exception);
    envelope.correlationId = correlationId;

    // Plain 500 rather than HttpStatus.INTERNAL_SERVER_ERROR here on purpose:
    // comparing a `number` field to an enum member trips
    // @typescript-eslint/no-unsafe-enum-comparison, and casting the enum
    // side just flips into no-unnecessary-type-assertion instead — the two
    // rules disagree with each other on this exact shape.
    if (envelope.statusCode >= 500) {
      this.logger.error(
        `[${correlationId ?? '-'}] ${envelope.errorCode} ${envelope.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(envelope.statusCode).json(envelope);
  }

  private resolve(exception: unknown): ErrorEnvelope {
    if (exception instanceof ApplicationException) {
      return {
        statusCode: exception.httpStatus,
        errorCode: exception.errorCode,
        message: exception.message,
      };
    }

    if (exception instanceof CustomException) {
      return {
        statusCode: exception.getStatus(),
        errorCode: exception.payload.code ?? exception.getStatus(),
        message: exception.payload.error ?? exception.message,
      };
    }

    if (
      exception instanceof QueryFailedError ||
      exception instanceof TypeORMError
    ) {
      const translated = this.constraintTranslator.translate(exception);
      if (translated instanceof ApplicationException) {
        return {
          statusCode: translated.httpStatus,
          errorCode: translated.errorCode,
          message: translated.message,
        };
      }
      // Untranslatable TypeORM error — 422, same status the old
      // HttpExceptionFilter used for this case (no behaviour change for
      // code that has not yet registered its constraints).
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        errorCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: translated.message,
      };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const rawMessage: unknown =
        typeof res === 'string'
          ? res
          : ((res as { message?: unknown })?.message ?? exception.message);
      const message = Array.isArray(rawMessage)
        ? (rawMessage as unknown[])
            .map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
            .join('; ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : JSON.stringify(rawMessage);
      return {
        statusCode: exception.getStatus(),
        errorCode: exception.getStatus(),
        message,
      };
    }

    // Unknown — never leak internals to the client (plan §4.4 last row).
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        exception instanceof Error
          ? exception.message
          : 'Internal server error',
    };
  }
}
