/**
 * Pure functions computing a campaign's effective status and camera
 * requirement — never stored, always derived per-request. See
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.1.2 (formula)
 * and §3.1.1 ("cần tối đa K camera").
 */

export type EffectiveCampaignStatus =
  'PAUSED' | 'CLOSED' | 'UPCOMING' | 'OPEN' | 'EXPIRED';

export interface CampaignStatusInput {
  manualStatus?: 'PAUSED' | 'CLOSED' | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
}

/**
 * effectiveStatus =
 *   manual_status nếu có (PAUSED / CLOSED)
 *   else nếu now < starts_at            → UPCOMING  ("Chưa mở")
 *   else nếu starts_at ≤ now < expires_at → OPEN    ("Đang mở")
 *   else                                → EXPIRED   ("Hết hạn")
 *
 * `starts_at: null` = no lower bound (already open from the start).
 * `expires_at: null` = no upper bound (never expires) — unchanged existing
 * meaning of that column.
 */
export function computeEffectiveStatus(
  campaign: CampaignStatusInput,
  now: Date = new Date(),
): EffectiveCampaignStatus {
  if (
    campaign.manualStatus === 'PAUSED' ||
    campaign.manualStatus === 'CLOSED'
  ) {
    return campaign.manualStatus;
  }

  const nowMs = now.getTime();

  if (campaign.startsAt && nowMs < campaign.startsAt.getTime()) {
    return 'UPCOMING';
  }

  if (campaign.expiresAt && nowMs >= campaign.expiresAt.getTime()) {
    return 'EXPIRED';
  }

  return 'OPEN';
}
