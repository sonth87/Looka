import { useEffect, useRef, useState } from 'react';

type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT';
type CameraRoleMapping = Partial<Record<CameraRole, string>>;

interface DeviceEntry {
  id: string;
  label: string;
}

const ROLES: CameraRole[] = ['CENTER', 'LEFT', 'RIGHT'];
const ROLE_LABEL: Record<CameraRole, string> = {
  CENTER: 'Giữa (bắt buộc)',
  LEFT: 'Trái',
  RIGHT: 'Phải',
};

/**
 * Camera role assignment for CB Help — see
 * docs/plans/multi-camera-device-management-discussion.md §2.1. Mounted
 * instead of `<App />` when this window is opened with the `#camera-setup`
 * hash (see main.tsx and cameraSetupWindow.ts). Not for SV: opened only via
 * `Ctrl/Cmd+Shift+K`, in its own window, entirely separate from the capture
 * screen this doc section says it must not be confused with (`CameraSelector`
 * there just picks *a* camera; this assigns what each one *means*).
 *
 * Opens a live preview for every detected camera at once, on purpose — a
 * device label like "USB Camera 3" says nothing about which physical
 * position it is in, so CB Help has to tell them apart by sight, the same
 * way that doc section describes.
 */
export default function CameraSetupScreen() {
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [mapping, setMapping] = useState<CameraRoleMapping>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const videoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const faceAPI = (window as any).faceAPI;
        const existing = (await faceAPI?.getCameraRoleMapping?.()) ?? {};
        if (!cancelled) setMapping(existing);

        // A permission prompt for *some* camera is needed before labels are
        // populated at all — enumerateDevices() reports blank labels/ids
        // otherwise. Requesting on the first device found is enough to
        // unlock labels for the rest in the same browsing context.
        await navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop());
        });

        const all = await navigator.mediaDevices.enumerateDevices();
        const cams = all
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
        if (cancelled) return;
        setDevices(cams);

        for (const cam of cams) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: cam.id } },
            });
            if (cancelled) {
              stream.getTracks().forEach((t) => t.stop());
              continue;
            }
            streamsRef.current.set(cam.id, stream);
            const videoEl = videoRefs.current.get(cam.id);
            if (videoEl) videoEl.srcObject = stream;
          } catch (err) {
            console.error(`[CameraSetupScreen] preview failed for ${cam.id}:`, err);
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Không thể truy cập camera');
      }
    })();

    return () => {
      cancelled = true;
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streamsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignRole = (deviceId: string, role: CameraRole | '') => {
    setMapping((prev) => {
      // Each role belongs to at most one device — clear it from wherever it
      // was before giving it to this one.
      const next: CameraRoleMapping = {};
      for (const r of ROLES) {
        if (prev[r] && prev[r] !== deviceId) next[r] = prev[r];
      }
      if (role) next[role] = deviceId;
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    const faceAPI = (window as any).faceAPI;
    await faceAPI?.setCameraRoleMapping?.(mapping);
    setSaved(true);
  };

  const roleForDevice = (deviceId: string): CameraRole | '' =>
    ROLES.find((r) => mapping[r] === deviceId) ?? '';

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 p-8 overflow-y-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Gán vai trò camera</h1>
        <p className="text-slate-400 mt-1">
          Chọn camera nào là Giữa/Trái/Phải bằng cách xem preview trực tiếp bên dưới.
        </p>
      </header>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {devices.map((device) => (
          <div key={device.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <video
              ref={(el) => {
                videoRefs.current.set(device.id, el);
                if (el && streamsRef.current.has(device.id)) el.srcObject = streamsRef.current.get(device.id)!;
              }}
              autoPlay
              muted
              playsInline
              className="w-full aspect-video rounded-xl bg-black object-cover"
            />
            <p className="mt-2 text-sm text-slate-300 truncate" title={device.label}>
              {device.label}
            </p>
            <select
              value={roleForDevice(device.id)}
              onChange={(e) => assignRole(device.id, e.target.value as CameraRole | '')}
              className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Chưa gán</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {devices.length === 0 && !error && (
        <p className="text-slate-500">Đang tìm camera...</p>
      )}

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold"
        >
          Lưu
        </button>
        {saved && <span className="text-emerald-400 text-sm">Đã lưu</span>}
      </div>
    </div>
  );
}
