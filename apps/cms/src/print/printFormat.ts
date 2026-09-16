import { PrintBatchStatus, PrintItemStatus } from '../api';

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
  QUEUED: 'Đã xếp hàng',
  PRINTING: 'Đang in',
  PRINTED: 'Đã in',
  FAILED: 'Lỗi',
  REPRINT_REQUESTED: 'Chờ in lại',
  CANCELLED: 'Đã hủy',
};

export const PRINT_ITEM_STATUS_BADGE_CLASS: Record<PrintItemStatus, string> = {
  PENDING: 'bg-gray-50 border-gray-200 text-gray-600',
  RENDERED: 'bg-blue-50 border-blue-200 text-blue-700',
  QUEUED: 'bg-violet-50 border-violet-200 text-violet-700',
  PRINTING: 'bg-amber-50 border-amber-200 text-amber-700',
  PRINTED: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  FAILED: 'bg-red-50 border-red-200 text-red-700',
  REPRINT_REQUESTED: 'bg-amber-50 border-amber-200 text-amber-700',
  CANCELLED: 'bg-red-50 border-red-200 text-red-700',
};

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
