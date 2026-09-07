import { useState, type FormEvent } from 'react';
import { CheckCircle2, Images, RefreshCw } from 'lucide-react';
import { activateDevice, ApiError, Device, DesktopOs, registerDevice, reissueDevice } from '../api';
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

/**
 * Device list + registration + per-row actions for a campaign's detail page.
 * Split out of `CampaignDetail.tsx` (2026-09-07) once the device table
 * gained real per-row actions — see docs/ROADMAP.md's dated entry for the
 * full write-up of why registration no longer auto-downloads and why
 * "Tải gói kích hoạt" (labeled "reissue" in the API — `reissueDevice`)
 * exists: the plaintext device secret is never stored server-side, only its
 * hash, so a lost activation zip cannot be recovered — only reissued, by
 * rotating the secret (see `DeviceService.reissueDevice`'s own doc comment,
 * apps/api, including the 2026-09-07 note on why an already-ACTIVATED
 * device's status badge doesn't reset across this action anymore).
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
  const [confirmReissue, setConfirmReissue] = useState<Device | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

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
   * unlike reissue, nothing gets revoked.
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

  /** ACTIVATED devices need a confirm step first — reissuing revokes the running kiosk's credentials immediately. A REGISTERED device has nothing running yet, so nothing to confirm. */
  const requestReissue = (device: Device) => {
    if (device.status === 'ACTIVATED') {
      setConfirmReissue(device);
      return;
    }
    void doReissue(device);
  };

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-900">Thiết bị ({devices.length})</h2>

      {pending && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>
            {pending.kind === 'registered'
              ? `Đã đăng ký thiết bị «${pending.deviceName}». Gói kích hoạt đã sẵn sàng.`
              : `Đã tải gói kích hoạt mới cho «${pending.deviceName}».`}
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
          {devices.map((d) => (
            <tr key={d.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-900">{d.name}</td>
              <td className="py-2 pr-3">
                <span className={d.status === 'ACTIVATED' ? 'text-emerald-600' : 'text-amber-600'}>
                  {d.status === 'ACTIVATED' ? 'Đã kích hoạt' : 'Chưa kích hoạt'}
                </span>
                {!d.authApiEndpoint?.trim() && (
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs align-middle"
                    title="Thiết bị này chưa có địa chỉ API — kiosk sẽ không bao giờ lấy được cấu hình campaign mới. Bấm 'Tải gói kích hoạt' để khắc phục."
                  >
                    Thiếu API endpoint
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-gray-500">
                {d.activatedAt ? new Date(d.activatedAt).toLocaleString('vi-VN') : '—'}
              </td>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-1">
                  {onViewCaptures && (
                    <IconButton
                      icon={Images}
                      label="Xem ảnh đã chụp"
                      onClick={() => onViewCaptures(d.id)}
                    />
                  )}
                  {d.status !== 'ACTIVATED' && (
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
                    onClick={() => requestReissue(d)}
                    disabled={reissuingId === d.id}
                    tone="primary"
                  />
                </div>
              </td>
            </tr>
          ))}
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

      {confirmReissue && (
        <ReissueConfirmModal
          device={confirmReissue}
          onClose={() => setConfirmReissue(null)}
          onConfirm={() => {
            const device = confirmReissue;
            setConfirmReissue(null);
            void doReissue(device);
          }}
        />
      )}
    </div>
  );
}

/**
 * Plain confirm/cancel modal, not a typed-name confirmation like
 * `CampaignDangerActions`' campaign-delete flow — reissuing one already-
 * activated device revokes its current credentials, but that's recoverable
 * by reissuing again if needed, unlike an irreversible campaign delete, so
 * that much friction would be disproportionate here. Reuses `ModalShell` for
 * the same visual language rather than a bare `window.confirm()`, which this
 * codebase otherwise never uses.
 */
function ReissueConfirmModal({
  device,
  onClose,
  onConfirm,
}: {
  device: Device;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={`Tải gói kích hoạt cho "${device.name}"`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Thiết bị này <strong>đã kích hoạt</strong>. Tải gói kích hoạt mới sẽ vô hiệu hoá ngay mã bí mật hiện tại —
          kiosk đang chạy với mã cũ sẽ không xác thực được nữa cho đến khi nạp gói kích hoạt mới.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm"
          >
            Tải gói kích hoạt
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
