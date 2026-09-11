import { useEffect, useState } from 'react';
import {
  ApiError,
  Device,
  ListSessionsParams,
  Paginated,
  SessionListItem,
  SessionListState,
  listSessions,
} from '../api';
import { formatSessionDuration } from '../sessionFormat';
import { SessionDetailDrawer } from './SessionDetailDrawer';

const PAGE_SIZE = 20;

const STATE_LABEL: Record<SessionListState, string> = {
  all: 'Tất cả',
  completed: 'Hoàn tất',
  pending: 'Đang chờ',
  failed: 'Lỗi',
};
const STATE_OPTIONS = Object.keys(STATE_LABEL) as SessionListState[];

/**
 * A `<input type="date">` value (`YYYY-MM-DD`) is naive - no timezone - so it
 * is read here as the browser's own local midnight, matching how an admin
 * reads "từ ngày X" when they type it in, rather than as UTC midnight.
 */
function startOfDayIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function endOfDayIso(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999`).toISOString();
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Per-campaign list of capture sessions (Phase 11) - kiosk sessions only,
 * per the product decision to keep this to one panel on the campaign detail
 * page rather than a global page (web sessions carry no campaignId).
 *
 * `focusDeviceId` (2026-09-07, product request: "xem danh sách chụp ảnh của
 * từng thiết bị") lets a caller (the device row's own "Xem ảnh đã chụp"
 * action in `DevicesPanel`, via `CampaignDetail`) drive this panel's device
 * filter from outside rather than requiring the admin to reselect it from
 * the dropdown - the filter itself already existed, this only wires an
 * external entry point into it. Re-applies whenever the prop value changes
 * (not just once at mount), but stays a plain uncontrolled `deviceId` the
 * rest of the time so the admin can still freely change the dropdown
 * afterward without it snapping back.
 */
export function SessionsPanel({
  campaignId,
  devices,
  focusDeviceId,
}: {
  campaignId: string;
  devices: Device[];
  focusDeviceId?: string;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState<SessionListState>('all');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<Paginated<SessionListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusDeviceId) return;
    setDeviceId(focusDeviceId);
    setPage(1);
  }, [focusDeviceId]);

  useEffect(() => {
    const params: ListSessionsParams = { campaignId, page, limit: PAGE_SIZE };
    if (deviceId) params.deviceId = deviceId;
    if (from) params.from = startOfDayIso(from);
    if (to) params.to = endOfDayIso(to);
    if (state !== 'all') params.state = state;

    setError(null);
    listSessions(params)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, deviceId, from, to, state, page]);

  const sessions = result?.items ?? [];
  const meta = result?.meta;
  // Loaded at least once with the current filters, and came back empty.
  const isEmpty = result !== null && sessions.length === 0;

  return (
    <div id="sessions-panel" className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-900">Phiên chụp</h2>

      <div className="flex flex-wrap gap-3">
        <select
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả thiết bị</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          Từ ngày
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
          />
        </label>

        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          Đến ngày
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
          />
        </label>

        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value as SessionListState);
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {result === null && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {isEmpty && !error && (
        <div className="text-sm text-gray-500 space-y-1">
          <p>Chưa có phiên chụp nào.</p>
          {devices.length > 0 && (
            <p className="text-xs text-gray-400">Kiosk phải chạy bản mới để báo cáo phiên chụp.</p>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-4">Thời gian</th>
                <th className="py-2.5 px-4">Thời gian chụp</th>
                <th className="py-2.5 px-4">Thiết bị</th>
                <th className="py-2.5 px-4">Mã SV / Tên</th>
                <th className="py-2.5 px-4">Ảnh</th>
                <th className="py-2.5 px-4">Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setOpenSessionId(s.id)}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="py-2.5 px-4 text-gray-900">{formatDateTime(s.capturedAt ?? s.completedAt)}</td>
                  <td className="py-2.5 px-4 text-gray-500 tabular-nums">
                    {formatSessionDuration(s.capturedAt, s.completedAt)}
                  </td>
                  <td className="py-2.5 px-4 text-gray-500">{s.deviceName ?? '—'}</td>
                  <td className="py-2.5 px-4 text-gray-500">
                    {s.subjectCode || s.subjectName ? `${s.subjectCode ?? ''} ${s.subjectName ?? ''}`.trim() : '—'}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="text-gray-900 tabular-nums">{s.photoCount}</span>
                  </td>
                  <td className="py-2.5 px-4 text-gray-500">{s.source === 'KIOSK' ? 'Kiosk' : 'Web'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {meta && meta.totalPages !== undefined && meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500 pt-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={meta.currentPage <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                Trước
              </button>
              <span>
                Trang {meta.currentPage}/{meta.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={meta.currentPage >= meta.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                Sau
              </button>
            </div>
          )}
        </>
      )}

      {openSessionId && <SessionDetailDrawer sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />}
    </div>
  );
}
