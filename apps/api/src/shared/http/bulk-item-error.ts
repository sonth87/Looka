import { HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { describeHttpException } from '../errors/describe-http-exception';

/**
 * The per-item error shape a 1-n (bulk) endpoint reports for one failed
 * element of the request, instead of failing the whole call.
 */
export interface BulkItemError {
  statusCode: number;
  errorCode?: number | string;
  message: string;
  /**
   * `true` for a 4xx-class, caller-attributable failure; `false` for
   * anything 5xx-class or unknown. Callers `logger.error` the ORIGINAL error
   * when this is `false` — the message returned here is deliberately generic
   * for those, so the real detail must reach the server log another way.
   */
  expected: boolean;
}

const GENERIC_MESSAGE = 'Lỗi hệ thống, vui lòng thử lại';

/** Driver error shape `pg` attaches to TypeORM's `QueryFailedError`. */
interface PgDriverError {
  readonly code?: unknown;
}

/**
 * Maps a deterministic Postgres failure to the same 4xx the single-item route
 * would answer with, so the kiosk does not retry (and re-upload up to 12 MB
 * of image bytes) something that can never succeed. Mirrors what
 * `AllExceptionsFilter` + `ConstraintErrorTranslator` do for a constraint
 * nobody registered — minus echoing the raw Postgres text, which the bulk
 * path never does. Returns `null` for anything else, i.e. transient or
 * unknown SQLSTATEs (`40001` serialization failure, `40P01` deadlock, `08xxx`
 * connection exceptions, `53xxx` resources, `55P03` lock timeout, ...), which
 * stay a retryable 500.
 *
 * Deliberately NOT routed through the injectable `ConstraintErrorTranslator`:
 * the bulk callers do not have it injected, and a constraint that a module
 * registered a typed exception for still answers with the module-specific
 * error on the single route — a batch item gets the SQLSTATE default instead.
 */
function describePgError(code: unknown): BulkItemError | null {
  if (typeof code !== 'string') return null;

  switch (code) {
    case '23505': // unique_violation
      return {
        statusCode: HttpStatus.CONFLICT,
        errorCode: 'UNREGISTERED_CONFLICT',
        message: 'Dữ liệu đã tồn tại.',
        expected: true,
      };
    case '23503': // foreign_key_violation
      return {
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: 'UNREGISTERED_FK_VIOLATION',
        message: 'Tham chiếu tới dữ liệu không tồn tại.',
        expected: true,
      };
    case '23502': // not_null_violation
    case '23514': // check_violation
      // A validator should have caught these first — a programming error, so
      // (like the single route) a loud 500 the caller must log.
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: 'INTEGRITY_VIOLATION',
        message: GENERIC_MESSAGE,
        expected: false,
      };
    default:
      // 22xxx data exception (value too long, numeric out of range, invalid
      // text representation, ...) and every other 23xxx integrity violation:
      // the same input fails the same way every time.
      if (code.startsWith('22') || code.startsWith('23')) {
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          errorCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: 'Dữ liệu không hợp lệ (sai định dạng hoặc vượt giới hạn).',
          expected: true,
        };
      }
      return null;
  }
}

/**
 * Translates whatever a per-item unit of work threw into the shape a bulk
 * response reports. The HTTP-shaped exceptions (`ApplicationException`,
 * `CustomException`, any other `HttpException`) go through
 * `describeHttpException` — the very function `AllExceptionsFilter` uses — so
 * a batched item fails exactly as the same item would alone. A 5xx-class
 * result keeps its status and code but its TEXT is replaced by a generic
 * message: the thrown text can carry upstream detail (an internal file-service
 * or sidecar host), and the callers log the original error themselves.
 *
 * Postgres errors are classified by SQLSTATE (see `describePgError`):
 * deterministic data/integrity failures become the same permanent 4xx the
 * single route returns, transient ones a retryable 500. The kiosk uploader
 * treats 4xx as permanent (the photo is dropped) but retries 5xx, so a
 * transient DB failure (deadlock, dropped connection) must stay a 500 here.
 * Raw infra error text is never echoed to the caller.
 */
export function describeBulkItemError(err: unknown): BulkItemError {
  const described = describeHttpException(err);
  if (described) {
    const expected = described.statusCode < 500;
    return {
      statusCode: described.statusCode,
      errorCode: described.errorCode,
      message: expected ? described.message : GENERIC_MESSAGE,
      expected,
    };
  }

  if (err instanceof QueryFailedError) {
    const driverError = err.driverError as PgDriverError | undefined;
    const pg = describePgError(driverError?.code);
    if (pg) return pg;
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: GENERIC_MESSAGE,
    expected: false,
  };
}

/** The failure half of one bulk result row — `describeBulkItemError`'s output minus the log-only `expected`. */
export interface BulkItemFailure {
  ok: false;
  statusCode: number;
  errorCode?: number | string;
  message: string;
}

/** What `runBulk` returns — feed it straight to `toDao` with a `requested/succeeded/failed/results` DAO. */
export interface BulkRunResult<R> {
  requested: number;
  succeeded: number;
  failed: number;
  results: R[];
}

/**
 * The shared skeleton of every 1-n endpoint: run each item strictly one after
 * another (never in parallel — bulk callers write shared rows, and concurrent
 * items would just contend for them), never let one item's failure stop the
 * rest, and report each item's own outcome.
 *
 *  - `run` does one item's real work and resolves to the fields of its
 *    SUCCESS row (its id, plus anything else the DAO exposes); `ok: true` is
 *    added here.
 *  - `keyOf` gives the identifying fields of the item's FAILURE row (the same
 *    id `run` would have reported), since a throw leaves nothing else to key it by.
 *  - `logLabel` names the item in the server log line written when a failure
 *    is NOT caller-attributable (5xx / unknown — the response text is generic
 *    for those, so the ORIGINAL error must be logged here).
 */
export async function runBulk<T, R extends object, K extends object>(
  items: readonly T[],
  options: {
    run: (item: T) => Promise<R>;
    keyOf: (item: T) => K;
    logLabel: (item: T) => string;
    logger: Pick<Logger, 'error'>;
  },
): Promise<BulkRunResult<(R & { ok: true }) | (K & BulkItemFailure)>> {
  const results: Array<(R & { ok: true }) | (K & BulkItemFailure)> = [];

  for (const item of items) {
    try {
      const ok = await options.run(item);
      results.push({ ...ok, ok: true });
    } catch (err) {
      const d = describeBulkItemError(err);
      if (!d.expected) {
        options.logger.error(
          `${options.logLabel(item)} failed: ${
            err instanceof Error ? (err.stack ?? err.message) : String(err)
          }`,
        );
      }
      results.push({
        ...options.keyOf(item),
        ok: false,
        statusCode: d.statusCode,
        errorCode: d.errorCode,
        message: d.message,
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return {
    requested: items.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}
