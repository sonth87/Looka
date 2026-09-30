import { HttpException } from '@nestjs/common';
import { ApplicationException } from './application.exception';
import { CustomException } from './custom.exception';

/** The status / code / text an HTTP-shaped exception maps to. */
export interface HttpExceptionDescription {
  statusCode: number;
  errorCode: string | number;
  message: string;
}

/**
 * The ONE place that turns an HTTP-shaped exception into a
 * `{ statusCode, errorCode, message }` triple. Shared by
 * `AllExceptionsFilter.resolve` (the single-request error envelope) and
 * `describeBulkItemError` (the per-item error of a 1-n endpoint) so a photo
 * rejected inside a batch reports exactly what the same photo sent alone
 * would.
 *
 * Checked in this order, because `CustomException` is itself an
 * `HttpException` and its real text lives on `.payload.error`, NOT on
 * `.message` (Nest's `HttpException` reads `.message` from a `{ message }`
 * response key, but `CustomException` passes `{ error }` — see the quirk
 * documented at the top of `photo-review.service.ts`):
 *
 *   1. `ApplicationException` (typed hierarchy) -> its own httpStatus
 *   2. `CustomException` (legacy)
 *   3. any other `HttpException` (ValidationPipe's `BadRequestException`, ...)
 *
 * Returns `null` for anything else (TypeORM errors, unknown throws) — the
 * caller decides how those are surfaced.
 */
export function describeHttpException(
  exception: unknown,
): HttpExceptionDescription | null {
  if (exception instanceof ApplicationException) {
    return {
      statusCode: exception.httpStatus,
      errorCode: exception.errorCode,
      message: exception.message,
    };
  }

  if (exception instanceof CustomException) {
    const statusCode = exception.getStatus();
    return {
      statusCode,
      errorCode: exception.payload.code ?? statusCode,
      message: exception.payload.error ?? exception.message,
    };
  }

  if (exception instanceof HttpException) {
    const res = exception.getResponse();
    const rawMessage: unknown =
      typeof res === 'string'
        ? res
        : ((res as { message?: unknown } | null)?.message ?? exception.message);
    const message = Array.isArray(rawMessage)
      ? (rawMessage as unknown[])
          .map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
          .join('; ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : JSON.stringify(rawMessage);
    const statusCode = exception.getStatus();
    return { statusCode, errorCode: statusCode, message };
  }

  return null;
}
