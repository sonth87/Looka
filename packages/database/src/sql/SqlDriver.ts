/**
 * Minimal synchronous SQL driver contract.
 *
 * Exists so persistence is not locked to one native module. Two implementations
 * are expected:
 *   - NodeSqliteDriver    : built-in `node:sqlite` (Node >= 22.5). Zero native build.
 *   - BetterSqliteDriver  : `better-sqlite3`. Needs electron-rebuild + VC++ toolset on Windows.
 *
 * Electron 34 ships Node 20, which has no `node:sqlite`. Either bump Electron to a
 * build carrying Node >= 22, or add better-sqlite3 and implement this same interface.
 * Nothing above this layer changes when that decision is made.
 */
export interface SqlDriver {
  /** Run one or more statements with no parameters. Used by migrations. */
  exec(sql: string): void;

  /** Run a single parameterised statement. */
  run(sql: string, params?: readonly unknown[]): void;

  /** Fetch all rows. */
  all<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T[];

  /** Fetch the first row, or null. */
  get<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T | null;

  /**
   * Run `fn` inside a transaction. Commits on return, rolls back if `fn` throws.
   * Nested calls join the outer transaction (savepoints), so a repository can
   * safely call another repository without knowing who opened the transaction.
   */
  transaction<T>(fn: () => T): T;

  close(): void;
}

/**
 * The subset of driver behaviour repositories depend on.
 *
 * Repositories take this instead of a concrete adapter so the same code runs on
 * the persistent desktop adapter and the in-memory web one.
 */
export interface SqlExecutor {
  exec<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T[];
  run(sql: string, params?: readonly unknown[]): void;
  transaction<T>(fn: () => T): T;
}
