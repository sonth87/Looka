import {
  ConflictException as NestConflictException,
  ForbiddenException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  ConflictException,
  IntegrityViolationException,
  NotFoundException,
} from '../errors/application.exception';
import { CustomException } from '../errors/custom.exception';
import { describeBulkItemError, runBulk } from './bulk-item-error';

describe('describeBulkItemError', () => {
  it('CustomException: reads the real text from payload.error (NOT the generic .message) and the numeric code', () => {
    const err = new CustomException('Set is locked', 4091, HttpStatus.CONFLICT);
    // The quirk this exists for: Nest reads .message off `{ error }` as the
    // generic class-name fallback, not the text passed to the constructor.
    expect(err.message).not.toBe('Set is locked');

    expect(describeBulkItemError(err)).toEqual({
      statusCode: 409,
      errorCode: 4091,
      message: 'Set is locked',
      expected: true,
    });
  });

  it('CustomException without an explicit numeric code falls back to its own status as the code', () => {
    const err = new CustomException(
      'bad input',
      HttpStatus.BAD_REQUEST,
      HttpStatus.BAD_REQUEST,
    );
    expect(describeBulkItemError(err)).toMatchObject({
      statusCode: 400,
      errorCode: 400,
      message: 'bad input',
      expected: true,
    });
  });

  it('a 5xx CustomException is not "expected" (caller must log it)', () => {
    const err = new CustomException(
      'db is on fire',
      500,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(describeBulkItemError(err)).toMatchObject({
      statusCode: 500,
      expected: false,
    });
  });

  it("a Nest HttpException (e.g. print's ConflictException) keeps its own status and message", () => {
    const d = describeBulkItemError(
      new NestConflictException('Item already in a batch'),
    );
    expect(d).toEqual({
      statusCode: 409,
      errorCode: 409,
      message: 'Item already in a batch',
      expected: true,
    });
  });

  it('a Nest HttpException whose response message is an array joins it', () => {
    const d = describeBulkItemError(
      new ForbiddenException({ message: ['a is wrong', 'b is wrong'] }),
    );
    expect(d).toMatchObject({
      statusCode: 403,
      message: 'a is wrong; b is wrong',
      expected: true,
    });
  });

  it('an ApplicationException subclass uses httpStatus/errorCode/message', () => {
    expect(
      describeBulkItemError(
        new NotFoundException('SET_MISSING', 'no such set'),
      ),
    ).toEqual({
      statusCode: 404,
      errorCode: 'SET_MISSING',
      message: 'no such set',
      expected: true,
    });
    expect(
      describeBulkItemError(new ConflictException('DUP', 'already exists')),
    ).toMatchObject({ statusCode: 409, errorCode: 'DUP', expected: true });
  });

  it('an ApplicationException that is a 500 is not "expected"', () => {
    expect(
      describeBulkItemError(new IntegrityViolationException('ck_x fired')),
    ).toMatchObject({
      statusCode: 500,
      errorCode: 'INTEGRITY_VIOLATION',
      expected: false,
    });
  });

  it('a TypeORM QueryFailedError becomes a generic 500 — retryable for the kiosk, and the raw SQL/driver text is never echoed', () => {
    const err = new QueryFailedError(
      'INSERT INTO photos (secret_column) VALUES ($1)',
      [],
      new Error('duplicate key value violates unique constraint "uq_secret"'),
    );

    const d = describeBulkItemError(err);

    expect(d.statusCode).toBe(500);
    expect(d.expected).toBe(false);
    expect(d.message).toBe('Lỗi hệ thống, vui lòng thử lại');
    expect(d.message).not.toMatch(/secret|INSERT|duplicate/i);
  });

  describe('Postgres errors are classified by SQLSTATE, like the single route (no raw text echoed)', () => {
    /** `pg` attaches `code` (SQLSTATE) to the driver error TypeORM wraps. */
    const pgError = (code: string, text = 'raw driver text 10.0.0.5') =>
      new QueryFailedError(
        'INSERT INTO photos (secret_column) VALUES ($1)',
        [],
        Object.assign(new Error(text), { code }),
      );

    it('22xxx data exception (value too long, out of range) is a permanent 422, not a retryable 500', () => {
      for (const code of ['22001', '22003', '22P02']) {
        const d = describeBulkItemError(pgError(code));
        expect(d).toMatchObject({ statusCode: 422, expected: true });
        expect(d.message).not.toMatch(/raw driver|secret|INSERT|10\.0\.0\.5/);
      }
    });

    it('23505 unique violation is a 409 and 23503 foreign-key violation a 404 (the translator defaults)', () => {
      expect(describeBulkItemError(pgError('23505'))).toMatchObject({
        statusCode: 409,
        errorCode: 'UNREGISTERED_CONFLICT',
        expected: true,
      });
      expect(describeBulkItemError(pgError('23503'))).toMatchObject({
        statusCode: 404,
        errorCode: 'UNREGISTERED_FK_VIOLATION',
        expected: true,
      });
    });

    it('any other 23xxx integrity violation is a permanent 422', () => {
      expect(describeBulkItemError(pgError('23P01'))).toMatchObject({
        statusCode: 422,
        expected: true,
      });
    });

    it('23502 not-null / 23514 check violation stay a loud, logged 500 (a validator should have caught them)', () => {
      for (const code of ['23502', '23514']) {
        expect(describeBulkItemError(pgError(code))).toMatchObject({
          statusCode: 500,
          errorCode: 'INTEGRITY_VIOLATION',
          message: 'Lỗi hệ thống, vui lòng thử lại',
          expected: false,
        });
      }
    });

    it('transient SQLSTATEs (deadlock, serialization failure, connection, lock timeout) stay a retryable generic 500', () => {
      for (const code of ['40P01', '40001', '08006', '53300', '55P03']) {
        expect(describeBulkItemError(pgError(code))).toEqual({
          statusCode: 500,
          errorCode: 500,
          message: 'Lỗi hệ thống, vui lòng thử lại',
          expected: false,
        });
      }
    });

    it('a QueryFailedError with no SQLSTATE at all is treated as transient (500)', () => {
      expect(
        describeBulkItemError(
          new QueryFailedError('SELECT 1', [], new Error('boom')),
        ),
      ).toMatchObject({ statusCode: 500, expected: false });
    });
  });

  it('a 5xx keeps its status and code but its text is replaced by the generic message (upstream detail must not reach the caller)', () => {
    const leaky = 'file-service http://10.0.0.7:9000 refused the connection';

    expect(describeBulkItemError(new CustomException(leaky, 503, 503))).toEqual(
      {
        statusCode: 503,
        errorCode: 503,
        message: 'Lỗi hệ thống, vui lòng thử lại',
        expected: false,
      },
    );
    expect(
      describeBulkItemError(new IntegrityViolationException(leaky)),
    ).toMatchObject({
      statusCode: 500,
      errorCode: 'INTEGRITY_VIOLATION',
      message: 'Lỗi hệ thống, vui lòng thử lại',
      expected: false,
    });
    expect(
      describeBulkItemError(new ServiceUnavailableException(leaky)),
    ).toMatchObject({
      statusCode: 503,
      message: 'Lỗi hệ thống, vui lòng thử lại',
      expected: false,
    });
  });

  it('a plain Error and a non-Error throw are both a generic 500, not expected', () => {
    for (const thrown of [
      new Error('ECONNRESET 10.0.0.5:5432'),
      'oops',
      null,
    ]) {
      const d = describeBulkItemError(thrown);
      expect(d).toEqual({
        statusCode: 500,
        errorCode: 500,
        message: 'Lỗi hệ thống, vui lòng thử lại',
        expected: false,
      });
    }
  });
});

describe('runBulk', () => {
  const makeLogger = () => ({ error: jest.fn<void, [string]>() });

  it('runs items strictly one after another, in order, and adds ok:true to each success row', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    const out = await runBulk(['a', 'b', 'c'], {
      run: async (id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(id);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return { id, extra: id.toUpperCase() };
      },
      keyOf: (id) => ({ id }),
      logLabel: (id) => `item ${id}`,
      logger: makeLogger(),
    });

    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(out).toEqual({
      requested: 3,
      succeeded: 3,
      failed: 0,
      results: [
        { id: 'a', extra: 'A', ok: true },
        { id: 'b', extra: 'B', ok: true },
        { id: 'c', extra: 'C', ok: true },
      ],
    });
  });

  it('a failing item is reported on its own row (keyed by keyOf) and never stops the rest', async () => {
    const logger = makeLogger();

    const out = await runBulk(['a', 'bad', 'c'], {
      run: (id) =>
        id === 'bad'
          ? Promise.reject(
              new CustomException('nope', 4031, HttpStatus.FORBIDDEN),
            )
          : Promise.resolve({ id }),
      keyOf: (id) => ({ id }),
      logLabel: (id) => `item ${id}`,
      logger,
    });

    expect(out).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
    expect(out.results[1]).toEqual({
      id: 'bad',
      ok: false,
      statusCode: 403,
      errorCode: 4031,
      message: 'nope',
    });
    expect(out.results[2]).toEqual({ id: 'c', ok: true });
    // 4xx is caller-attributable: not an error-level log line.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a non-caller-attributable failure is logged with the label and the ORIGINAL error, while the row stays generic', async () => {
    const logger = makeLogger();

    const out = await runBulk(['x'], {
      run: () =>
        Promise.reject(new Error('connection terminated 10.0.0.5:5432')),
      keyOf: (id) => ({ id }),
      logLabel: (id) => `Bulk thing ${id}`,
      logger,
    });

    expect(out.results[0]).toMatchObject({
      id: 'x',
      ok: false,
      statusCode: 500,
      message: 'Lỗi hệ thống, vui lòng thử lại',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = logger.error.mock.calls[0][0];
    expect(line).toContain('Bulk thing x failed:');
    expect(line).toContain('connection terminated 10.0.0.5:5432');
  });

  it('an empty input resolves to zero counts without calling anything', async () => {
    const run = jest.fn();
    const out = await runBulk([], {
      run,
      keyOf: () => ({}),
      logLabel: () => '',
      logger: makeLogger(),
    });
    expect(out).toEqual({ requested: 0, succeeded: 0, failed: 0, results: [] });
    expect(run).not.toHaveBeenCalled();
  });
});
