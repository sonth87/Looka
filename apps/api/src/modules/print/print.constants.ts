/**
 * Enums/status catalogs for `print_batches`/`print_items`/`printers` —
 * cms-8-screens-api-plan.md §2.5/§2.7. Kept as plain string unions (not
 * Postgres `enum` types) matching `card-template`'s own convention
 * (`CardTemplate.status`) rather than `device-management`'s Postgres-level
 * `enum` columns — this module's migration uses `CHECK` constraints, same
 * reasoning: adding a new status later is one migration either way, but a
 * `CHECK` alter is friendlier to `down()` and to TypeORM's own diffing.
 */

export type PrintBatchMode = 'DIRECT' | 'CENTRALIZED';
export const PRINT_BATCH_MODES: PrintBatchMode[] = ['DIRECT', 'CENTRALIZED'];

export type PrintBatchStatus =
  'DRAFT' | 'READY' | 'PRINTING' | 'DONE' | 'CANCELLED';
export const PRINT_BATCH_STATUSES: PrintBatchStatus[] = [
  'DRAFT',
  'READY',
  'PRINTING',
  'DONE',
  'CANCELLED',
];

export type PrintItemStatus =
  | 'PENDING'
  | 'RENDERED'
  | 'QUEUED'
  | 'PRINTING'
  | 'PRINTED'
  | 'FAILED'
  | 'REPRINT_REQUESTED'
  | 'CANCELLED';
export const PRINT_ITEM_STATUSES: PrintItemStatus[] = [
  'PENDING',
  'RENDERED',
  'QUEUED',
  'PRINTING',
  'PRINTED',
  'FAILED',
  'REPRINT_REQUESTED',
  'CANCELLED',
];

/**
 * Statuses that free up a `set_id` for a fresh item — governs the
 * migration's `UQ_print_items_set_id_active` partial unique index AND
 * `PrintItemService.bulkCreate`'s "already has an active item" pre-check
 * (both must agree, or bulk-create would report a set as available and
 * then hit the constraint). `REPRINT_REQUESTED` belongs here alongside
 * `CANCELLED`/`FAILED` — confirmed live: without it, `POST
 * /v1/print/items/:id/reprint` could never actually insert its new row,
 * since the original item (moved to `REPRINT_REQUESTED`, not a terminal
 * status) was still "holding" the set under the old two-status list.
 *
 * NOT the same set `CardTemplateService.usageCountFor` excludes — a
 * `REPRINT_REQUESTED` item still counts as "this template was used" there
 * (it really was printed, or at least queued, before being superseded);
 * this list is specifically about who may hold the one active
 * `print_items` slot for a given `subject_photo_sets` row.
 */
export const PRINT_ITEM_INACTIVE_STATUSES: PrintItemStatus[] = [
  'CANCELLED',
  'FAILED',
  'REPRINT_REQUESTED',
];

export type PrintItemEventSource = 'SYSTEM' | 'PRINT_AGENT' | 'MANUAL';

export type PrinterPrintMode = 'SINGLE_SIDE' | 'DUPLEX';
export const PRINTER_PRINT_MODES: PrinterPrintMode[] = [
  'SINGLE_SIDE',
  'DUPLEX',
];

export type PrinterUsageMode = 'DIRECT' | 'CENTRALIZED';
export const PRINTER_USAGE_MODES: PrinterUsageMode[] = [
  'DIRECT',
  'CENTRALIZED',
];

export type PrinterStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';
export const PRINTER_STATUSES: PrinterStatus[] = [
  'ONLINE',
  'OFFLINE',
  'ERROR',
  'DISABLED',
];

export type PrinterConnectionType = 'USB' | 'NETWORK' | 'AGENT';

export interface PrinterConnection {
  type: PrinterConnectionType;
  address?: string | null;
  spoolerName?: string | null;
}

export type PrinterStockEventReason = 'REFILL' | 'PRINT' | 'ADJUST' | 'WASTE';
export const PRINTER_STOCK_EVENT_REASONS: PrinterStockEventReason[] = [
  'REFILL',
  'PRINT',
  'ADJUST',
  'WASTE',
];

/** `bulk`/`bulk-template`/`package` are allowed to touch a lot of rows in one request — cap so one bad filter can't take down the process. */
export const MAX_BULK_ITEMS = 2000;
