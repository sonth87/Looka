import { StorageAdapter as IStorageAdapter, FacePlatformError, ERROR_CODES } from '@face/core';
import initSqlJs, { Database } from 'sql.js';
import { SqlExecutor } from './sql/SqlDriver.js';
import { runMigrations } from './migrations/index.js';

export interface SQLiteStorageAdapterOptions {
  /**
   * Where to fetch sql-wasm.wasm from in browser builds.
   *
   * Defaults to a same-origin path: an offline-first product must not depend on
   * a CDN to open its own database. Ship the file under /wasm/ (copy it from
   * node_modules/sql.js/dist) or override this for a different layout.
   */
  wasmBaseUrl?: string;
}

/**
 * In-memory SQLite adapter (sql.js / WASM) for the browser demo.
 *
 * Not suitable for the desktop kiosk: sql.js keeps the whole database in memory,
 * so everything is lost when the page closes. The desktop app uses
 * PersistentStorageAdapter instead.
 */
export class SQLiteStorageAdapter implements IStorageAdapter, SqlExecutor {
  public readonly type = 'sqlite';
  private db: Database | null = null;
  private depth = 0;
  private savepointSeq = 0;
  private readonly wasmBaseUrl: string;

  constructor(options: SQLiteStorageAdapterOptions = {}) {
    this.wasmBaseUrl = options.wasmBaseUrl ?? '/wasm/';
  }

  public async initialize(): Promise<void> {
    // No try/catch fallback: a database that will not open is a fatal condition.
    // Swallowing it here is what previously let writes become silent no-ops.
    const isBrowser = typeof window !== 'undefined';
    const SQL = await initSqlJs(
      isBrowser ? { locateFile: (file: string) => `${this.wasmBaseUrl}${file}` } : undefined
    );
    this.db = new SQL.Database();
    this.db.exec('PRAGMA foreign_keys = ON');
    runMigrations(this.asDriver());
  }

  public isHealthy(): boolean {
    if (!this.db) return false;
    try {
      this.db.exec('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** Serialize the in-memory database so a caller can persist it if it wants to. */
  public export(): Uint8Array {
    return this.require().export();
  }

  // ── SqlExecutor ────────────────────────────────────────────────────────────

  public exec<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): T[] {
    const stmt = this.require().prepare(sql);
    try {
      stmt.bind(params as never);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  public run(sql: string, params: readonly unknown[] = []): void {
    this.require().run(sql, params as never);
  }

  public transaction<T>(fn: () => T): T {
    const db = this.require();
    const isOuter = this.depth === 0;
    const name = isOuter ? null : `sp_${++this.savepointSeq}`;

    db.run(isOuter ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      db.run(isOuter ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (err) {
      db.run(isOuter ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      throw err;
    } finally {
      this.depth--;
    }
  }

  // ── StorageAdapter key/value surface ──────────────────────────────────────

  public async get<T>(key: string): Promise<T | null> {
    const rows = this.exec<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].value) as T;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.run(
      `INSERT INTO app_settings (key, value, version) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1`,
      [key, JSON.stringify(value)]
    );
  }

  public async delete(key: string): Promise<void> {
    this.run('DELETE FROM app_settings WHERE key = ?', [key]);
  }

  public async clear(): Promise<void> {
    this.run('DELETE FROM app_settings', []);
  }

  /** Adapts this instance to the SqlDriver shape the migration runner expects. */
  private asDriver() {
    return {
      exec: (sql: string) => void this.require().exec(sql),
      run: (sql: string, params?: readonly unknown[]) => this.run(sql, params ?? []),
      all: <T>(sql: string, params?: readonly unknown[]) => this.exec<T>(sql, params ?? []),
      get: <T>(sql: string, params?: readonly unknown[]) => this.exec<T>(sql, params ?? [])[0] ?? null,
      transaction: <T>(fn: () => T) => this.transaction(fn),
      close: () => this.require().close(),
    };
  }

  private require(): Database {
    if (!this.db) {
      throw new FacePlatformError(
        ERROR_CODES.DB_NOT_READY,
        'Database is not initialized. Call initialize() before use.',
        'DATABASE',
        false
      );
    }
    return this.db;
  }
}
