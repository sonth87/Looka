import type { ReviewSetListItem, ReviewSetStatus } from '../api';

/** C5 mockup's status vocabulary (§5.1: "Sẵn sàng · Đang duyệt · Đã duyệt · Từ chối · Đang tạo · Lỗi") — not part of ui-redesign-plan.md §4.1's own table (that one only covers campaign/membership/trigger/round/ảnh-thẻ/camera-vai-trò vocab), so this is a literal reading of cms-photo-review-plan.md §5.1's mockup labels instead. */
export const REVIEW_STATUS_LABEL: Record<ReviewSetStatus, string> = {
  PENDING_AUTO: 'Đang tạo ảnh 4x6',
  AUTO_FAILED: 'Tạo ảnh 4x6 lỗi',
  READY: 'Sẵn sàng',
  IN_REVIEW: 'Đang duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};

export const REVIEW_STATUS_BADGE_CLASS: Record<ReviewSetStatus, string> = {
  PENDING_AUTO: 'bg-gray-100 border-gray-300 text-gray-600',
  AUTO_FAILED: 'bg-rose-50 border-rose-200 text-rose-700',
  READY: 'bg-blue-50 border-blue-200 text-blue-700',
  IN_REVIEW: 'bg-amber-50 border-amber-200 text-amber-700',
  APPROVED: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  REJECTED: 'bg-rose-50 border-rose-200 text-rose-700',
};

/** §4 rule: "Khóa = status ∈ {PENDING_AUTO, AUTO_FAILED} hoặc current_card_variant_id IS NULL". */
export function isReviewSetLocked(set: Pick<ReviewSetListItem, 'status' | 'currentCardVariantId'>): boolean {
  return set.status === 'PENDING_AUTO' || set.status === 'AUTO_FAILED' || !set.currentCardVariantId;
}

/** §5.3's identity-similarity thresholds — ≥0.85 green, 0.70–0.85 yellow (accept allowed with confirmation), <0.70 red (accept blocked). Shared by `AiEditModal` and `UploadReplaceModal`. */
export function similarityTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 0.85) return 'good';
  if (score >= 0.7) return 'warn';
  return 'bad';
}

export const SIMILARITY_TONE_CLASS: Record<'good' | 'warn' | 'bad', string> = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
};

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
