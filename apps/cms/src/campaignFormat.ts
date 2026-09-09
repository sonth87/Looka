import type { Campaign, CampaignPurpose, EffectiveStatus, ManualStatus } from './api';

/** Shared by CampaignList, CreateCampaignPage, and CampaignDetail (the view page) — one label set for the purpose enum instead of three copies drifting apart. */
export const PURPOSE_LABEL: Record<CampaignPurpose, string> = {
  STUDENT_CARD: 'Chụp thẻ SV',
  KYC_ENROLLMENT: 'Đăng ký KYC/FaceID',
};

/** `manualStatus` dropdown labels — ui-redesign-plan.md §4.1 vocabulary table ("Tự động" for no override). */
export const MANUAL_STATUS_LABEL: Record<'' | ManualStatus, string> = {
  '': 'Tự động',
  PAUSED: 'Tạm dừng',
  CLOSED: 'Đóng',
};

/** §4.1's fixed vocabulary for campaign status — never "active"/"expired" in UI copy. */
export const EFFECTIVE_STATUS_LABEL: Record<EffectiveStatus, string> = {
  UPCOMING: 'Chưa mở',
  OPEN: 'Đang mở',
  EXPIRED: 'Hết hạn',
  PAUSED: 'Tạm dừng',
  CLOSED: 'Đã đóng',
};

/** §4.2's badge color table (kiosk/CMS shared): Đang mở = emerald, Chưa mở = amber, Hết hạn = rose, Tạm dừng/Đã đóng = slate. */
export const EFFECTIVE_STATUS_BADGE_CLASS: Record<EffectiveStatus, string> = {
  OPEN: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  UPCOMING: 'bg-amber-50 border-amber-200 text-amber-700',
  EXPIRED: 'bg-rose-50 border-rose-200 text-rose-700',
  PAUSED: 'bg-gray-100 border-gray-300 text-gray-600',
  CLOSED: 'bg-gray-100 border-gray-300 text-gray-600',
};

/**
 * Client-side fallback for §3.1.2's `effectiveStatus` formula — used when a
 * campaign row doesn't already carry a server-computed `effectiveStatus`
 * (either an older backend, or a live preview while editing a draft that
 * hasn't been saved yet). Prefers the real server value when present, since
 * that one also accounts for `manualStatus` precedence server-side exactly.
 */
export function computeEffectiveStatus(
  campaign: Pick<Campaign, 'effectiveStatus' | 'manualStatus' | 'startsAt' | 'expiresAt'>,
  now: number = Date.now()
): EffectiveStatus {
  if (campaign.effectiveStatus) return campaign.effectiveStatus;
  if (campaign.manualStatus) return campaign.manualStatus;
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now) return 'UPCOMING';
  if (campaign.expiresAt && new Date(campaign.expiresAt).getTime() <= now) return 'EXPIRED';
  return 'OPEN';
}

/** `null`/`undefined` `expiresAt` means "vĩnh viễn" — see campaign.entity.ts's own doc comment server-side. */
export function formatExpiry(campaign: Pick<Campaign, 'expiresAt'>): string {
  if (!campaign.expiresAt) return 'Vĩnh viễn';
  return new Date(campaign.expiresAt).toLocaleDateString('vi-VN');
}

export function isExpired(campaign: Pick<Campaign, 'expiresAt'>, now: number = Date.now()): boolean {
  return !!campaign.expiresAt && new Date(campaign.expiresAt).getTime() <= now;
}

/**
 * "Sắp hết hạn" window for the campaign-list stats strip (Part 3 of the
 * 2026-09-07 campaign-pages redesign) — expiring later than now but within
 * `days` days. A campaign already expired is not "expiring soon" (it's
 * already in the `isExpired` bucket), so the two are mutually exclusive.
 */
export function isExpiringSoon(
  campaign: Pick<Campaign, 'expiresAt'>,
  days: number = 7,
  now: number = Date.now()
): boolean {
  if (!campaign.expiresAt) return false;
  const t = new Date(campaign.expiresAt).getTime();
  return t > now && t <= now + days * 24 * 60 * 60 * 1000;
}
