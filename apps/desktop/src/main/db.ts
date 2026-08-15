import { app } from 'electron';
import path from 'node:path';
import { PersistentStorageAdapter } from '@face/database/node';

/**
 * The single database instance for the main process.
 *
 * Lives in userData, not inside the packaged app bundle: the install directory
 * is read-only on a properly configured machine, and data must survive an
 * application update.
 */
let adapter: PersistentStorageAdapter | null = null;
let initError: string | null = null;

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'face-platform.db');
}

export interface InitDatabaseResult {
  ok: boolean;
  /** Present only when ok is false. */
  error?: string;
}

/**
 * Open the database and bring the schema up to date.
 *
 * Returns the failure instead of throwing so the caller can decide what to show;
 * what it must never do is let the app continue as if storage worked.
 */
export async function initDatabase(): Promise<InitDatabaseResult> {
  try {
    adapter = new PersistentStorageAdapter({ filename: getDatabasePath() });
    await adapter.initialize();
    initError = null;
    return { ok: true };
  } catch (err) {
    adapter = null;
    initError = (err as Error).message;
    return { ok: false, error: initError };
  }
}

/** Throws when storage is unavailable. Callers must not paper over this. */
export function getDatabase(): PersistentStorageAdapter {
  if (!adapter) {
    throw new Error(initError ? `Database unavailable: ${initError}` : 'Database not initialized');
  }
  return adapter;
}

export function getDatabaseError(): string | null {
  return initError;
}

/** Live probe — runs a real query rather than reporting a stored assumption. */
export function isDatabaseHealthy(): boolean {
  return adapter?.isHealthy() ?? false;
}

export function closeDatabase(): void {
  adapter?.close();
  adapter = null;
}
