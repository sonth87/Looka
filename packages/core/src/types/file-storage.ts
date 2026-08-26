/**
 * Who can read a file stored in the file-service once it is scanned and
 * ready, independent of the calling API key's own rights.
 *
 * Shared here (rather than declared inline in fs-client, database, api, and
 * desktop) so every layer that threads this value through — outbox rows,
 * IPC payloads, SQL columns — refers to the same type instead of five
 * copies of the same string union quietly drifting apart.
 */
export type Visibility = 'public' | 'private';
