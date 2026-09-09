import { useCallback, useEffect, useState } from 'react';
import type { AuthClient, AuthenticatedIdentity } from '../../lib/authClient.js';
import {
  CampaignPortalApiError,
  CampaignSummary,
  fetchMyCampaigns,
  joinCampaign,
} from '../../lib/campaignPortalApi.js';

export interface CampaignPickerScreenProps {
  authClient: AuthClient;
  identity: AuthenticatedIdentity;
  onSelectCampaign: (campaign: CampaignSummary) => void;
  onLogout: () => void;
}

const STATUS_LABEL: Record<CampaignSummary['effectiveStatus'], string> = {
  UPCOMING: 'Chưa mở',
  OPEN: 'Đang mở',
  EXPIRED: 'Hết hạn',
  PAUSED: 'Tạm dừng',
  CLOSED: 'Đã đóng',
};

const STATUS_COLOR: Record<CampaignSummary['effectiveStatus'], string> = {
  UPCOMING: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  OPEN: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  EXPIRED: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  PAUSED: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  CLOSED: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const MEMBERSHIP_LABEL: Record<CampaignSummary['membership']['status'], string> = {
  NONE: 'Chưa đăng ký',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  REVOKED: 'Thu hồi',
};

function formatDateRange(startsAt?: string | null, expiresAt?: string | null): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString('vi-VN');
  if (startsAt && expiresAt) return `${fmt(startsAt)} – ${fmt(expiresAt)}`;
  if (expiresAt) return `Đến ${fmt(expiresAt)}`;
  if (startsAt) return `Từ ${fmt(startsAt)}`;
  return 'Không giới hạn thời gian';
}

/**
 * S2 (ui-redesign-plan.md §2) — the campaign list. Every card's action
 * button follows the exact 4-row table in that spec: (Đang mở, Đã duyệt)
 * → "Vào", (Đang mở, Chưa đăng ký) → "Đăng ký", everything else → "Xem"
 * (this pass renders "Xem" as a disabled/no-op state rather than a full
 * read-only detail screen, since S3's locked-state rendering already
 * covers that once a campaign is selected).
 */
export function CampaignPickerScreen({
  authClient,
  identity,
  onSelectCampaign,
  onLogout,
}: CampaignPickerScreenProps) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchMyCampaigns(authClient.authHeaders());
      setCampaigns(list);
    } catch (err) {
      const message =
        err instanceof CampaignPortalApiError && err.status === 401
          ? 'Không xác thực được với máy chủ (SSO chưa sẵn sàng hoặc phiên đã hết hạn).'
          : (err as Error).message;
      setError(message);
    }
  }, [authClient]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleJoin(campaign: CampaignSummary) {
    setJoiningId(campaign.id);
    try {
      await joinCampaign(campaign.id, authClient.authHeaders());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="font-semibold">Looka · Chọn campaign</div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>{identity.displayName}</span>
          <button onClick={onLogout} className="text-slate-500 hover:text-slate-300 underline">
            Đăng xuất
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => void load()} className="underline shrink-0 ml-3">
              Thử lại
            </button>
          </div>
        )}

        {campaigns === null && !error && <div className="text-slate-400">Đang tải danh sách campaign…</div>}

        {campaigns?.length === 0 && <div className="text-slate-400">Chưa có campaign nào. Liên hệ CTSV.</div>}

        <div className="flex flex-col gap-3 max-w-2xl">
          {campaigns?.map((c) => {
            const canEnter = c.effectiveStatus === 'OPEN' && c.membership.status === 'APPROVED';
            const canJoin = c.effectiveStatus === 'OPEN' && c.membership.status === 'NONE';
            return (
              <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {c.code ? `${c.code} · ` : ''}
                      {c.name}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{formatDateRange(c.startsAt, c.expiresAt)}</div>
                  </div>
                  <span className={`text-xs rounded-full border px-2 py-0.5 ${STATUS_COLOR[c.effectiveStatus]}`}>
                    {STATUS_LABEL[c.effectiveStatus]}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{MEMBERSHIP_LABEL[c.membership.status]}</span>
                  {canEnter && (
                    <button
                      onClick={() => onSelectCampaign(c)}
                      className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5"
                    >
                      Vào →
                    </button>
                  )}
                  {canJoin && (
                    <button
                      onClick={() => void handleJoin(c)}
                      disabled={joiningId === c.id}
                      className="rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 text-sm px-4 py-1.5 disabled:opacity-60"
                    >
                      {joiningId === c.id ? 'Đang gửi…' : 'Đăng ký'}
                    </button>
                  )}
                  {!canEnter && !canJoin && (
                    <button
                      onClick={() => onSelectCampaign(c)}
                      className="rounded-lg border border-slate-700 text-slate-400 text-sm px-4 py-1.5"
                    >
                      Xem
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
