import { createRequire } from 'node:module';
import { FacePlatformError, ERROR_CODES } from '@face/core';
import { SqlDriver } from './SqlDriver.js';

/**
 * SqlDriver backed by the built-in `node:sqlite` module (Node >= 22.5).
 *
 * Loaded through createRequire rather than a static import so that bundlers
 * targeting older runtimes do not hard-fail at build time; the absence of the
 * module surfaces as a typed DATABASE error at initialize() instead.
 */

interface StatementSync {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

type DatabaseSyncCtor = new (path: string, options?: Record<string, unknown>) => DatabaseSyncLike;

function loadDatabaseSync(): DatabaseSyncCtor {
  try {
    // Anchored at the Node binary rather than import.meta.url so this file
    // compiles under both CommonJS and ESM targets. 'node:sqlite' is a builtin,
    // so the anchor path does not affect resolution.
    const require = createRequire(process.execPath);
    const mod = require('node:sqlite') as { DatabaseSync?: DatabaseSyncCtor };
    if (!mod.DatabaseSync) throw new Error('node:sqlite has no DatabaseSync export');
    return mod.DatabaseSync;
  } catch (err) {
    throw new FacePlatformError(
      ERROR_CODES.DB_DRIVER_UNAVAILABLE,
      'node:sqlite is unavailable on this runtime (needs Node >= 22.5). ' +
        'Use a runtime that ships it, or supply a better-sqlite3 based SqlDriver.',
      'DATABASE',
      false,
      { cause: (err as Error).message }
    );
  }
}

export interface NodeSqliteDriverOptions {
  /** Absolute file path, or ':memory:' for tests. */
  filename: string;
  /** WAL improves crash resilience for a single-writer kiosk. Off for :memory:. */
  walMode?: boolean;
}

export class NodeSqliteDriver implements SqlDriver {
  private db: DatabaseSyncLike;
  private depth = 0;
  private savepointSeq = 0;

  constructor(options: NodeSqliteDriverOptions) {
    const DatabaseSync = loadDatabaseSync();
    this.db = new DatabaseSync(options.filename);

    // Enforced here rather than left to callers: a kiosk that silently drops
    // foreign keys would corrupt attendance/photo links without any error.
    this.db.exec('PRAGMA foreign_keys = ON');
    if (options.walMode !== false && options.filename !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
    }
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public run(sql: string, params: readonly unknown[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  public all<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  public get<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): T | null {
    const row = this.db.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  public transaction<T>(fn: () => T): T {
    // Nested calls use SAVEPOINT so an inner failure rolls back only its own
    // work; the outer transaction decides the final outcome.
    const isOuter = this.depth === 0;
    const name = isOuter ? null : `sp_${++this.savepointSeq}`;

    this.db.exec(isOuter ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.depth++;

    try {
      const result = fn();
      this.db.exec(isOuter ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (err) {
      this.db.exec(isOuter ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      throw err;
    } finally {
      this.depth--;
    }
  }

  public close(): void {
    this.db.close();
  }
}
