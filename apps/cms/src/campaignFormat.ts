import type { Campaign, CampaignPurpose } from './api';

/** Shared by CampaignList, CreateCampaignPage, and CampaignDetail (the view page) — one label set for the purpose enum instead of three copies drifting apart. */
export const PURPOSE_LABEL: Record<CampaignPurpose, string> = {
  STUDENT_CARD: 'Chụp thẻ SV',
  KYC_ENROLLMENT: 'Đăng ký KYC/FaceID',
};

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
