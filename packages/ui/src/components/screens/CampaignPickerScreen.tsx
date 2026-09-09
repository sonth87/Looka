import { useCallback, useEffect, useState } from 'react';
import { Calendar, LogOut, RefreshCw, Search, ArrowRight, Loader2 } from 'lucide-react';
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

/** Dot + text colour for the status badge — kept semantically identical to before (same 5 states), just heavier visual weight for a kiosk display. */
const STATUS_COLOR: Record<CampaignSummary['effectiveStatus'], string> = {
  UPCOMING: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  OPEN: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  EXPIRED: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
  PAUSED: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30',
  CLOSED: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30',
};

const STATUS_DOT: Record<CampaignSummary['effectiveStatus'], string> = {
  UPCOMING: 'bg-amber-400',
  OPEN: 'bg-emerald-400',
  EXPIRED: 'bg-rose-400',
  PAUSED: 'bg-slate-400',
  CLOSED: 'bg-slate-400',
};

const MEMBERSHIP_LABEL: Record<CampaignSummary['membership']['status'], string> = {
  NONE: 'Chưa đăng ký',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  REVOKED: 'Thu hồi',
};

const MEMBERSHIP_COLOR: Record<CampaignSummary['membership']['status'], string> = {
  NONE: 'text-slate-500',
  PENDING: 'text-amber-400',
  APPROVED: 'text-emerald-400',
  REJECTED: 'text-rose-400',
  REVOKED: 'text-rose-400',
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
 *
 * Redesigned 2026-09-09 (item 7) — same props/behaviour as before (no
 * change to `CampaignPickerScreenProps`), a kiosk-appropriate visual pass
 * only: a wider, multi-column card grid instead of a single narrow list
 * (this screen typically renders inside a ~1150x780+ window), larger touch
 * targets throughout, and a clearer status/membership hierarchy per card.
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

  const initial = (identity.displayName || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between px-8 py-5 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div>
          <div className="text-lg font-bold tracking-tight">Looka</div>
          <div className="text-sm text-slate-500">Chọn chiến dịch để bắt đầu</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {initial}
            </div>
            <span className="text-sm font-medium text-slate-200 max-w-[16rem] truncate">
              {identity.displayName}
            </span>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 px-3.5 py-2 text-sm font-medium text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <span>{error}</span>
            <button
              onClick={() => void load()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 font-medium hover:bg-rose-500/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Thử lại
            </button>
          </div>
        )}

        {campaigns === null && !error && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <span>Đang tải danh sách chiến dịch…</span>
          </div>
        )}

        {campaigns?.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-slate-500">
            <Search className="h-10 w-10 text-slate-700" />
            <p className="text-base">Chưa có chiến dịch nào.</p>
            <p className="text-sm">Vui lòng liên hệ CTSV để được thêm vào một chiến dịch.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns?.map((c) => {
            const canEnter = c.effectiveStatus === 'OPEN' && c.membership.status === 'APPROVED';
            const canJoin = c.effectiveStatus === 'OPEN' && c.membership.status === 'NONE';
            return (
              <div
                key={c.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm transition-colors hover:border-slate-700"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-100">
                        {c.code ? `${c.code} · ` : ''}
                        {c.name}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        {formatDateRange(c.startsAt, c.expiresAt)}
                      </div>
                    </div>
                    <span
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLOR[c.effectiveStatus]}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.effectiveStatus]}`} />
                      {STATUS_LABEL[c.effectiveStatus]}
                    </span>
                  </div>

                  {c.quotaPlanned != null && (
                    <div className="mt-3 text-xs text-slate-500">
                      Chỉ tiêu: {c.quotaPlanned}
                      {c.quotaReached ? ' (đã đạt)' : ''}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3.5">
                  <span className={`text-xs font-medium ${MEMBERSHIP_COLOR[c.membership.status]}`}>
                    {MEMBERSHIP_LABEL[c.membership.status]}
                  </span>
                  {canEnter && (
                    <button
                      onClick={() => onSelectCampaign(c)}
                      className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-950/40 transition-colors hover:bg-blue-500"
                    >
                      Vào
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                  {canJoin && (
                    <button
                      onClick={() => void handleJoin(c)}
                      disabled={joiningId === c.id}
                      className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-60"
                    >
                      {joiningId === c.id ? 'Đang gửi…' : 'Đăng ký'}
                    </button>
                  )}
                  {!canEnter && !canJoin && (
                    <button
                      onClick={() => onSelectCampaign(c)}
                      className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:border-slate-700 hover:text-slate-400"
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
