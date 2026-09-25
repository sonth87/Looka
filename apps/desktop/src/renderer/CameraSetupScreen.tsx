import { useEffect, useRef, useState } from 'react';
import { CAMERA_ROLES, defaultCameraRoleForStepType, type CameraRole, type CaptureStep } from '@face/core';
import {
  applyKioskTheme,
  Badge,
  Button,
  Card,
  CAPTURE_MIRRORED,
  CompositionGridOverlay,
  DEFAULT_PHYSICAL_ANGLES,
  getStoredKioskTheme,
  type BadgeVariant,
  type PhysicalCameraAngles,
} from '@face/ui';
import { TetheredCameraPanel } from './TetheredCameraPanel';

type CameraRoleMapping = Partial<Record<CameraRole, string>>;
/** Every role's *effective* physical mounting angle — always fully populated (defaults filled in), unlike the sparse override map this screen saves/loads. */
type PhysicalAngleState = Record<CameraRole, PhysicalCameraAngles>;

/** One logical camera role's CB Help visibility/order — mirrors `secrets.ts`'s `CbHelpCameraVisibility`. */
interface CbHelpCameraVisibility {
  visible: boolean;
  order: number;
}
type CbHelpVisibilityMap = Partial<Record<CameraRole, CbHelpCameraVisibility>>;
/** Every role's *effective* CB Help visibility/order — always fully populated, same "defaults filled in" reasoning as `PhysicalAngleState`. Mirrors `secrets.ts`'s `DEFAULT_CB_HELP_VISIBILITY`/`resolveCbHelpVisibility` — duplicated rather than imported since this renderer file cannot reach the main process's `secrets.ts` directly, same convention every other `faceAPI`-backed setting on this screen already follows. */
type CbHelpVisibilityState = Record<CameraRole, CbHelpCameraVisibility>;
const DEFAULT_CB_HELP_VISIBILITY: CbHelpVisibilityState = {
  CENTER: { visible: true, order: 0 },
  LEFT: { visible: false, order: 1 },
  RIGHT: { visible: false, order: 2 },
  UP: { visible: false, order: 3 },
  DOWN: { visible: false, order: 4 },
};

/** Audio-calibration volumes ("Hệ thống âm thanh & loa thông báo") — mirrors preload's/`secrets.ts`'s `AudioVolumeSettings`. Duplicated rather than imported, same convention as every other `faceAPI`-backed setting on this screen. */
interface AudioVolumeSettings {
  voicePct: number;
  alertPct: number;
}
const DEFAULT_AUDIO_VOLUME: AudioVolumeSettings = { voicePct: 80, alertPct: 60 };

interface DeviceEntry {
  id: string;
  label: string;
}

/**
 * Tethered Canon (gphoto2) — docs/plans/canon-tethered-capture-plan-2026-09-21.md
 * Bước 4. A synthetic device id, same `CameraRoleMapping` string shape a
 * real webcam `deviceId` already uses, so no data-shape change was needed
 * to make it assignable to a role. Only ever added to `devices` once a
 * "Kiểm tra kết nối" check confirms it's actually reachable (not polled
 * automatically — each check spawns a real `gphoto2` subprocess, so this
 * stays on-demand rather than a background timer).
 */
const TETHERED_DEVICE_ID = 'tethered:gphoto2';

interface TetheredCameraStatus {
  connected: boolean;
  model?: string;
  error?: string;
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
 * Plays a short synthesized tone via the Web Audio API, standing in for
 * "Test Speak"/"Test Beep" — there is no existing voice-prompt/alert audio
 * asset anywhere in this repo (checked `apps/desktop/` and `packages/` for
 * `.mp3`/`.wav`/`.ogg`) and adding a real recorded asset is out of scope for
 * this pass, so a synthesized tone is the least-effort stand-in until a real
 * voice-prompt asset exists. `kind` picks a distinguishable frequency/
 * duration pair so the two test buttons are told apart by ear, not just by
 * label. `volumePct` (0-100) is scaled down (`* 0.3` headroom) so a 100%
 * setting doesn't blast the kiosk speakers at full gain during a quick test.
 */
function playTestTone(kind: 'voice' | 'alert', volumePct: number) {
  try {
    const AudioContextCtor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'voice' ? 440 : 880;
    gain.gain.value = (Math.max(0, Math.min(100, volumePct)) / 100) * 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const durationMs = kind === 'voice' ? 550 : 220;
    setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, durationMs);
  } catch (err) {
    console.error('[CameraSetupScreen] test tone failed:', err);
  }
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
 *
 * Reskinned (ui-redesign-plan.md, "CameraSetupScreen (cửa sổ riêng)" section)
 * to the navy/cyan kiosk theme as a 2-column card grid (`RoleCard`, replacing
 * the old vertical `RoleRow` list), and gained a new "Hệ thống âm thanh & loa
 * thông báo" section (`AudioVolumeRow`) — all device-enumeration/role-
 * assignment/save logic below is unchanged, only the render layer and the
 * new audio-volume state are new.
 */
export default function CameraSetupScreen() {
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [mapping, setMapping] = useState<CameraRoleMapping>({});
  // Physical mounting angle (§3.9, item 2 2026-09-09) — "góc lắp camera",
  // separate from `mapping` (which camera plays a role): this is how far off
  // straight-ahead that role's camera is actually bolted, which
  // `planCaptureRounds` (packages/ui/src/lib/multiFrame.ts) needs to
  // translate a step's subject-facing pose target into the correct gate pose
  // for whichever physical camera resolves that step. Always fully
  // populated with `DEFAULT_PHYSICAL_ANGLES` until the saved override (if
  // any) for a role is loaded, so every input always shows a sensible value
  // rather than blank/0.
  const [physicalAngles, setPhysicalAngles] = useState<PhysicalAngleState>({ ...DEFAULT_PHYSICAL_ANGLES });
  const [neededRoles, setNeededRoles] = useState<RoleNeed[]>(ALL_ROLES_NEEDED);
  const [otherOpen, setOtherOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  // "Cách chụp" (§3.9) — kiosk-local setting, no longer read from the
  // campaign. Persists via secrets.dat (mirrors camera.roleMapping's own
  // persistence). "Kích hoạt chụp" (capture-trigger mode/gesture) used to
  // live here too, saved to the @face/ui settingsStore — removed 2026-09-09
  // as a straight duplicate of the "Chế độ chụp" control already in the
  // live capture screen's own overlay (`OverlayConfigPanel.tsx`), just a
  // confusing one: that overlay's control only ever changed the current
  // session in memory (no durable save), while this screen's version was
  // the only thing writing a durable default — two controls that looked
  // equivalent but behaved differently. Product decision: no durable
  // default is needed at all going forward, so this whole control is gone
  // rather than made to persist too.
  const [sequencing, setSequencing] = useState<'sequential' | 'simultaneous'>('sequential');
  /** CB Help "hiện trên màn mở rộng" + thứ tự per role (2026-09-10) — same "always fully populated, defaults filled in" shape as `physicalAngles`. */
  const [cbHelpVisibility, setCbHelpVisibility] = useState<CbHelpVisibilityState>({ ...DEFAULT_CB_HELP_VISIBILITY });
  /** "Lưới 3x3" (2026-09-10) — see secrets.ts's `getGrid3x3Enabled` doc comment. */
  const [grid3x3, setGrid3x3] = useState(false);
  /** Audio-calibration volumes — new (ui-redesign-plan.md), persisted via `faceAPI.getAudioVolume/setAudioVolume`, independent of the camera settings' "Lưu" button (saved on slider release instead, see `commitAudioVolume`). */
  const [audioVolume, setAudioVolume] = useState<AudioVolumeSettings>({ ...DEFAULT_AUDIO_VOLUME });
  /**
   * Tethered Canon (gphoto2) test panel state — Bước 0/4, all on-demand
   * (button-triggered), no background polling. `null` = not checked yet
   * this session. Only `tetheredStatus` itself lives here (needed below for
   * `assignableDevices`); the once-a-second live-view frame/capture-test
   * state now lives inside `TetheredCameraPanel` itself (2026-09-22 —
   * moved out so that state's frequent updates no longer re-render this
   * whole screen, including every `RoleCard`, once a second).
   */
  const [tetheredChecking, setTetheredChecking] = useState(false);
  const [tetheredStatus, setTetheredStatus] = useState<TetheredCameraStatus | null>(null);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  /**
   * 2026-09-23 ("camera được kết nối đang không hiển thị") — a `getUserMedia`
   * failure inside `refreshDevices()` below used to only `console.error`,
   * invisibly: the role card still showed "Đã kết nối" (which only checks
   * the device is enumerated, not that its preview actually opened) over a
   * plain black box, with no way to tell why short of opening DevTools. Real
   * case found this way: the MAIN kiosk window's own device-init preview
   * (`CampaignGate.tsx`) was already holding the same physical camera open —
   * now also fixed at the source (`camera:pauseForSetup`/`...ResumeAfterSetup`
   * IPC), but ANY other cause of the same failure (another app holding the
   * camera, a stale handle) should surface here too, not just that one.
   */
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const videoRefs = useRef<Map<CameraRole, HTMLVideoElement | null>>(new Map());
  const cancelledRef = useRef(false);
  // Synchronous mirror of `mapping` — read from the async device-enumeration
  // loop below, which cannot wait on a `mapping`-dependent effect to catch up
  // without risking a stale read the one time it matters (attaching a
  // just-opened stream to the row of the role it's already assigned to).
  const mappingRef = useRef<CameraRoleMapping>({});
  // Synchronous mirror of `audioVolume`, read by `commitAudioVolume` (fired
  // from a slider's onMouseUp/onTouchEnd/onKeyUp handler) so the save always
  // sees the latest dragged value rather than whatever was captured in the
  // handler's closure at render time.
  const audioVolumeRef = useRef<AudioVolumeSettings>(audioVolume);

  useEffect(() => {
    audioVolumeRef.current = audioVolume;
  }, [audioVolume]);

  // This screen opens in its own Electron `BrowserWindow` (no shared
  // `KioskShell`/`KioskHeader`), so it doesn't get the toggle button's
  // effect automatically — apply whatever theme was last chosen in the main
  // window (same origin, shared `localStorage`) so the two windows don't
  // visually diverge.
  useEffect(() => {
    applyKioskTheme(getStoredKioskTheme());
  }, []);

  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    faceAPI?.getCaptureSequencing?.().then((v: 'sequential' | 'simultaneous') => {
      if (v) setSequencing(v);
    });
    faceAPI?.getCbHelpVisibility?.().then((saved: CbHelpVisibilityMap) => {
      if (!saved) return;
      setCbHelpVisibility((prev) => {
        const next = { ...prev };
        for (const role of ROLES) {
          if (saved[role]) next[role] = saved[role]!;
        }
        return next;
      });
    });
    faceAPI?.getGrid3x3Enabled?.().then((v: boolean) => setGrid3x3(!!v));
    faceAPI?.getAudioVolume?.().then((v: Partial<AudioVolumeSettings> | undefined) => {
      if (!v) return;
      setAudioVolume({
        voicePct: typeof v.voicePct === 'number' ? v.voicePct : DEFAULT_AUDIO_VOLUME.voicePct,
        alertPct: typeof v.alertPct === 'number' ? v.alertPct : DEFAULT_AUDIO_VOLUME.alertPct,
      });
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
          setPreviewErrors((prev) => {
            if (!(cam.id in prev)) return prev;
            const next = { ...prev };
            delete next[cam.id];
            return next;
          });
        } catch (err) {
          console.error(`[CameraSetupScreen] preview failed for ${cam.id}:`, err);
          const name = err instanceof DOMException ? err.name : undefined;
          const friendly =
            name === 'NotReadableError'
              ? 'Camera đang được dùng ở nơi khác (cửa sổ hoặc ứng dụng khác) — đóng nơi đó rồi thử lại.'
              : name === 'NotAllowedError'
              ? 'Chưa được cấp quyền truy cập camera này.'
              : (err as Error).message || name || 'Không mở được camera này.';
          setPreviewErrors((prev) => ({ ...prev, [cam.id]: friendly }));
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

        const savedAngles = (await faceAPI?.getCameraPhysicalAngles?.()) ?? {};
        if (!cancelledRef.current) {
          setPhysicalAngles((prev) => {
            const next = { ...prev };
            for (const role of ROLES) {
              if (savedAngles[role]) next[role] = savedAngles[role];
            }
            return next;
          });
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
   * one role, so if it's already assigned elsewhere this is a genuine SWAP
   * (2026-09-21, plan item 9/D2) rather than a move-and-clear: `role`
   * receives `deviceId`, and whatever camera `role` held before (if any)
   * goes to the role that used to hold `deviceId` — so the operator never
   * ends up with a role silently emptied out as a side effect of assigning
   * a camera somewhere else. Clearing `role` outright (`deviceId === ''`)
   * is not a swap — nothing else changes.
   *
   * A previous version of this function only ever cleared the donor role,
   * never refilled it — confirmed live as the root cause of item 9's "swap
   * displays wrong": clearing (not swapping) the donor role could leave the
   * mapping with no CENTER at all, which `resolveStepCamera`
   * (packages/ui/src/lib/multiFrame.ts) then silently resolves to the wrong
   * physical camera for every FRONT-type step. See `handleSave`'s CENTER
   * check below for the other half of that fix.
   */
  const assignRole = (role: CameraRole, deviceId: string) => {
    const movedFrom = deviceId ? ROLES.find((r) => r !== role && mapping[r] === deviceId) : undefined;
    const previousDeviceId = mapping[role];
    setMapping((prev) => {
      const next: CameraRoleMapping = { ...prev };
      if (deviceId) {
        next[role] = deviceId;
        if (movedFrom) {
          if (previousDeviceId) next[movedFrom] = previousDeviceId;
          else delete next[movedFrom];
        }
      } else {
        delete next[role];
      }
      mappingRef.current = next;
      return next;
    });
    setSaved(false);
    if (!movedFrom) {
      setMoveNotice(null);
    } else if (previousDeviceId) {
      const movedLabel = devices.find((d) => d.id === deviceId)?.label ?? 'Camera này';
      const swappedLabel = devices.find((d) => d.id === previousDeviceId)?.label ?? 'Camera kia';
      setMoveNotice(
        `Đã đổi chỗ: "${movedLabel}" chuyển sang "${ROLE_LABEL[role]}", "${swappedLabel}" chuyển sang "${ROLE_LABEL[movedFrom]}".`
      );
    } else {
      const movedLabel = devices.find((d) => d.id === deviceId)?.label ?? 'Camera này';
      setMoveNotice(`${movedLabel} đã được chuyển từ "${ROLE_LABEL[movedFrom]}" sang "${ROLE_LABEL[role]}".`);
    }
  };

  const handleAngleChange = (role: CameraRole, axis: 'yaw' | 'pitch', value: number) => {
    setPhysicalAngles((prev) => ({ ...prev, [role]: { ...prev[role], [axis]: value } }));
    setSaved(false);
  };

  const handleCbHelpVisibilityChange = (role: CameraRole, patch: Partial<CbHelpCameraVisibility>) => {
    setCbHelpVisibility((prev) => ({ ...prev, [role]: { ...prev[role], ...patch } }));
    setSaved(false);
  };

  const handleSave = async () => {
    // D2 fix (2026-09-21, plan item 9): a half-finished swap used to be able
    // to persist a mapping with NO CENTER at all. With no CENTER,
    // `resolveStepCamera` (packages/ui/src/lib/multiFrame.ts) falls through
    // to a deterministic-but-wrong fallback (the first mapped role in
    // `CAMERA_ROLES` order, i.e. LEFT) for every step that would otherwise
    // resolve to CENTER — a FRONT step silently gets shot on the wrong
    // physical camera, labelled "Camera trái" instead of "Giữa". Block the
    // save outright instead of persisting that.
    if (!mapping.CENTER) {
      setError('Chưa gán camera cho "Giữa (bắt buộc)" — không thể lưu khi thiếu camera này.');
      setSaved(false);
      return;
    }
    setError(null);
    const faceAPI = (window as any).faceAPI;
    await faceAPI?.setCameraRoleMapping?.(mapping);
    await faceAPI?.setCameraPhysicalAngles?.(physicalAngles);
    await faceAPI?.setCaptureSequencing?.(sequencing);
    await faceAPI?.setCbHelpVisibility?.(cbHelpVisibility);
    await faceAPI?.setGrid3x3Enabled?.(grid3x3);
    setSaved(true);
    // Item 9 (2026-09-09): this screen only ever runs inside the
    // `#camera-setup` popup (see cameraSetupWindow.ts) — never the main
    // window — so a plain `window.close()` closes exactly this popup, no IPC
    // needed (Electron's renderer is allowed to close a window it lives in,
    // same as any browser tab closing itself). `faceAPI.closeWindow()` is
    // NOT the right call here: its `window:close` IPC handler is hardcoded
    // to `mainWindow.close()` (see main/index.ts), so calling it from this
    // screen would close the whole kiosk app instead of just this popup.
    // Delayed slightly so the operator actually sees "Đã lưu" land before
    // the window disappears, rather than it flashing shut instantly.
    setTimeout(() => window.close(), 600);
  };

  /** Persists the audio volume sliders — called on release (mouse/touch/key-up), not on every drag tick, to avoid spamming the IPC/secrets-file write while dragging. Independent of `handleSave`'s "Lưu" button by design (see the `audioVolume` state's own doc comment). */
  const commitAudioVolume = () => {
    (window as any).faceAPI?.setAudioVolume?.(audioVolumeRef.current);
  };

  /**
   * Bước 0/4 — "Kiểm tra kết nối" button. Spawns a real `gphoto2
   * --auto-detect` in the main process; deliberately on-demand (not a
   * background poll) since each check costs a real subprocess spawn. Adds
   * `TETHERED_DEVICE_ID` to the assignable device list only while a check
   * has confirmed it's actually reachable — an unplugged/undetected camera
   * is simply not offered as a role option, same as a webcam that never
   * granted permission never appears either.
   */
  const checkTetheredCamera = async () => {
    setTetheredChecking(true);
    try {
      const status = await (window as any).faceAPI?.getTetheredCameraStatus?.();
      setTetheredStatus(status ?? { connected: false, error: 'Không gọi được faceAPI.getTetheredCameraStatus' });
    } catch (err) {
      setTetheredStatus({ connected: false, error: (err as Error).message });
    } finally {
      setTetheredChecking(false);
    }
  };

  /**
   * Auto-connect on open (2026-09-23 — "tôi cần tự động connect với
   * camera, không cần ấn nút kết nối, khi nào cam không lên thì mới để kết
   * nối"): runs the exact same check as the "Kiểm tra kết nối" button, once,
   * as soon as this screen mounts — the button stays visible as the manual
   * retry path for when this first attempt doesn't find the camera (e.g.
   * not plugged in yet, asleep), not the primary way to connect anymore.
   */
  useEffect(() => {
    void checkTetheredCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * docs/plans/canon-auto-detect-polling-plan-2026-09-24.md Bước 3 — the
   * background watcher keeps polling `detectTetheredCamera()` on its own
   * schedule after this screen's one-time auto-connect above, so a
   * connect/disconnect that happens while this window stays open updates
   * the badge on its own, without the operator needing to press "Kiểm tra
   * kết nối" again. Doesn't touch `tetheredChecking` — that's the manual
   * button's own spinner, not this passive update.
   */
  useEffect(() => {
    const unsubscribe = (window as any).faceAPI?.onTetheredConnectionChanged?.((status: TetheredCameraStatus) =>
      setTetheredStatus(status)
    );
    return () => unsubscribe?.();
  }, []);

  /**
   * "mặc định cam giữa là camera" (2026-09-23) — the tethered Canon becomes
   * CENTER's camera automatically the moment it's confirmed connected
   * (auto-connect above, or a manual retry), IF AND ONLY IF CENTER doesn't
   * already have something assigned. Reads `mappingRef.current` (not
   * `mapping` in the dependency array) so this fires exactly once per
   * connected transition and never re-fires just because the operator later
   * changes CENTER's assignment themselves — an explicit prior choice
   * (loaded from the persisted mapping, or made by hand) is never
   * overridden.
   */
  useEffect(() => {
    if (tetheredStatus?.connected && !mappingRef.current.CENTER) {
      assignRole('CENTER', TETHERED_DEVICE_ID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tetheredStatus?.connected]);

  /**
   * "Cài driver WinUSB" button (2026-09-22) — opens the Zadig bundled with
   * the app itself, so the whole thing works from the downloaded app
   * folder alone, no separate online download needed on a fresh kiosk PC.
   * Can only OPEN Zadig, not drive it — see `openZadig()`'s own doc
   * comment for why (Zadig has no scriptable interface at all).
   */
  /** Latest tethered live-view frame, bubbled up from `TetheredCameraPanel` (its "Xem live view" toggle) so CAM cards can preview it too — see that prop's own doc comment. */
  const [tetheredLiveFrame, setTetheredLiveFrame] = useState<string | null>(null);

  const [zadigOpenError, setZadigOpenError] = useState<string | null>(null);
  const openZadigForDriverInstall = async () => {
    setZadigOpenError(null);
    try {
      const result = await (window as any).faceAPI?.openTetheredCameraZadig?.();
      if (!result?.ok) setZadigOpenError(result?.error ?? 'Không mở được Zadig');
    } catch (err) {
      setZadigOpenError((err as Error).message);
    }
  };

  const otherRoles = ROLES.filter((r) => !neededRoles.some((n) => n.role === r));

  /** Role-assignment device list, with the tethered camera appended once a "Kiểm tra kết nối" check has confirmed it's reachable — see `TETHERED_DEVICE_ID`'s own doc comment. Label deliberately generic (not "Canon (dây)") — `gphoto2` also supports Sony/other brands (verified 2026-09-24 against the bundled binary's own `--list-cameras`), and the real model name from `tetheredStatus.model` already tells the operator which camera it actually is. */
  const assignableDevices: DeviceEntry[] = tetheredStatus?.connected
    ? [...devices, { id: TETHERED_DEVICE_ID, label: `Máy ảnh (dây) — ${tetheredStatus.model ?? 'gphoto2'}` }]
    : devices;

  // Warning banner: a needed role still has no connected camera, or two
  // needed roles resolve to the same physical device — exactly what
  // `checkFramesReadiness` (packages/ui/src/lib/multiFrame.ts) treats as
  // blocking a simultaneous-capture session.
  //
  // Reads `assignableDevices` (not the raw `devices` state), matching every
  // other tethered-aware check in this file (`RoleCard`'s own "connected"
  // badge below, `previewError`, the composition-grid overlay) — 2026-09-24
  // confirmed field bug: this block used to read `devices` directly, which
  // never contains `TETHERED_DEVICE_ID` (that id only exists in
  // `assignableDevices`, appended once "Kiểm tra kết nối" confirms the
  // Canon). A role correctly mapped AND connected to the tethered camera
  // therefore still showed "Còn thiếu camera cho: <role>" here and was
  // undercounted in `connectedNeededCount`'s header, even while its own
  // `RoleCard` correctly showed "Đã kết nối" — a misleading, self-
  // contradicting screen that gave no indication anything was actually
  // wrong with the real capture session (`FaceCaptureApp.tsx`'s own
  // `handleSelectCamera`/`runSimultaneousCaptureGate` never read this
  // banner's verdict either, per the comment on `runFramePreflight`'s call
  // site — this was purely a display bug, not a functional one).
  const missingNeeded = neededRoles.filter((n) => {
    const id = mapping[n.role];
    return !id || !assignableDevices.some((d) => d.id === id);
  });
  const neededDeviceUse = new Map<string, CameraRole[]>();
  for (const n of neededRoles) {
    const id = mapping[n.role];
    if (!id || !assignableDevices.some((d) => d.id === id)) continue;
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

  const connectedNeededCount = neededRoles.filter((n) => {
    const id = mapping[n.role];
    return !!id && assignableDevices.some((d) => d.id === id);
  }).length;

  return (
    <div className="w-screen h-screen bg-kiosk-bg text-kiosk-text p-6 md:p-8 overflow-y-auto">
      <header className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold tracking-wide">
          BẢNG CẤU HÌNH &amp; HIỆU CHUẨN THIẾT BỊ NGOẠI VI
          <span className="block md:inline md:ml-2 text-kiosk-accent text-sm md:text-base font-semibold align-middle">
            (HARDWARE CONTROL &amp; AUDIO HUB)
          </span>
        </h1>
        <p className="text-kiosk-text-muted mt-2 text-sm">
          Kiosk Station · Đang kết nối {connectedNeededCount}/{neededRoles.length} Camera &amp; Hệ thống Loa Stereo
        </p>
      </header>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-kiosk-danger/10 border border-kiosk-danger/30 text-kiosk-danger">
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-kiosk-warning/10 border border-kiosk-warning/30 text-kiosk-warning space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {moveNotice && (
        <div className="mb-6 p-3 rounded-xl bg-kiosk-accent/10 border border-kiosk-accent/30 text-kiosk-accent text-sm">
          {moveNotice}
        </div>
      )}

      {devices.length === 0 && !error && <p className="text-kiosk-text-muted mb-4">Đang tìm camera...</p>}

      <TetheredCameraPanel
        tetheredStatus={tetheredStatus}
        tetheredChecking={tetheredChecking}
        onCheckConnection={() => void checkTetheredCamera()}
        zadigOpenError={zadigOpenError}
        onOpenZadig={() => void openZadigForDriverInstall()}
        onFrameUpdate={setTetheredLiveFrame}
      />

      <section className="mb-8">
        <h2 className="text-sm font-semibold tracking-wide text-kiosk-text-muted mb-3">
          CẤU HÌNH CỤM CAMERA ĐỒNG BỘ ({neededRoles.length} KÊNH GÓC ĐỘ)
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {neededRoles.map((need, idx) => (
            <RoleCard
              key={need.role}
              index={idx + 1}
              role={need.role}
              need={need}
              mapping={mapping}
              devices={assignableDevices}
              videoRefs={videoRefs}
              streamsRef={streamsRef}
              onAssign={assignRole}
              angles={physicalAngles[need.role]}
              onAngleChange={handleAngleChange}
              cbHelpVisibility={cbHelpVisibility[need.role]}
              onCbHelpVisibilityChange={handleCbHelpVisibilityChange}
              tetheredLiveFrame={tetheredLiveFrame}
              previewErrors={previewErrors}
            />
          ))}
        </div>

        {otherRoles.length > 0 && (
          <div className="mt-5">
            <button
              onClick={() => setOtherOpen((v) => !v)}
              className="text-sm text-kiosk-text-muted hover:text-kiosk-text"
            >
              {otherOpen ? '▾' : '▸'} Góc khác ({otherRoles.length})
            </button>
            {otherOpen && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                {otherRoles.map((role, idx) => (
                  <RoleCard
                    key={role}
                    index={neededRoles.length + idx + 1}
                    role={role}
                    mapping={mapping}
                    devices={assignableDevices}
                    videoRefs={videoRefs}
                    streamsRef={streamsRef}
                    onAssign={assignRole}
                    angles={physicalAngles[role]}
                    onAngleChange={handleAngleChange}
                    cbHelpVisibility={cbHelpVisibility[role]}
                    onCbHelpVisibilityChange={handleCbHelpVisibilityChange}
                    tetheredLiveFrame={tetheredLiveFrame}
                    previewErrors={previewErrors}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold tracking-wide text-kiosk-text-muted mb-3">
          HỆ THỐNG ÂM THANH &amp; LOA THÔNG BÁO (AUDIO &amp; VOICE PROMPTS)
        </h2>
        <Card className="divide-y divide-kiosk-border">
          <AudioVolumeRow
            label="Giọng nói hướng dẫn sinh viên"
            value={audioVolume.voicePct}
            onChange={(v) => {
              setAudioVolume((prev) => ({ ...prev, voicePct: v }));
              setSaved(false);
            }}
            onCommit={commitAudioVolume}
            onTest={() => playTestTone('voice', audioVolume.voicePct)}
            testLabel="Test Speak"
          />
          <AudioVolumeRow
            label="Chuông cảnh báo & âm hoàn tất"
            value={audioVolume.alertPct}
            onChange={(v) => {
              setAudioVolume((prev) => ({ ...prev, alertPct: v }));
              setSaved(false);
            }}
            onCommit={commitAudioVolume}
            onTest={() => playTestTone('alert', audioVolume.alertPct)}
            testLabel="Test Beep"
          />
        </Card>
      </section>

      <Card className="p-6 space-y-5">
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={grid3x3} onChange={(e) => setGrid3x3(e.target.checked)} />
            <span className="font-semibold">Lưới 3x3</span>
            <span className="text-kiosk-text-muted">— luôn xếp tối đa 3 camera mỗi hàng khi chụp đồng thời</span>
          </label>
        </div>

        <div>
          <p className="font-semibold mb-2 text-sm">Cách chụp</p>
          <div className="flex flex-wrap gap-4 text-sm">
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

        <div className="flex items-center gap-4 pt-2">
          <Button onClick={handleSave} size="lg">
            Lưu
          </Button>
          {saved && <span className="text-kiosk-accent-2 text-sm">Đã lưu</span>}
        </div>
      </Card>
    </div>
  );
}

interface RoleCardProps {
  /** 1-based display index for "CAM 01 · ..." — needed-roles cards are numbered first, "Góc khác" cards continue the count. */
  index: number;
  role: CameraRole;
  need?: RoleNeed;
  mapping: CameraRoleMapping;
  devices: DeviceEntry[];
  videoRefs: React.MutableRefObject<Map<CameraRole, HTMLVideoElement | null>>;
  streamsRef: React.MutableRefObject<Map<string, MediaStream>>;
  onAssign: (role: CameraRole, deviceId: string) => void;
  angles: PhysicalCameraAngles;
  onAngleChange: (role: CameraRole, axis: 'yaw' | 'pitch', value: number) => void;
  cbHelpVisibility: CbHelpCameraVisibility;
  onCbHelpVisibilityChange: (role: CameraRole, patch: Partial<CbHelpCameraVisibility>) => void;
  /** See `TetheredCameraPanel`'s `onFrameUpdate` doc comment. `null` while live view is off or hasn't produced a frame yet. */
  tetheredLiveFrame?: string | null;
  /** See `previewErrors`'s own doc comment — keyed by deviceId, a friendly explanation for why this role's real webcam preview came back black despite showing "Đã kết nối". */
  previewErrors: Record<string, string>;
}

/**
 * One capture-angle card: live preview of whatever camera is currently
 * assigned, the `<select>` that assigns it, mounting-angle inputs, CB Help
 * visibility, and two calibration-action buttons. Reskinned card-grid layout
 * (ui-redesign-plan.md, "CameraSetupScreen" section) replacing the old
 * vertical `RoleRow` list — same props/logic as that component, only the
 * visual shell changed.
 */
function RoleCard({
  index,
  role,
  need,
  mapping,
  devices,
  videoRefs,
  streamsRef,
  onAssign,
  angles,
  onAngleChange,
  cbHelpVisibility,
  onCbHelpVisibilityChange,
  tetheredLiveFrame,
  previewErrors,
}: RoleCardProps) {
  const deviceId = mapping[role] ?? '';
  const connected = !!deviceId && devices.some((d) => d.id === deviceId);
  const previewError = deviceId !== TETHERED_DEVICE_ID ? previewErrors[deviceId] : undefined;

  // "Cân nét tự động (AF)" / "Test Frame" are UI-only placeholder
  // interactions — there is no real autofocus or frame-test hardware API for
  // these USB cameras, so clicking either button just shows a transient "Đã
  // kiểm tra" note (self-clearing after a few seconds) rather than
  // performing, or claiming to perform, a real check. A genuine
  // autofocus/frame-test integration is a separate, hardware-dependent
  // follow-up.
  const [afNote, setAfNote] = useState<string | null>(null);
  const [testFrameNote, setTestFrameNote] = useState<string | null>(null);

  useEffect(() => {
    if (!afNote) return;
    const id = setTimeout(() => setAfNote(null), 2500);
    return () => clearTimeout(id);
  }, [afNote]);

  useEffect(() => {
    if (!testFrameNote) return;
    const id = setTimeout(() => setTestFrameNote(null), 2500);
    return () => clearTimeout(id);
  }, [testFrameNote]);

  const statusVariant: BadgeVariant = !deviceId ? 'neutral' : connected ? 'success' : 'warning';
  const statusLabel = !deviceId ? 'Chưa gán camera' : connected ? 'Đã kết nối' : 'Mất kết nối';

  return (
    <Card className="p-4">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
        <video
          ref={(el) => {
            videoRefs.current.set(role, el);
            if (!el) return;
            // D1 fix (2026-09-21, plan item 9): this ref callback re-runs on
            // every render, and used to ONLY ever set `srcObject`, never
            // clear it — so a role just cleared/swapped away from a camera
            // kept showing that camera's last frame, live-confirmed as one
            // of the "swap displays wrong" symptoms (two cards showing the
            // same feed, one of them labelled unassigned). Now explicitly
            // clears the element when this role no longer has a matching
            // open stream, so the video goes blank the instant the
            // assignment changes rather than only on the next real reflow.
            //
            // 2026-09-24 fix (audit: "các cam được setup ở các góc khác bị
            // chập chờn" once the physical Canon connects) — this callback
            // used to reassign `el.srcObject` unconditionally on every call,
            // including when it already held the exact same `MediaStream`.
            // Per the HTML spec (and Chromium's `HTMLMediaElement::
            // setSrcObject`), ANY assignment to `srcObject` re-runs the
            // media element's load algorithm even when the value is
            // unchanged, resetting the element and restarting autoplay —
            // a visible blink. Once tethered live-view frames started
            // bubbling into this screen's own state (`tetheredLiveFrame`,
            // ~every 350ms via `onFrameUpdate`), every one of those ticks
            // re-rendered this whole screen and therefore every RoleCard's
            // <video> ref, re-assigning the SAME stream to every real
            // webcam repeatedly. Now only assigns/clears when the target
            // actually differs from what's already attached.
            const wantStream = deviceId ? streamsRef.current.get(deviceId) ?? null : null;
            if (wantStream) {
              if (el.srcObject !== wantStream) el.srcObject = wantStream;
            } else if (el.srcObject) {
              el.srcObject = null;
            }
          }}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover${CAPTURE_MIRRORED ? ' scale-x-[-1]' : ''}`}
        />
        {role === 'CENTER' && deviceId !== TETHERED_DEVICE_ID && <CompositionGridOverlay />}
        {deviceId === TETHERED_DEVICE_ID && (
          // No `MediaStream` for a tethered camera (Bước 0/4) — the ref
          // callback above already correctly leaves `srcObject` cleared for
          // this id. 2026-09-22 real-hardware feedback ("vẫn không thể hiển
          // thị được lên cam 01"): this card now mirrors whatever frame the
          // "Máy ảnh qua dây" panel's own "Xem live view" toggle last
          // produced (bubbled up via `tetheredLiveFrame`, see
          // `TetheredCameraPanel`'s `onFrameUpdate`), instead of only ever
          // showing a static placeholder. Live view is still started/stopped
          // from that one panel below, not from this card.
          <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-kiosk-text-muted px-3">
            {tetheredLiveFrame ? (
              /* 2026-09-25 — same cosmetic-only perceived-sharpness boost as
                 TetheredCameraPanel.tsx's own copy of this image; see that
                 file's doc comment for why this can't be a real fix
                 (gphoto2's live-view frame is capped at EVF/preview
                 resolution, a hardware/protocol limit `contrast` cannot
                 restore detail past). */
              <img
                src={tetheredLiveFrame}
                alt="Live view máy ảnh qua dây"
                className={`w-full h-full object-cover${CAPTURE_MIRRORED ? ' scale-x-[-1]' : ''}`}
                style={{ filter: 'contrast(1.15)' }}
              />
            ) : (
              'Máy ảnh qua dây (gphoto2) — đang tải khung hình live view...'
            )}
          </div>
        )}
        {previewError && (
          // 2026-09-23 ("camera được kết nối đang không hiển thị") — makes a
          // `getUserMedia` failure visible right on the card instead of a
          // silent black box under a misleadingly green "Đã kết nối" badge
          // (that badge only checks the device is enumerated, not that its
          // preview actually opened — see `previewErrors`'s own doc comment).
          <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-kiosk-danger px-3 bg-black/60">
            {previewError}
          </div>
        )}
        <Badge variant={statusVariant} className="absolute top-2 right-2">
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-3">
        <p className="font-semibold text-sm tracking-wide">
          CAM {String(index).padStart(2, '0')} · {ROLE_LABEL[role].toUpperCase()}
          {need && need.stepTypes.length > 0 && (
            <span className="ml-2 text-xs font-normal text-kiosk-text-muted">({need.stepTypes.join(', ')})</span>
          )}
        </p>

        <select
          value={deviceId}
          onChange={(e) => onAssign(role, e.target.value)}
          className="mt-2 w-full bg-kiosk-bg border border-kiosk-border rounded-lg px-3 py-2 text-sm text-kiosk-text"
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

        <div className="mt-3 flex items-center gap-3 text-xs text-kiosk-text-muted">
          <span className="shrink-0">Góc lắp camera</span>
          <label className="flex items-center gap-1">
            yaw
            <input
              type="number"
              step={1}
              value={angles.yaw}
              onChange={(e) => onAngleChange(role, 'yaw', Number(e.target.value))}
              className="w-16 bg-kiosk-bg border border-kiosk-border rounded px-2 py-1 text-kiosk-text"
            />
            °
          </label>
          <label className="flex items-center gap-1">
            pitch
            <input
              type="number"
              step={1}
              value={angles.pitch}
              onChange={(e) => onAngleChange(role, 'pitch', Number(e.target.value))}
              className="w-16 bg-kiosk-bg border border-kiosk-border rounded px-2 py-1 text-kiosk-text"
            />
            °
          </label>
        </div>

        {/*
          2026-09-15: made into its own visibly-labeled block (was a single
          unstyled `text-xs text-kiosk-text-muted` checkbox row easy to miss
          entirely next to the angle inputs above) — field report "chưa có
          phần cài đặt màn hình mở rộng" turned out to mean this control
          existed but wasn't discoverable, not that it was actually missing.
        */}
        <div className="mt-3 rounded-lg border border-kiosk-border bg-kiosk-surface-2/40 px-3 py-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-kiosk-text-muted">
            Màn hình mở rộng (CB Help)
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-kiosk-text">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={cbHelpVisibility.visible}
                onChange={(e) => onCbHelpVisibilityChange(role, { visible: e.target.checked })}
              />
              Hiện camera này
            </label>
            {cbHelpVisibility.visible && (
              <label className="flex items-center gap-1.5">
                Thứ tự hiển thị
                <input
                  type="number"
                  step={1}
                  value={cbHelpVisibility.order}
                  onChange={(e) => onCbHelpVisibilityChange(role, { order: Number(e.target.value) })}
                  className="w-14 bg-kiosk-bg border border-kiosk-border rounded px-2 py-1 text-kiosk-text"
                />
              </label>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAfNote('Đã kiểm tra')}>
            Cân nét tự động (AF)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setTestFrameNote('Đã kiểm tra')}>
            Test Frame
          </Button>
          {afNote && <span className="text-xs text-kiosk-accent-2">AF: {afNote}</span>}
          {testFrameNote && <span className="text-xs text-kiosk-accent-2">Frame: {testFrameNote}</span>}
        </div>
      </div>
    </Card>
  );
}

interface AudioVolumeRowProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Fired on slider release (mouse/touch/key up) — persists via `faceAPI.setAudioVolume`, not on every drag tick. */
  onCommit: () => void;
  onTest: () => void;
  testLabel: string;
}

/** One audio-calibration row: label, 0-100% volume slider, and a test-tone button. */
function AudioVolumeRow({ label, value, onChange, onCommit, onTest, testLabel }: AudioVolumeRowProps) {
  return (
    <div className="p-5 flex flex-col md:flex-row md:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{label}</p>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            onMouseUp={onCommit}
            onTouchEnd={onCommit}
            onKeyUp={onCommit}
            className="w-full accent-kiosk-accent"
          />
          <span className="w-12 text-right text-sm tabular-nums text-kiosk-text-muted">{value}%</span>
        </div>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onTest} className="shrink-0">
        {testLabel}
      </Button>
    </div>
  );
}
