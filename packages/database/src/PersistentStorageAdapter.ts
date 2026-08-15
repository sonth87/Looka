import { StorageAdapter as IStorageAdapter, FacePlatformError, ERROR_CODES } from '@face/core';
import { SqlDriver, SqlExecutor } from './sql/SqlDriver.js';
import { NodeSqliteDriver } from './sql/NodeSqliteDriver.js';
import { runMigrations, MigrationReport } from './migrations/index.js';

export interface PersistentStorageAdapterOptions {
  /** Absolute path to the database file. Use ':memory:' only in tests. */
  filename: string;
  /** Inject a different SqlDriver (e.g. better-sqlite3) instead of node:sqlite. */
  driver?: SqlDriver;
}

/**
 * File-backed storage adapter for the desktop app.
 *
 * Replaces the in-memory sql.js adapter on the main process. Two behavioural
 * differences that matter:
 *
 *   1. Data survives restart. The previous adapter created a fresh in-memory
 *      database on every launch, so every person, profile and attendance record
 *      disappeared when the app closed.
 *
 *   2. Failures are loud. The previous adapter caught init errors, set db = null
 *      and turned every write into a silent no-op, which let attendance report
 *      SUCCESS while nothing was stored. Here, an unusable database throws and
 *      the app is expected to show an error screen rather than open the kiosk.
 */
export class PersistentStorageAdapter implements IStorageAdapter, SqlExecutor {
  public readonly type = 'sqlite';

  private driver: SqlDriver | null = null;
  private readonly options: PersistentStorageAdapterOptions;
  private migrationReport: MigrationReport | null = null;

  constructor(options: PersistentStorageAdapterOptions) {
    this.options = options;
  }

  public async initialize(): Promise<void> {
    // Deliberately not wrapped in try/catch: a database that cannot be opened
    // is a fatal condition, not a degraded mode.
    this.driver = this.options.driver ?? new NodeSqliteDriver({ filename: this.options.filename });
    this.migrationReport = runMigrations(this.driver);
  }

  /** Migration outcome from the last initialize(), for diagnostics. */
  public getMigrationReport(): MigrationReport | null {
    return this.migrationReport;
  }

  /** Cheap liveness probe. Used by the status IPC so health is measured, not assumed. */
  public isHealthy(): boolean {
    if (!this.driver) return false;
    try {
      this.driver.get('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }

  public close(): void {
    this.driver?.close();
    this.driver = null;
  }

  // ── SqlExecutor ────────────────────────────────────────────────────────────

  public exec<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): T[] {
    return this.require().all<T>(sql, params);
  }

  public run(sql: string, params: readonly unknown[] = []): void {
    this.require().run(sql, params);
  }

  public transaction<T>(fn: () => T): T {
    return this.require().transaction(fn);
  }

  // ── StorageAdapter key/value surface (backed by app_settings) ──────────────

  public async get<T>(key: string): Promise<T | null> {
    const row = this.require().get<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      [key]
    );
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.require().run(
      `INSERT INTO app_settings (key, value, version) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1`,
      [key, JSON.stringify(value)]
    );
  }

  public async delete(key: string): Promise<void> {
    this.require().run('DELETE FROM app_settings WHERE key = ?', [key]);
  }

  public async clear(): Promise<void> {
    this.require().run('DELETE FROM app_settings', []);
  }

  private require(): SqlDriver {
    if (!this.driver) {
      throw new FacePlatformError(
        ERROR_CODES.DB_NOT_READY,
        'Database is not initialized. Call initialize() before use.',
        'DATABASE',
        false
      );
    }
    return this.driver;
  }
}
