import { PrintBatchMode, PrintBatchStatus, PrintItemStatus } from '../api';

export const PRINT_BATCH_STATUS_LABEL: Record<PrintBatchStatus, string> = {
  DRAFT: 'Nháp',
  READY: 'Sẵn sàng',
  PRINTING: 'Đang in',
  DONE: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

export const PRINT_BATCH_STATUS_BADGE_CLASS: Record<PrintBatchStatus, string> = {
  DRAFT: 'bg-gray-50 border-gray-200 text-gray-600',
  READY: 'bg-blue-50 border-blue-200 text-blue-700',
  PRINTING: 'bg-amber-50 border-amber-200 text-amber-700',
  DONE: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  CANCELLED: 'bg-red-50 border-red-200 text-red-700',
};

export const PRINT_ITEM_STATUS_LABEL: Record<PrintItemStatus, string> = {
  PENDING: 'Chờ render',
  RENDERED: 'Đã render',
  EXPORTED: 'Đã xuất, chờ in',
  QUEUED: 'Đã xếp hàng',
  PRINTING: 'Đang in',
  PRINTED: 'Đã in',
  FAILED: 'Lỗi',
  REPRINT_REQUESTED: 'Chờ in lại',
  CANCELLED: 'Đã hủy',
};

/**
 * Mode-aware label for a print item's status — 2026-09-25 product ask:
 * rendering is no longer part of the CENTRALIZED flow (see
 * `PrintBatchService.exportPackage`'s own doc comment, "render() is no
 * longer a precondition for CENTRALIZED export"), so a CENTRALIZED item
 * sitting in PENDING or RENDERED reads to the operator as just "chưa in",
 * not "chờ render"/"đã render" (both of those still describe a DIRECT
 * item's real workflow step). Falls back to the plain
 * `PRINT_ITEM_STATUS_LABEL` for every other status, and for a DIRECT batch
 * or when `batchMode` isn't known (e.g. an item list with no single batch
 * context).
 */
export function printItemStatusLabel(
  status: PrintItemStatus,
  batchMode?: PrintBatchMode | null,
): string {
  if (batchMode === 'CENTRALIZED' && (status === 'PENDING' || status === 'RENDERED')) {
    return 'Chưa in';
  }
  return PRINT_ITEM_STATUS_LABEL[status];
}

export const PRINT_ITEM_STATUS_BADGE_CLASS: Record<PrintItemStatus, string> = {
  PENDING: 'bg-gray-50 border-gray-200 text-gray-600',
  RENDERED: 'bg-blue-50 border-blue-200 text-blue-700',
  EXPORTED: 'bg-violet-50 border-violet-200 text-violet-700',
  QUEUED: 'bg-violet-50 border-violet-200 text-violet-700',
  PRINTING: 'bg-amber-50 border-amber-200 text-amber-700',
  PRINTED: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  FAILED: 'bg-red-50 border-red-200 text-red-700',
  REPRINT_REQUESTED: 'bg-amber-50 border-amber-200 text-amber-700',
  CANCELLED: 'bg-red-50 border-red-200 text-red-700',
};

/**
 * 3-nhóm rút gọn cho màn "In thẻ theo campaign" (plan item 8, §5 Q2, chốt
 * 2026-09-17: giữ đúng 3 nhóm, không tách riêng "Lỗi") — UI-only, không đổi
 * `PrintItemStatus` 8 giá trị ở DB/API.
 */
export type PrintItemStatusBucket = 'PRINTED' | 'PRINTING' | 'NOT_PRINTED';

export const PRINT_ITEM_BUCKET_LABEL: Record<PrintItemStatusBucket, string> = {
  PRINTED: 'Đã in',
  PRINTING: 'Đang in',
  NOT_PRINTED: 'Chưa in',
};

export const PRINT_ITEM_BUCKET_BADGE_CLASS: Record<PrintItemStatusBucket, string> = {
  PRINTED: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  PRINTING: 'bg-amber-50 border-amber-200 text-amber-700',
  NOT_PRINTED: 'bg-gray-50 border-gray-200 text-gray-600',
};

export function printItemStatusBucket(status: PrintItemStatus): PrintItemStatusBucket {
  if (status === 'PRINTED') return 'PRINTED';
  if (status === 'QUEUED' || status === 'PRINTING') return 'PRINTING';
  return 'NOT_PRINTED';
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
