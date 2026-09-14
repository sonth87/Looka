/**
 * Shared constants for the stats module — cms-8-screens-api-plan.md §2.9/P4.
 */

/**
 * Sentinel for "no device"/"no operator"/"no reviewer"/"no printer" inside a
 * unique upsert key. Postgres `UNIQUE` treats two NULLs as distinct, so
 * `UNIQUE(date, campaign_id, device_id, operator_user_id)` with real NULLs
 * would let `ON CONFLICT (...) DO UPDATE` silently insert a fresh row every
 * time instead of accumulating into one — exactly the bug this sentinel
 * avoids. Every grouping column that can be "unknown" is `uuid NOT NULL
 * DEFAULT` this value instead of nullable.
 */
export const STATS_UNKNOWN_UUID = '00000000-0000-0000-0000-000000000000';

/** `identification_methods.code` has no "unknown" row — a plain string sentinel for a `SESSION_REPORT` that never reported one. */
export const STATS_UNKNOWN_METHOD = 'UNKNOWN';

export type StatsJobKind = 'SNAPSHOT_REFRESH' | 'DAILY_RECOMPUTE' | 'REBUILD';
export type StatsJobStatus = 'RUNNING' | 'DONE' | 'FAILED';
