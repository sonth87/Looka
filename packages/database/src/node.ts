/**
 * Node-only entry point — import as `@face/database/node`.
 *
 * Separated from the main entry because these modules touch `node:module` and
 * `node:sqlite`, which a browser bundle cannot resolve. The desktop main process
 * imports from here; the renderer and the web app never do.
 */

export { NodeSqliteDriver } from './sql/NodeSqliteDriver.js';
export type { NodeSqliteDriverOptions } from './sql/NodeSqliteDriver.js';
export { PersistentStorageAdapter } from './PersistentStorageAdapter.js';
export type { PersistentStorageAdapterOptions } from './PersistentStorageAdapter.js';

// Re-exported for convenience so main-process code needs one import.
export * from './index.js';
