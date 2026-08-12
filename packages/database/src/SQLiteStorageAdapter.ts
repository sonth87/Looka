import { StorageAdapter as IStorageAdapter } from '@face/core';
import initSqlJs, { Database } from 'sql.js';
import { CREATE_TABLES_SQL } from './schema.js';

export class SQLiteStorageAdapter implements IStorageAdapter {
  public readonly type = 'sqlite';
  private db: Database | null = null;
  private memoryStore: Map<string, any> = new Map();

  public async initialize(): Promise<void> {
    try {
      const isBrowser = typeof window !== 'undefined';
      const SQL = await initSqlJs(
        isBrowser
          ? { locateFile: (file: string) => `https://sql.js.org/dist/${file}` }
          : undefined
      );
      this.db = new SQL.Database();
      this.db.run(CREATE_TABLES_SQL);
    } catch {
      // Fallback for environments without WASM support
      this.db = null;
    }
  }

  public async get<T>(key: string): Promise<T | null> {
    if (!this.db) {
      return this.memoryStore.has(key) ? (this.memoryStore.get(key) as T) : null;
    }

    try {
      const stmt = this.db.prepare('SELECT value FROM app_settings WHERE key = :key');
      stmt.bind({ ':key': key });
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return JSON.parse(row.value as string) as T;
      }
      stmt.free();
      return null;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T): Promise<void> {
    if (!this.db) {
      this.memoryStore.set(key, value);
      return;
    }

    const valStr = JSON.stringify(value);
    this.db.run(
      'INSERT INTO app_settings (key, value, version) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1',
      [key, valStr]
    );
  }

  public async delete(key: string): Promise<void> {
    if (!this.db) {
      this.memoryStore.delete(key);
      return;
    }

    this.db.run('DELETE FROM app_settings WHERE key = ?', [key]);
  }

  public async clear(): Promise<void> {
    if (!this.db) {
      this.memoryStore.clear();
      return;
    }

    this.db.run('DELETE FROM app_settings');
  }

  public exec(sql: string, params: any[] = []): any[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  public run(sql: string, params: any[] = []): void {
    if (!this.db) return;
    this.db.run(sql, params);
  }
}
