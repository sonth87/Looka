import { AdvancedConsoleLogger } from 'typeorm';

/** Above this size, a `Buffer`/`Uint8Array` query parameter is logged as a
 * placeholder instead of its actual bytes. Comfortably larger than any
 * legitimate small-blob parameter (hashes, tokens) so nothing but genuine
 * photo/video payloads is ever affected. */
const MAX_LOGGED_BINARY_PARAM_BYTES = 1024;

/**
 * `TypeOrmConfigService` (`database.service.ts`) turns on `logging: 'all'`
 * whenever `NODE_ENV === 'development'` — which is what every local/dev run
 * of this API uses, `.env`'s own `NODE_ENV=development` included. Stock
 * `AdvancedConsoleLogger` (TypeORM's built-in `'advanced-console'` logger,
 * what this used to be configured as) logs every query's parameters via
 * `JSON.stringify(parameters)` (`AbstractLogger.stringifyParams`) — and
 * `JSON.stringify` on a Node `Buffer` serializes it as `{"type":"Buffer",
 * "data":[<one decimal number per byte>]}`.
 *
 * Live-measured (2026-09-10) against this same dev DB: `PhotoService
 * .addDevicePhoto`'s `INSERT INTO upload_outbox (..., content, ...)` — the
 * exact synchronous write the kiosk capture path awaits, and the one the
 * user pointed at as "feels slow" — carries the whole captured photo as a
 * `Buffer` parameter. A realistic ~150KB photo turned that one `JSON
 * .stringify` (plus `AdvancedConsoleLogger`'s syntax highlighting and the
 * console/file write of the ~600KB+ result, all synchronous, all on the one
 * Node event loop this same process handles every other request on) into
 * 400-1100ms of wall-clock latency per capture — a ~50-80x blowup over the
 * same request with query-parameter logging disabled (12-18ms steady
 * state). The `EXPLAIN ANALYZE`'d INSERT itself, independently measured, is
 * sub-3ms even with a 180KB payload; none of that time is spent in
 * Postgres or in the transaction this logger has nothing to do with — it is
 * 100% this logger's own parameter serialization on the request thread.
 *
 * Fixed here, not by disabling query logging outright: `logging: 'all'` is
 * genuinely useful for every other query in this app (nothing else on this
 * request path carries more than a few small values), so the fix narrows to
 * exactly the pathological case — a binary parameter over
 * `MAX_LOGGED_BINARY_PARAM_BYTES` is logged as a byte-count placeholder
 * instead of its literal bytes. Every other parameter (ids, hashes, small
 * values) logs exactly as before.
 */
export class ByteaSafeAdvancedConsoleLogger extends AdvancedConsoleLogger {
  protected override stringifyParams(parameters: unknown[]): string | unknown[] {
    const redacted = parameters.map((param) => {
      if (
        (Buffer.isBuffer(param) || param instanceof Uint8Array) &&
        param.length > MAX_LOGGED_BINARY_PARAM_BYTES
      ) {
        return `<${param.constructor?.name ?? 'Buffer'} ${param.length} bytes, redacted from query log>`;
      }
      return param;
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- same
    // fallback AbstractLogger.stringifyParams itself uses for circular data.
    return super.stringifyParams(redacted as any[]);
  }
}
