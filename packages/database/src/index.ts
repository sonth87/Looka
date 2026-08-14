/**
 * Browser-safe entry point.
 *
 * Node-only pieces (node:sqlite driver, file-backed adapter) live in
 * `@face/database/node`. Keeping them out of this file matters: a browser
 * bundler follows every export here, and `node:module` cannot be bundled.
 */

export { CREATE_TABLES_SQL } from './schema.js';

// SQL layer (types + browser-safe pieces)
export type { SqlDriver, SqlExecutor } from './sql/SqlDriver.js';

// Migrations
export { runMigrations, MIGRATIONS } from './migrations/index.js';
export type { Migration, MigrationReport } from './migrations/index.js';

// Adapters
export { SQLiteStorageAdapter } from './SQLiteStorageAdapter.js';
export type { SQLiteStorageAdapterOptions } from './SQLiteStorageAdapter.js';

// Repositories
export { SessionRepository } from './repositories/SessionRepository.js';
export type { SessionStore } from './repositories/SessionRepository.js';
export { AttendanceRepository, businessDayOf } from './repositories/AttendanceRepository.js';
export type { AttendanceRecordParams, LastAttendance } from './repositories/AttendanceRepository.js';
export { UploadOutboxRepository, nextRetryDelayMs } from './repositories/UploadOutboxRepository.js';
export type { OutboxItem, OutboxStatus, EnqueueInput, OutboxStats } from './repositories/UploadOutboxRepository.js';
export { PersonRepository } from './repositories/PersonRepository.js';
export { FaceProfileRepository } from './repositories/FaceProfileRepository.js';
export type { SaveProfileParams, ModelIdentity } from './repositories/FaceProfileRepository.js';
