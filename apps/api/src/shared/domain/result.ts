/**
 * Return type for every aggregate method that changes state (plan §4.3).
 * The aggregate NEVER throws for a predictable business outcome — it
 * returns a Result and the application handler decides what to do,
 * including translating a failure into a typed ApplicationException
 * (plan §4.8). Reserve real `throw` for programmer errors only.
 *
 * Three states, not two: spec §5/§6 and plan §16 điều cấm 9 both insist
 * that "the state was already what we wanted" (e.g. an UPDATE matched
 * zero rows because someone else already applied it, or `complete()`
 * called twice) is NOT a failure — it must not be retried as an error,
 * and it must not silently look identical to a fresh success either. Hence
 * `noop`: callers can tell the three apart (`status`), while `isSuccess`
 * still reads true for both `ok` and `noop` so a caller that only cares
 * about "did this blow up" doesn't have to special-case it.
 */
export type ResultStatus = 'ok' | 'fail' | 'noop';

export class Result<T, E = string> {
  private constructor(
    public readonly status: ResultStatus,
    private readonly _value: T | undefined,
    private readonly _error: E | undefined,
  ) {}

  static ok<T, E = string>(value: T): Result<T, E> {
    return new Result<T, E>('ok', value, undefined);
  }

  static fail<T, E = string>(error: E): Result<T, E> {
    return new Result<T, E>('fail', undefined, error);
  }

  /** State transition was a no-op because it was already applied. */
  static noop<T, E = string>(value: T): Result<T, E> {
    return new Result<T, E>('noop', value, undefined);
  }

  get isSuccess(): boolean {
    return this.status === 'ok' || this.status === 'noop';
  }

  get isFailure(): boolean {
    return this.status === 'fail';
  }

  get isNoop(): boolean {
    return this.status === 'noop';
  }

  /** Throws if called on a failed Result — check `isFailure` first. */
  get value(): T {
    if (this.status === 'fail') {
      throw new Error(
        'Result.value read on a failed Result — check isFailure before reading value.',
      );
    }
    return this._value as T;
  }

  /** Throws if called on a non-failed Result — check `isFailure` first. */
  get error(): E {
    if (this.status !== 'fail') {
      throw new Error(
        'Result.error read on a non-failed Result — check isFailure before reading error.',
      );
    }
    return this._error as E;
  }
}
