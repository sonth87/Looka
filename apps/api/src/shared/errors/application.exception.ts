/**
 * Typed exceptions for the application layer (plan §4.8 — "bốn bậc dịch").
 *
 * These are NOT `@nestjs/common` `HttpException`s — an application handler
 * (or an aggregate's `Result`, translated by the handler) throws one of
 * these, and `AllExceptionsFilter` is the ONE place that turns it into an
 * HTTP status + envelope. Nothing upstream of the filter should know or
 * care what a "409" is (plan §4.1 ban list, ban #1: no `if` about HTTP in
 * application/domain code).
 *
 * `errorCode` is a short SCREAMING_SNAKE_CASE string, module-scoped —
 * register a module's codes with `ErrorCodeRegistry` (error-code.registry.ts)
 * instead of adding to the old flat `ERROR_CODE` table in `legacy.ts`.
 */
export abstract class ApplicationException extends Error {
  abstract readonly httpStatus: number;

  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Request shape was fine but the value fails an application-level rule. */
export class ValidationException extends ApplicationException {
  readonly httpStatus = 400;
}

/** A domain `Result.fail` reached the handler and needs a caller-facing shape. */
export class BusinessRuleException extends ApplicationException {
  readonly httpStatus = 400;
}

/** Duplicate / already-exists — typically a translated unique-constraint hit. */
export class ConflictException extends ApplicationException {
  readonly httpStatus = 409;
}

/** Referenced aggregate/row does not exist. */
export class NotFoundException extends ApplicationException {
  readonly httpStatus = 404;
}

/**
 * A `ck_*` / not-null / other data-shape constraint fired in Postgres.
 * Plan §4.4 constraint table, last row: this must never happen — a
 * presentation-layer validator should have caught it first. Surfacing as
 * 500 (not 400) is deliberate: it is a programming error, not a bad
 * request, and should page someone rather than look like normal traffic.
 */
export class IntegrityViolationException extends ApplicationException {
  readonly httpStatus = 500;

  constructor(message: string, detail?: unknown) {
    super('INTEGRITY_VIOLATION', message, detail);
  }
}
