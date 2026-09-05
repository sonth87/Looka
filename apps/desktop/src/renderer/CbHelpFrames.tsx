import { useEffect, useRef, useState } from 'react';
import type { CameraRole } from '@face/core';
import { CAMERA_ROLE_LABELS_VI, CAPTURE_MIRRORED, FrameTile } from '@face/ui';

/**
 * The CB Help extended-display window's capture-frames snapshot — mirrors
 * `packages/ui/src/components/screens/FaceCaptureApp.tsx`'s own copy of this
 * same shape (duplicated across the IPC boundary rather than imported, same
 * as every other `faceAPI` payload type — see preload/index.ts's own
 * comment on this type).
 */
type CbHelpFrameStatus = 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED';

interface CbHelpFrame {
  stepId: string;
  stepType: string;
  role: string;
  label: string;
  deviceId: string | null;
  status: CbHelpFrameStatus;
  capturedDataUrl?: string;
  attempt: number;
}

interface CbHelpPublishState {
  running: boolean;
  /**
   * The window's own presentation mode (§3.5, 2026-09-05 second product
   * decision — captured photos stay visible after the shot). `'idle'`: show
   * the placeholder message below. `'live'`: normal in-progress capture,
   * same rendering as always. `'review'`/`'done'`: the run finished — every
   * frame in `frames` is already COMPLETED with its photo, so this renders
   * the same frame grid as `'live'`, just with no live stream needed (see
   * `isFrameLive`) and a different header (see the render below).
   */
  phase: 'idle' | 'live' | 'review' | 'done';
  simultaneous: boolean;
  currentStepId: string | null;
  frames: CbHelpFrame[];
}

const EMPTY_STATE: CbHelpPublishState = {
  running: false,
  phase: 'idle',
  simultaneous: false,
  currentStepId: null,
  frames: [],
};

/**
 * Whether `frame` should have a live camera stream open in this window right
 * now. Simultaneous mode: every not-yet-COMPLETED frame goes live at once,
 * same as the main kiosk window's own multi-frame grid. Sequential mode:
 * only the CURRENT frame — the others are either not reached yet (PENDING)
 * or already have their captured photo to show (COMPLETED) instead.
 */
function isFrameLive(frame: CbHelpFrame, simultaneous: boolean): boolean {
  if (!frame.deviceId || frame.status === 'COMPLETED') return false;
  return simultaneous || frame.status === 'CURRENT';
}

/**
 * Gap (px) between columns — kept small since tiles should be as large as
 * possible (product decision 2026-09-05, fourth pass — "để thành các thanh
 * dọc, grid chia đều cho các khung": equal-width vertical columns, one per
 * frame, each spanning the full available height; no more 2-over-1/2x2
 * grouping). This needs no JS measurement — a CSS grid with
 * `repeat(N, minmax(0, 1fr))` columns and a `h-full` row already produces
 * it for any frame count from 1 to 5 (see the render below).
 */
const TILE_GAP_PX = 10;

/**
 * The CB Help extended-display window — see
 * `apps/desktop/src/main/cbHelpWindow.ts`'s own doc comment for the product
 * decision (2026-09-05, second pass) this implements: the window shows only
 * the capture frames themselves, live + captured, not a mirror of the whole
 * kiosk app (that was the decision's first-pass replacement, briefly shipped
 * as `CbHelpMirror.tsx` — this file replaces it). Mounted instead of
 * `<App />` when this window is opened with the `#cb-help` hash (see
 * main.tsx). No controls of its own — same "purely a viewer" reasoning the
 * `CbHelpMonitor.tsx` this indirectly succeeds always had.
 *
 * Hydrates from `faceAPI.getCbHelpState()` on mount, then follows every
 * `faceAPI.onCbHelpUpdate()` push relayed from the kiosk's main window (see
 * `FaceCaptureApp.tsx`'s `publishCbHelpState` and cbHelpWindow.ts's own doc
 * comment for the full data flow).
 *
 * Live video: Chromium shares one physical camera across every window of
 * the same session/origin, so this window opening its own
 * `getUserMedia({ video: { deviceId: { exact } } })` for a frame that is
 * also open in the main kiosk window does not conflict with it. Streams are
 * keyed by `deviceId` (not by step, in case two frames ever shared one) and
 * reused across pushes — the reconciliation effect below only opens a
 * device it does not already hold a stream for, and only stops one no frame
 * needs live anymore (a step that just got COMPLETED, or a mode/session
 * change).
 */
export default function CbHelpFrames() {
  const [state, setState] = useState<CbHelpPublishState>(EMPTY_STATE);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const deviceLabelsRef = useRef<Map<string, string>>(new Map());
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.getCbHelpState) return;

    let cancelled = false;
    faceAPI.getCbHelpState().then((s: CbHelpPublishState) => {
      if (!cancelled) setState(s ?? EMPTY_STATE);
    });

    const unsubscribe = faceAPI.onCbHelpUpdate?.((s: CbHelpPublishState) => setState(s ?? EMPTY_STATE));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const neededDeviceIds = new Set(
      state.frames.filter((f) => isFrameLive(f, state.simultaneous)).map((f) => f.deviceId as string)
    );

    for (const [deviceId, stream] of streamsRef.current) {
      if (neededDeviceIds.has(deviceId)) continue;
      stream.getTracks().forEach((t) => t.stop());
      streamsRef.current.delete(deviceId);
    }

    void (async () => {
      let openedAny = false;
      for (const deviceId of neededDeviceIds) {
        if (streamsRef.current.has(deviceId)) continue;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { deviceId: { exact: deviceId } },
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            continue;
          }
          streamsRef.current.set(deviceId, stream);
          openedAny = true;
        } catch (err) {
          console.error(`[cb-help] failed to open camera ${deviceId}:`, err);
        }
      }

      if (openedAny && !cancelled) {
        // enumerateDevices() only reports real labels for a device this
        // origin has already been granted permission for — refresh once
        // some getUserMedia call above has actually unlocked one.
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const map = new Map<string, string>();
          all.filter((d) => d.kind === 'videoinput' && d.label).forEach((d) => map.set(d.deviceId, d.label));
          deviceLabelsRef.current = map;
        } catch {
          /* device labels just stay blank */
        }
      }

      if (!cancelled) forceRerender((n) => n + 1); // pick up the streams/labels refs above
    })();

    return () => {
      cancelled = true;
    };
  }, [state.frames, state.simultaneous]);

  // Unmount: never leave a camera open once this window closes.
  useEffect(
    () => () => {
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streamsRef.current.clear();
    },
    []
  );

  if (state.phase === 'idle' || state.frames.length === 0) {
    return (
      <div className="w-screen h-screen bg-slate-950 text-slate-100 flex items-center justify-center overflow-hidden">
        <p className="text-slate-500 text-3xl sm:text-4xl font-semibold text-center px-8">
          Chưa có phiên chụp nào đang diễn ra
        </p>
      </div>
    );
  }

  // 'review'/'done': the run already finished — every frame is COMPLETED
  // (see `CbHelpPublishState.phase`'s own doc comment), so there is no
  // "current" frame to call out and the header says so instead of "Đang
  // chụp ảnh". `isFrameLive` above already keeps no stream open for a
  // COMPLETED frame, so the reconciliation effect has already released any
  // camera these two phases might otherwise have inherited from 'live'.
  const isLive = state.phase === 'live';
  const currentFrame = isLive ? state.frames.find((f) => f.stepId === state.currentStepId) : undefined;
  const completedCount = state.frames.filter((f) => f.status === 'COMPLETED').length;
  const headerTitle = isLive
    ? 'Đang chụp ảnh'
    : state.phase === 'review'
    ? 'Đã chụp xong — đang chờ xác nhận'
    : 'Đã chụp xong';

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col p-4 gap-2 overflow-hidden">
      <header className="text-center shrink-0">
        <h1 className="text-2xl font-bold tracking-wide">{headerTitle}</h1>
        <p className="text-slate-400 mt-0.5">
          {currentFrame
            ? `${CAMERA_ROLE_LABELS_VI[currentFrame.role as CameraRole] ?? currentFrame.role} · ${currentFrame.label} — `
            : ''}
          {completedCount}/{state.frames.length} đã chụp
        </p>
      </header>

      {/*
        Equal-width columns, one per frame, each spanning the full available
        height below the header (product decision 2026-09-05, fourth pass —
        "để thành các thanh dọc, grid chia đều cho các khung"): no more
        2-over-1/2x2 grouping, just `repeat(N, minmax(0, 1fr))` columns that
        every frame count from 1 to 5 fits into equally. `FrameTile`'s
        `size="large"` variant stretches to fill whatever box it is given
        (see its own doc comment), so each column's video/photo covers it
        edge-to-edge — cropping a 16:9 feed's sides into the tall column
        shape is expected and fine.
      */}
      <div
        className="flex-1 min-h-0 w-full grid"
        style={{ gridTemplateColumns: `repeat(${state.frames.length}, minmax(0, 1fr))`, gap: TILE_GAP_PX }}
      >
        {state.frames.map((frame) => (
          <FrameTile
            key={frame.stepId}
            size="large"
            className="w-full h-full"
            label={frame.label}
            roleLabel={CAMERA_ROLE_LABELS_VI[frame.role as CameraRole] ?? frame.role}
            deviceLabel={frame.deviceId ? deviceLabelsRef.current.get(frame.deviceId) ?? null : null}
            stream={frame.deviceId ? streamsRef.current.get(frame.deviceId) ?? null : null}
            status={frame.status}
            imagePath={frame.capturedDataUrl}
            mirrored={CAPTURE_MIRRORED}
          />
        ))}
      </div>
    </div>
  );
}
