import { useEffect, useRef, useState } from 'react';
import { CAMERA_ROLES, defaultCameraRoleForStepType, type CameraRole, type CaptureStep } from '@face/core';
import { getSettings, updateSettings } from '@face/ui';
import type { CaptureTriggerMode } from '@face/core';

type CameraRoleMapping = Partial<Record<CameraRole, string>>;

interface DeviceEntry {
  id: string;
  label: string;
}

/**
 * One role the active campaign actually needs a frame for, plus which step
 * type(s) drove that need (e.g. `['FRONT']`) — shown next to the role's
 * label so CB Help can tell "Giữa" apart from "Giữa (FRONT)" at a glance.
 * Empty `stepTypes` means "needed" only because there is no campaign to ask
 * (the all-five fallback below), not because a real step demands it.
 */
interface RoleNeed {
  role: CameraRole;
  stepTypes: string[];
}

const ROLES: CameraRole[] = [...CAMERA_ROLES];
const ROLE_LABEL: Record<CameraRole, string> = {
  CENTER: 'Giữa (bắt buộc)',
  LEFT: 'Trái',
  RIGHT: 'Phải',
  UP: 'Trên',
  DOWN: 'Dưới',
};

/** Every role, un-derived — the safe fallback for a web/dev build with no campaign activated at all. */
const ALL_ROLES_NEEDED: RoleNeed[] = ROLES.map((role) => ({ role, stepTypes: [] }));

/**
 * Which roles the *current* campaign needs a camera for, in the order its
 * steps list them. Mirrors `framesForWorkflow` in
 * packages/ui/src/lib/multiFrame.ts (not imported directly: that helper wants
 * a full `CaptureWorkflow`, this screen only ever has the campaign's raw
 * `captureAngles` step list, and the derivation itself is two lines) — same
 * rule: `step.cameraRole` wins when the campaign set one explicitly,
 * otherwise `defaultCameraRoleForStepType(step.type)`.
 */
function deriveNeededRoles(steps: CaptureStep[]): RoleNeed[] {
  const order: CameraRole[] = [];
  const stepTypesByRole = new Map<CameraRole, string[]>();
  for (const step of steps) {
    const role = step.cameraRole ?? defaultCameraRoleForStepType(step.type);
    let types = stepTypesByRole.get(role);
    if (!types) {
      types = [];
      stepTypesByRole.set(role, types);
      order.push(role);
    }
    if (!types.includes(step.type)) types.push(step.type);
  }
  return order.map((role) => ({ role, stepTypes: stepTypesByRole.get(role)! }));
}

/**
 * Camera-to-angle assignment for CB Help — see
 * docs/plans/multi-camera-device-management-discussion.md §3.6 for the
 * 2026-09-05 product decision this screen implements: "Gán camera cho các
 * góc, chứ không phải các góc cho camera." One row per capture angle the
 * active campaign needs, not one tile per detected camera — the previous
 * layout (one tile per camera, pick its role from a dropdown) made it easy to
 * leave a required angle unassigned since nothing on screen was organized by
 * angle, and gave no feedback when two angles ended up sharing one camera.
 * Mounted instead of `<App />` when this window is opened with the
 * `#camera-setup` hash (see main.tsx and cameraSetupWindow.ts). Not for SV:
 * opened only via `Ctrl/Cmd+Shift+K`, in its own window, entirely separate
 * from the capture screen this doc section says it must not be confused with
 * (`CameraSelector` there just picks *a* camera; this assigns what each one
 * *means*).
 *
 * Opens a live preview for every detected camera at once (one stream per
 * device, never opened twice — see the mount effect below), so CB Help can
 * tell physical cameras apart by sight rather than by an opaque label like
 * "USB Camera 3". A camera may be assigned to at most one role: picking an
 * already-used camera for a new role *moves* it there (cleared from the role
 * that had it) rather than blocking the change, with a short inline note so
 * the move isn't silent.
 */
export default function CameraSetupScreen() {
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [mapping, setMapping] = useState<CameraRoleMapping>({});
  const [neededRoles, setNeededRoles] = useState<RoleNeed[]>(ALL_ROLES_NEEDED);
  const [otherOpen, setOtherOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  // "Cách chụp" / "Kích hoạt chụp" (§3.9) — kiosk-local settings, no longer
  // read from the campaign. Sequencing persists via secrets.dat (mirrors
  // camera.roleMapping's own persistence); capture mode/gestures reuse the
  // existing @face/ui settingsStore (packages/ui/src/lib/settingsStore.ts),
  // just given a proper home in this screen per the plan's instruction.
  const [sequencing, setSequencing] = useState<'sequential' | 'simultaneous'>('sequential');
  const [captureMode, setCaptureModeState] = useState<CaptureTriggerMode>('MANUAL');
  const [allowGesture, setAllowGesture] = useState(false);
  const [autoHoldMs, setAutoHoldMs] = useState(1500);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const videoRefs = useRef<Map<CameraRole, HTMLVideoElement | null>>(new Map());
  const cancelledRef = useRef(false);
  // Synchronous mirror of `mapping` — read from the async device-enumeration
  // loop below, which cannot wait on a `mapping`-dependent effect to catch up
  // without risking a stale read the one time it matters (attaching a
  // just-opened stream to the row of the role it's already assigned to).
  const mappingRef = useRef<CameraRoleMapping>({});

  useEffect(() => {
    const settings = getSettings();
    setCaptureModeState(settings.captureMode ?? 'MANUAL');
    setAllowGesture((settings.allowedGestures?.length ?? 0) > 0);
    setAutoHoldMs(settings.autoHoldMs ?? 1500);
    const faceAPI = (window as any).faceAPI;
    faceAPI?.getCaptureSequencing?.().then((v: 'sequential' | 'simultaneous') => {
      if (v) setSequencing(v);
    });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    /** The campaign's `captureAngles`, or "no campaign" — see resolveActiveWorkflow in FaceCaptureApp.tsx for the same fetch/fallback shape. */
    async function loadNeededRoles() {
      try {
        const faceAPI = (window as any).faceAPI;
        const status = await faceAPI?.getDeviceAccessStatus?.();
        const steps = status?.config?.captureAngles;
        if (!cancelledRef.current && Array.isArray(steps) && steps.length > 0) {
          setNeededRoles(deriveNeededRoles(steps));
        }
        // Else: leave the all-five fallback in place (no campaign, or the
        // admin portal is unreachable) — same fail-open reasoning as
        // FaceCaptureApp's resolveActiveWorkflow.
      } catch (err) {
        console.error('[CameraSetupScreen] campaign config fetch failed, defaulting to all roles:', err);
      }
    }

    /**
     * Re-enumerates devices and reconciles streams against the new list:
     * opens one for every newly seen device, stops and drops one for every
     * device that disappeared. Never touches a stream for a device that's
     * still present, so unrelated previews don't flicker just because some
     * other camera came or went. Called once at mount and again on every
     * `devicechange` (plug/unplug while this window is open — previously
     * only ran once at mount, reported as a bug).
     */
    async function refreshDevices() {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      if (cancelledRef.current) return;
      setDevices(cams);

      const currentIds = new Set(cams.map((c) => c.id));
      for (const [id, stream] of streamsRef.current) {
        if (currentIds.has(id)) continue;
        stream.getTracks().forEach((t) => t.stop());
        streamsRef.current.delete(id);
        // The row showing this now-unplugged device would otherwise keep
        // displaying its last frame forever — clear it so the "mất kết nối"
        // status text isn't contradicted by a still-live-looking preview.
        const role = ROLES.find((r) => mappingRef.current[r] === id);
        const el = role ? videoRefs.current.get(role) : null;
        if (el) el.srcObject = null;
      }

      for (const cam of cams) {
        if (streamsRef.current.has(cam.id)) continue; // never open the same device twice
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cam.id } },
          });
          if (cancelledRef.current) {
            stream.getTracks().forEach((t) => t.stop());
            continue;
          }
          streamsRef.current.set(cam.id, stream);
          const role = ROLES.find((r) => mappingRef.current[r] === cam.id);
          const el = role ? videoRefs.current.get(role) : null;
          if (el) el.srcObject = stream;
        } catch (err) {
          console.error(`[CameraSetupScreen] preview failed for ${cam.id}:`, err);
        }
      }
    }

    function onDeviceChange() {
      void refreshDevices();
    }

    (async () => {
      try {
        const faceAPI = (window as any).faceAPI;
        const existing = (await faceAPI?.getCameraRoleMapping?.()) ?? {};
        if (!cancelledRef.current) {
          mappingRef.current = existing;
          setMapping(existing);
        }

        // A permission prompt for *some* camera is needed before labels are
        // populated at all — enumerateDevices() reports blank labels/ids
        // otherwise. Requesting on the first device found is enough to
        // unlock labels for the rest in the same browsing context.
        await navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop());
        });

        await refreshDevices();
        navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      } catch (err) {
        if (!cancelledRef.current) setError((err as Error).message || 'Không thể truy cập camera');
      }
    })();

    void loadNeededRoles();

    return () => {
      cancelledRef.current = true;
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streamsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!moveNotice) return;
    const id = setTimeout(() => setMoveNotice(null), 4000);
    return () => clearTimeout(id);
  }, [moveNotice]);

  /**
   * Assigns `deviceId` to `role` ("" clears it). A camera can back at most
   * one role: if it's already assigned elsewhere, this moves it here and
   * leaves `moveNotice` for the banner near the header — the alternative
   * (block the change instead) was considered and rejected, see this
   * function's own file-level doc comment.
   */
  const assignRole = (role: CameraRole, deviceId: string) => {
    const movedFrom = deviceId ? ROLES.find((r) => r !== role && mapping[r] === deviceId) : undefined;
    setMapping((prev) => {
      const next: CameraRoleMapping = { ...prev };
      delete next[role];
      if (deviceId) {
        for (const r of ROLES) {
          if (r !== role && next[r] === deviceId) delete next[r];
        }
        next[role] = deviceId;
      }
      mappingRef.current = next;
      return next;
    });
    setSaved(false);
    setMoveNotice(
      movedFrom
        ? `${devices.find((d) => d.id === deviceId)?.label ?? 'Camera này'} đã được chuyển từ "${ROLE_LABEL[movedFrom]}" sang "${ROLE_LABEL[role]}".`
        : null
    );
  };

  const handleSave = async () => {
    const faceAPI = (window as any).faceAPI;
    await faceAPI?.setCameraRoleMapping?.(mapping);
    await faceAPI?.setCaptureSequencing?.(sequencing);
    updateSettings({
      captureMode,
      autoHoldMs,
      allowedGestures: allowGesture ? ['VICTORY', 'THUMBS_UP', 'OPEN_PALM'] : [],
    });
    setSaved(true);
  };

  const otherRoles = ROLES.filter((r) => !neededRoles.some((n) => n.role === r));

  // Warning banner: a needed role still has no connected camera, or two
  // needed roles resolve to the same physical device — exactly what
  // `checkFramesReadiness` (packages/ui/src/lib/multiFrame.ts) treats as
  // blocking a simultaneous-capture session.
  const missingNeeded = neededRoles.filter((n) => {
    const id = mapping[n.role];
    return !id || !devices.some((d) => d.id === id);
  });
  const neededDeviceUse = new Map<string, CameraRole[]>();
  for (const n of neededRoles) {
    const id = mapping[n.role];
    if (!id || !devices.some((d) => d.id === id)) continue;
    const list = neededDeviceUse.get(id) ?? [];
    list.push(n.role);
    neededDeviceUse.set(id, list);
  }
  const duplicateGroups = Array.from(neededDeviceUse.values()).filter((list) => list.length > 1);

  const warnings: string[] = [];
  if (missingNeeded.length > 0) {
    warnings.push(`Còn thiếu camera cho: ${missingNeeded.map((n) => ROLE_LABEL[n.role]).join(', ')}.`);
  }
  for (const group of duplicateGroups) {
    warnings.push(
      `${group.map((r) => ROLE_LABEL[r]).join(' và ')} đang dùng chung một camera — mỗi góc cần một camera riêng để chụp đồng thời.`
    );
  }

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 p-8 overflow-y-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Gán camera cho từng góc chụp</h1>
        <p className="text-slate-400 mt-1">
          Mỗi góc chụp cần một camera riêng — chọn camera cho từng góc bằng cách xem preview trực tiếp bên dưới.
        </p>
        <p className="text-slate-500 mt-1 text-sm">
          Chiến dịch chụp đồng thời cần mỗi góc một camera khác nhau; nếu hai góc dùng chung một camera, phiên chụp sẽ
          bị chặn.
        </p>
      </header>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">{error}</div>
      )}

      {warnings.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {moveNotice && (
        <div className="mb-6 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm">
          {moveNotice}
        </div>
      )}

      {devices.length === 0 && !error && <p className="text-slate-500 mb-4">Đang tìm camera...</p>}

      <div className="space-y-4">
        {neededRoles.map((need) => (
          <RoleRow
            key={need.role}
            role={need.role}
            need={need}
            mapping={mapping}
            devices={devices}
            videoRefs={videoRefs}
            streamsRef={streamsRef}
            onAssign={assignRole}
          />
        ))}
      </div>

      {otherRoles.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setOtherOpen((v) => !v)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {otherOpen ? '▾' : '▸'} Góc khác ({otherRoles.length})
          </button>
          {otherOpen && (
            <div className="mt-3 space-y-4">
              {otherRoles.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  mapping={mapping}
                  devices={devices}
                  videoRefs={videoRefs}
                  streamsRef={streamsRef}
                  onAssign={assignRole}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-slate-800 space-y-5">
        <div>
          <p className="font-semibold mb-2">Cách chụp</p>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={sequencing === 'sequential'}
                onChange={() => setSequencing('sequential')}
              />
              Tuần tự — từng ảnh một
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={sequencing === 'simultaneous'}
                onChange={() => setSequencing('simultaneous')}
              />
              Đồng thời — nhiều camera bấm cùng lúc mỗi vòng
            </label>
          </div>
        </div>

        <div>
          <p className="font-semibold mb-2">Kích hoạt chụp</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={captureMode === 'AUTO'} onChange={() => setCaptureModeState('AUTO')} />
              Tự động — giữ tư thế
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={captureMode !== 'AUTO'}
                onChange={() => setCaptureModeState(allowGesture ? 'MANUAL' : 'OFF')}
              />
              Thủ công — bấm nút
            </label>
            {captureMode !== 'AUTO' && (
              <label className="flex items-center gap-2 text-slate-400">
                <input
                  type="checkbox"
                  checked={allowGesture}
                  onChange={(e) => {
                    setAllowGesture(e.target.checked);
                    setCaptureModeState(e.target.checked ? 'MANUAL' : 'OFF');
                  }}
                />
                Cho phép cử chỉ tay
              </label>
            )}
            {captureMode === 'AUTO' && (
              <label className="flex items-center gap-2 text-slate-400">
                Giữ tư thế
                <input
                  type="number"
                  min={500}
                  max={3000}
                  step={100}
                  value={autoHoldMs}
                  onChange={(e) => setAutoHoldMs(Number(e.target.value))}
                  className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                />
                ms
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold"
          >
            Lưu
          </button>
          {saved && <span className="text-emerald-400 text-sm">Đã lưu</span>}
        </div>
      </div>
    </div>
  );
}

interface RoleRowProps {
  role: CameraRole;
  need?: RoleNeed;
  mapping: CameraRoleMapping;
  devices: DeviceEntry[];
  videoRefs: React.MutableRefObject<Map<CameraRole, HTMLVideoElement | null>>;
  streamsRef: React.MutableRefObject<Map<string, MediaStream>>;
  onAssign: (role: CameraRole, deviceId: string) => void;
}

/** One capture-angle row: live preview of whatever camera is currently assigned, plus the `<select>` that assigns it. */
function RoleRow({ role, need, mapping, devices, videoRefs, streamsRef, onAssign }: RoleRowProps) {
  const deviceId = mapping[role] ?? '';
  const connected = !!deviceId && devices.some((d) => d.id === deviceId);

  return (
    <div className="flex gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <video
        ref={(el) => {
          videoRefs.current.set(role, el);
          if (el && deviceId && streamsRef.current.has(deviceId)) el.srcObject = streamsRef.current.get(deviceId)!;
        }}
        autoPlay
        muted
        playsInline
        className="w-56 aspect-video rounded-xl bg-black object-cover shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">
          {ROLE_LABEL[role]}
          {need && need.stepTypes.length > 0 && (
            <span className="ml-2 text-xs font-normal text-slate-400">({need.stepTypes.join(', ')})</span>
          )}
        </p>
        <p className={`mt-1 text-xs ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
          {!deviceId ? 'Chưa gán camera' : connected ? 'Đã kết nối' : 'Camera đã gán bị mất kết nối'}
        </p>
        <select
          value={deviceId}
          onChange={(e) => onAssign(role, e.target.value)}
          className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Chưa gán</option>
          {deviceId && !connected && <option value={deviceId}>Camera đã gán (mất kết nối)</option>}
          {devices.map((d) => {
            const usedBy = ROLES.find((r) => r !== role && mapping[r] === d.id);
            return (
              <option key={d.id} value={d.id}>
                {d.label}
                {usedBy ? ` — đang dùng cho ${ROLE_LABEL[usedBy]}` : ''}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}
