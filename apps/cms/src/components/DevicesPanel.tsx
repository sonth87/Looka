import { useState, type FormEvent } from 'react';
import { Ban, CheckCircle2, Images, RefreshCw } from 'lucide-react';
import { activateDevice, ApiError, Device, DesktopOs, registerDevice, reissueDevice, revokeDevice } from '../api';
import { ModalShell } from './CampaignDangerActions';
import { IconButton } from './IconButton';

/** Triggers a real browser save — `<a download>` on an object URL, revoked right after. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * An activation zip sitting in memory, ready to be saved — from either a
 * fresh registration or a reissue. Kept in state instead of auto-downloading
 * (2026-09-07 product request: "chỉ đăng ký thiết bị và có thể tải sau") so
 * the admin sees a clear success state and chooses when to actually trigger
 * the browser save; the blob stays downloadable as many times as needed
 * until this banner is dismissed or the page is left.
 */
interface PendingPackage {
  deviceName: string;
  blob: Blob;
  filename: string;
  kind: 'registered' | 'reissued';
}

const formatTime = (iso: string) => new Date(iso).toLocaleString('vi-VN');

/** Vietnamese label + explanation for `Device.lastAuthFailReason` — used by the red "kiosk bị từ chối" chip below. */
const AUTH_FAIL_REASON: Record<string, { label: string; hint: string }> = {
  INVALID_SECRET: {
    label: 'mã bí mật không hợp lệ',
    hint: 'Kiosk đang dùng một mã đã chết (cấp lại quá lâu mà chưa nạp gói mới, hoặc đã bị thu hồi trước đó). Bấm "Tải gói kích hoạt" rồi chép activation.json mới cạnh file chạy Looka, mở lại app.',
  },
  EXPIRED: {
    label: 'chiến dịch đã hết hạn',
    hint: 'Chiến dịch chứa thiết bị này đã hết hạn. Gia hạn chiến dịch để kiosk xác thực lại được.',
  },
  REVOKED: {
    label: 'thiết bị đã bị thu hồi',
    hint: 'Thiết bị này đã bị thu hồi trên CMS. Bấm "Tải gói kích hoạt" để cấp gói mới rồi nạp lại cho kiosk.',
  },
};

/**
 * Device list + registration + per-row actions for a campaign's detail page.
 * Split out of `CampaignDetail.tsx` (2026-09-07) once the device table
 * gained real per-row actions — see docs/ROADMAP.md's dated entry for the
 * full write-up of why registration no longer auto-downloads and why
 * "Tải gói kích hoạt" (labeled "reissue" in the API — `reissueDevice`)
 * exists: the plaintext device secret is never stored server-side, only its
 * hash, so a lost activation zip cannot be recovered — only reissued, by
 * rotating the secret (see `DeviceService.reissueDevice`'s own doc comment,
 * apps/api).
 *
 * 2026-09-08 ("secret rotation with overlap" — fixing the real "kiosk 3"
 * incident where a second "Tải gói kích hoạt" click 401-locked an already-
 * running kiosk): reissuing no longer revokes a running kiosk's credentials
 * — the old secret stays valid until the new package is actually loaded, or
 * an admin explicitly hits "Thu hồi". So reissue no longer needs an operator
 * confirmation modal, and a new explicit "Thu hồi" action + a "chưa nạp gói
 * mới" chip (from `secretRotatedAt`) exist so an admin always knows the real
 * auth state of a kiosk instead of just its last-known "activated" badge.
 */
export function DevicesPanel({
  campaignId,
  devices,
  onChanged,
  onViewCaptures,
}: {
  campaignId: string;
  devices: Device[];
  onChanged: () => void;
  /** "Xem ảnh đã chụp" (2026-09-07) — filters/scrolls the page's `SessionsPanel` to this device, rather than duplicating session/photo listing here. */
  onViewCaptures?: (deviceId: string) => void;
}) {
  const [name, setName] = useState('');
  // Defaults to 'win' (2026-09-07 fix — was 'mac', silently producing a
  // JSON-only zip since only DESKTOP_INSTALLER_PATH_WIN is configured in
  // this environment; no mac installer has been built here). Both this and
  // the backend's own fallback (ActivationPackageService.buildActivationZip's
  // `os = 'mac'` default) need revisiting together if a mac installer is
  // ever added.
  const [os, setOs] = useState<DesktopOs>('win');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPackage | null>(null);
  const [reissuingId, setReissuingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Device | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setRegistering(true);
    setError(null);
    try {
      // authApiEndpoint omitted — the server derives it from this very
      // request (see DeviceController.deriveApiBaseUrl, apps/api).
      const { blob, filename } = await registerDevice(campaignId, {
        name: name.trim(),
        os,
      });
      setPending({ deviceName: name.trim(), blob, filename, kind: 'registered' });
      setName('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  };

  /**
   * No confirmation step anymore (2026-09-08) — reissuing no longer revokes
   * a running kiosk's credentials on the spot (see this component's own
   * doc comment), so there is nothing destructive left to confirm here.
   */
  const doReissue = async (device: Device) => {
    setReissuingId(device.id);
    setError(null);
    try {
      // `os` isn't stored on the device row (it's a per-request zip-build
      // parameter, not device state — see ReissueDeviceDto), and the
      // backend's own default is 'mac'. Explicit 'win' here for the same
      // reason as the registration form's default above.
      //
      // authApiEndpoint omitted entirely: the server backfills it from the
      // request when the device doesn't already have one, and otherwise
      // keeps the device's current value — see `DeviceService.reissueDevice`'s
      // doc comment (apps/api). Never clobbers an admin's custom value.
      const { blob, filename } = await reissueDevice(device.id, { os: 'win' });
      setPending({ deviceName: device.name, blob, filename, kind: 'reissued' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setReissuingId(null);
    }
  };

  /**
   * Manual "Kích hoạt" (2026-09-07 product request) — flips a device to
   * ACTIVATED on the CMS without waiting for a real kiosk to call in, for
   * testing/ops. Doesn't touch credentials, so no confirmation needed —
   * unlike revoke, nothing gets invalidated. Only ever shown for a
   * REGISTERED device (see the table below) — REVOKED refuses this
   * server-side (`ERROR_CODE.DEVICE_REVOKED`).
   */
  const doActivate = async (device: Device) => {
    setActivatingId(device.id);
    setError(null);
    try {
      await activateDevice(device.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setActivatingId(null);
    }
  };

  /**
   * "Thu hồi" (2026-09-08) — the hard-stop counterpart to reissue: kills
   * every secret this device has immediately, no overlap. Always confirmed
   * first — unlike reissue, this really does lock out a running kiosk on
   * the spot, with no grace period.
   */
  const doRevoke = async (device: Device) => {
    setRevokingId(device.id);
    setError(null);
    try {
      await revokeDevice(device.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-900">Thiết bị ({devices.length})</h2>

      {pending && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>
            {pending.kind === 'registered'
              ? `Đã đăng ký thiết bị «${pending.deviceName}». Gói kích hoạt đã sẵn sàng.`
              : `Đã tạo gói mới cho «${pending.deviceName}». Kiosk đang chạy vẫn dùng được mã cũ cho tới khi nạp gói này.`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => saveBlob(pending.blob, pending.filename)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
            >
              Tải gói kích hoạt
            </button>
            <button
              onClick={() => setPending(null)}
              className="px-3 py-1.5 rounded-lg text-emerald-700 hover:bg-emerald-100 text-sm"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3">Tên</th>
            <th className="py-2 pr-3">Trạng thái</th>
            <th className="py-2 pr-3">Kích hoạt lúc</th>
            <th className="py-2 pr-3">Hành động</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            // A stale rejection from before the device's last success (or
            // from before it was ever activated) isn't "currently being
            // rejected" - only show the red chip when the failure is
            // actually the newer of the two.
            const isCurrentlyRejected =
              d.lastAuthFailedAt && (!d.lastAuthAt || new Date(d.lastAuthFailedAt) > new Date(d.lastAuthAt));
            const failReason = d.lastAuthFailReason ? AUTH_FAIL_REASON[d.lastAuthFailReason] : undefined;

            return (
              <tr key={d.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 text-gray-900">{d.name}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={
                        d.status === 'ACTIVATED'
                          ? 'text-emerald-600'
                          : d.status === 'REVOKED'
                            ? 'text-red-600'
                            : 'text-amber-600'
                      }
                    >
                      {d.status === 'ACTIVATED' ? 'Đã kích hoạt' : d.status === 'REVOKED' ? 'Đã thu hồi' : 'Chưa kích hoạt'}
                    </span>
                    {!d.authApiEndpoint?.trim() && (
                      <span
                        className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs"
                        title="Thiết bị này chưa có địa chỉ API — kiosk sẽ không bao giờ lấy được cấu hình campaign mới. Bấm 'Tải gói kích hoạt' để khắc phục."
                      >
                        Thiếu API endpoint
                      </span>
                    )}
                    {d.secretRotatedAt && (
                      <span
                        className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs"
                        title="Đã tải gói kích hoạt mới cho thiết bị này, nhưng kiosk chưa xác thực bằng mã mới lần nào — mã cũ vẫn còn dùng được cho tới khi đó (hoặc cho tới khi bị Thu hồi)."
                      >
                        Kiosk chưa nạp gói mới (cấp lại lúc {formatTime(d.secretRotatedAt)})
                      </span>
                    )}
                    {isCurrentlyRejected && d.lastAuthFailedAt && (
                      <span
                        className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs"
                        title={failReason?.hint}
                      >
                        Kiosk bị từ chối: {failReason?.label ?? d.lastAuthFailReason} lúc {formatTime(d.lastAuthFailedAt)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3 text-gray-500">
                  <div>{d.activatedAt ? formatTime(d.activatedAt) : '—'}</div>
                  {d.lastAuthAt && (
                    <div className="text-xs text-gray-400">Xác thực gần nhất: {formatTime(d.lastAuthAt)}</div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1">
                    {onViewCaptures && (
                      <IconButton icon={Images} label="Xem ảnh đã chụp" onClick={() => onViewCaptures(d.id)} />
                    )}
                    {d.status === 'REGISTERED' && (
                      <IconButton
                        icon={CheckCircle2}
                        label={activatingId === d.id ? 'Đang kích hoạt...' : 'Kích hoạt'}
                        onClick={() => void doActivate(d)}
                        disabled={activatingId === d.id}
                        tone="success"
                      />
                    )}
                    <IconButton
                      icon={RefreshCw}
                      label={reissuingId === d.id ? 'Đang tải...' : 'Tải gói kích hoạt'}
                      onClick={() => void doReissue(d)}
                      disabled={reissuingId === d.id}
                      tone="primary"
                    />
                    {d.status !== 'REVOKED' && (
                      <IconButton
                        icon={Ban}
                        label={revokingId === d.id ? 'Đang thu hồi...' : 'Thu hồi'}
                        onClick={() => setConfirmRevoke(d)}
                        disabled={revokingId === d.id}
                        tone="danger"
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {devices.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-gray-500">
                Chưa có thiết bị nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={submit} className="space-y-3 pt-3 border-t border-gray-200">
        <h3 className="text-sm font-medium text-gray-700">Đăng ký thiết bị mới</h3>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên thiết bị (VD: Kiosk sảnh A)"
          required
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hệ điều hành kiosk</label>
          <select
            value={os}
            onChange={(e) => setOs(e.target.value as DesktopOs)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="mac">macOS</option>
            <option value="win">Windows</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={registering}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-50"
        >
          {registering ? 'Đang đăng ký...' : 'Đăng ký thiết bị'}
        </button>
      </form>

      {confirmRevoke && (
        <RevokeConfirmModal
          device={confirmRevoke}
          onClose={() => setConfirmRevoke(null)}
          onConfirm={() => {
            const device = confirmRevoke;
            setConfirmRevoke(null);
            void doRevoke(device);
          }}
        />
      )}
    </div>
  );
}

/**
 * "Thu hồi" confirmation (2026-09-08) — same plain confirm/cancel shape as
 * the old `ReissueConfirmModal` it replaces (reused `ModalShell` for the
 * same visual language), but now guarding the one action that's actually
 * destructive: unlike reissue, revoking really does lock out a running
 * kiosk immediately, with no overlap and no way back except cấp gói kích
 * hoạt mới (reissue).
 */
function RevokeConfirmModal({
  device,
  onClose,
  onConfirm,
}: {
  device: Device;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={`Thu hồi "${device.name}"`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Thu hồi sẽ vô hiệu <strong>NGAY</strong> mọi mã của thiết bị này; kiosk đang chạy sẽ bị khoá cho tới khi được
          cấp gói kích hoạt mới ("Tải gói kích hoạt").
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm"
          >
            Thu hồi
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
