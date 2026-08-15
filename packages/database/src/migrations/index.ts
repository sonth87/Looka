import { FacePlatformError, ERROR_CODES } from '@face/core';
import { SqlDriver } from '../sql/SqlDriver.js';
import { MIGRATION_001_INIT } from './001-init.js';
import { MIGRATION_002_INDEXES } from './002-indexes.js';
import { MIGRATION_003_UPLOAD_OUTBOX } from './003-upload-outbox.js';

export interface Migration {
  version: number;
  name: string;
  /** Statements applied in order, inside one transaction. */
  up: string[];
}

/**
 * Ordered migration list. Append only — never edit a shipped migration, because
 * databases in the field have already run it and will not run it again.
 */
export const MIGRATIONS: Migration[] = [
  MIGRATION_001_INIT,
  MIGRATION_002_INDEXES,
  MIGRATION_003_UPLOAD_OUTBOX,
];

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at INTEGER NOT NULL
);`;

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
}

/**
 * Bring the database up to the latest schema version.
 *
 * Each migration runs in its own transaction together with its bookkeeping row,
 * so a crash mid-run leaves the database at a known version rather than half
 * migrated. Running twice is a no-op.
 */
export function runMigrations(driver: SqlDriver, migrations: Migration[] = MIGRATIONS): MigrationReport {
  driver.exec(MIGRATION_TABLE);

  const row = driver.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  const current = row?.v ?? 0;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);

  const applied: string[] = [];
  for (const migration of pending) {
    try {
      driver.transaction(() => {
        for (const statement of migration.up) driver.exec(statement);
        driver.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          migration.version,
          migration.name,
          Date.now(),
        ]);
      });
      applied.push(`${migration.version}-${migration.name}`);
    } catch (err) {
      throw new FacePlatformError(
        ERROR_CODES.DB_MIGRATION_FAILED,
        `Migration ${migration.version}-${migration.name} failed; database left at version ${current + applied.length}`,
        'DATABASE',
        false,
        { cause: (err as Error).message }
      );
    }
  }

  return { from: current, to: current + applied.length, applied };
}

export { MIGRATION_001_INIT } from './001-init.js';
export { MIGRATION_002_INDEXES } from './002-indexes.js';
export { MIGRATION_003_UPLOAD_OUTBOX } from './003-upload-outbox.js';
