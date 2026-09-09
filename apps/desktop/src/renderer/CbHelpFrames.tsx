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
  /**
   * Pre-session student greeting (2026-09-07) — mirrors
   * `FaceCaptureApp.tsx`'s own copy of this field. Only ever non-null for
   * the brief publish right after a student is identified; this component
   * remembers it locally (`localGreeting` below) past that, since the
   * corner badge is meant to stay up for the whole session that follows.
   */
  greeting: CbHelpGreeting | null;
  /**
   * Item 12b (2026-09-09) — a periodic still of the main window's own live
   * CENTER feed, pushed a few times a second (see
   * `FaceCaptureApp.tsx`'s `publishCbHelpState`/`centerPreviewDataUrl` doc
   * comment for the field bug this replaces: this window used to open its
   * own competing `getUserMedia` for the same physical device). Rendered for
   * the CENTER tile below instead of a live `<video>` stream — see
   * `isFrameLive`, which now excludes CENTER entirely.
   */
  centerPreviewDataUrl?: string | null;
  /**
   * CCCD-scan capture-identification (2026-09-09) — mirrors
   * `apps/desktop/src/main/cbHelpWindow.ts`'s own copy of this field. Its
   * presence (regardless of `phase`) means "show the full-screen error
   * overlay below, capture must not proceed" — see the render further down.
   */
  errorMessage?: string | null;
  /**
   * Post-save "Cảm ơn" overlay (2026-09-09, "cảm ơn phải hiển thị trên màn
   * extend") — mirrors `apps/desktop/src/main/cbHelpWindow.ts`'s own copy.
   * Its presence (regardless of `phase`) means "show the full-screen thank
   * you overlay below" — see the render further down. Set only for the same
   * fixed window `FaceCaptureApp.tsx`'s own `thankYouStudent` state is
   * non-null, right after a successful save.
   */
  thankYou?: { name: string } | null;
}

/** Mirrors `apps/desktop/src/main/cbHelpWindow.ts`'s own copy. */
interface CbHelpGreeting {
  code: string;
  name: string;
  className: string;
  major: string;
  academicYear: string;
}

const EMPTY_STATE: CbHelpPublishState = {
  running: false,
  phase: 'idle',
  simultaneous: false,
  currentStepId: null,
  frames: [],
  greeting: null,
  centerPreviewDataUrl: null,
  errorMessage: null,
  thankYou: null,
};

/**
 * How long the full-screen greeting shows before collapsing to the
 * top-left corner badge — must match `FaceCaptureApp.tsx`'s
 * `GREETING_DURATION_MS` (the side that actually waits this long before
 * starting the session/recording); duplicated rather than shared, same as
 * every other value crossing this IPC boundary. A real session's frames
 * arriving first (see the collapse effect below) also collapses it
 * immediately, so a mismatch here only affects how long the greeting looks
 * "held" with nothing behind it yet — never how long recording is delayed.
 */
const GREETING_DURATION_MS = 3000;

/**
 * Whether `frame` should have a live camera stream open in this window right
 * now. Simultaneous mode: every not-yet-COMPLETED frame goes live at once,
 * same as the main kiosk window's own multi-frame grid. Sequential mode:
 * only the CURRENT frame — the others are either not reached yet (PENDING)
 * or already have their captured photo to show (COMPLETED) instead.
 *
 * CENTER is excluded unconditionally (item 12b, 2026-09-09) — it used to
 * open its own `getUserMedia` here for the exact same physical device the
 * main kiosk window already has open, which common Windows webcam drivers
 * refuse a second concurrent reader of (2026-09-08 field report: CENTER's
 * tile stays blank even though the main window's CENTER camera is clearly
 * live). CENTER's tile is fed by `centerPreviewDataUrl` instead — see the
 * render below and that field's own doc comment.
 *
 * `centerDeviceId` (2026-09-09 fix, live-hardware-confirmed: `[cb-help]
 * failed to open camera <id>: NotReadableError`/`[object DOMException]` on a
 * kiosk with exactly one real camera): the CENTER exclusion above only ever
 * checked the frame's *role*, not which physical device it resolves to — but
 * the "1 camera covers multiple roles" fallback (`planCaptureRounds`,
 * lib/multiFrame.ts) can map a non-CENTER role (LEFT/RIGHT/CUSTOM) to the
 * *exact same* device id as CENTER's `currentDeviceId` on a kiosk that does
 * not have a distinct camera for every role. That frame hits the identical
 * "second concurrent reader" conflict item 12b already fixed for the
 * literal CENTER role — just under a different role name — because nothing
 * here was comparing device ids across frames. A frame whose `deviceId`
 * equals `centerDeviceId` is therefore excluded here the same way, with the
 * same fallback: no live stream of its own in this window (there is no
 * snapshot feed for it, unlike CENTER, so its tile simply shows nothing
 * live until it is COMPLETED — same as a frame with no mapped device at
 * all).
 */
function isFrameLive(frame: CbHelpFrame, simultaneous: boolean, centerDeviceId: string | null): boolean {
  if (!frame.deviceId || frame.status === 'COMPLETED' || frame.role === 'CENTER') return false;
  if (centerDeviceId && frame.deviceId === centerDeviceId) return false;
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
 * Live video (non-CENTER frames only — see `isFrameLive`'s own doc comment
 * for why CENTER is excluded): this window opens its own
 * `getUserMedia({ video: { deviceId: { exact } } })` per side-frame device.
 * Streams are keyed by `deviceId` (not by step, in case two frames ever
 * shared one) and reused across pushes — the reconciliation effect below
 * only opens a device it does not already hold a stream for, and only stops
 * one no frame needs live anymore (a step that just got COMPLETED, or a
 * mode/session change).
 *
 * CENTER's own tile (item 12b, 2026-09-09): this used to also open its own
 * `getUserMedia` for CENTER, on the theory that Chromium shares one physical
 * camera across every window of the same session/origin without conflict —
 * true in principle, but not what actually happens on common Windows webcam
 * drivers, which frequently refuse a second concurrent reader of one
 * physical device (2026-09-08 field report: CENTER's tile stayed blank even
 * though the main kiosk window's own CENTER camera was clearly live). Fixed
 * by not opening a second stream at all: CENTER's tile instead renders
 * `state.centerPreviewDataUrl`, a still of the main window's own live CENTER
 * feed that `FaceCaptureApp.tsx`'s `publishCbHelpState` pushes a few times a
 * second (see that field's own doc comment) — plenty for an "extended
 * monitor" without a second live video pipeline over IPC.
 */
export default function CbHelpFrames() {
  const [state, setState] = useState<CbHelpPublishState>(EMPTY_STATE);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const deviceLabelsRef = useRef<Map<string, string>>(new Map());
  const [, forceRerender] = useState(0);

  /**
   * The student greeting outlives `state.greeting` itself — that field only
   * arrives on the one publish right after identification, then goes back
   * to `null` once the real session starts publishing (see
   * `FaceCaptureApp.tsx`'s `publishCbHelpState`). This remembers it locally
   * so the corner badge can stay up for the whole session that follows.
   * Cleared only once the window is genuinely idle again (no greeting, no
   * frames) — i.e. the next walk-up-kiosk cycle has fully reset.
   */
  const [localGreeting, setLocalGreeting] = useState<CbHelpGreeting | null>(null);
  const [greetingCollapsed, setGreetingCollapsed] = useState(false);

  useEffect(() => {
    if (state.greeting) {
      setLocalGreeting(state.greeting);
      setGreetingCollapsed(false);
    } else if (state.phase === 'idle' && state.frames.length === 0) {
      setLocalGreeting(null);
      setGreetingCollapsed(false);
    }
  }, [state.greeting, state.phase, state.frames.length]);

  // Collapse to the corner badge after GREETING_DURATION_MS...
  useEffect(() => {
    if (!localGreeting || greetingCollapsed) return;
    const timer = setTimeout(() => setGreetingCollapsed(true), GREETING_DURATION_MS);
    return () => clearTimeout(timer);
  }, [localGreeting, greetingCollapsed]);

  // ...or as soon as the real session's frames actually arrive, whichever is
  // first — the frame grid must never sit hidden behind a full-screen
  // greeting once there is real capture progress to show.
  useEffect(() => {
    if (state.frames.length > 0) setGreetingCollapsed(true);
  }, [state.frames.length]);

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

  // Stable, content-based key for "which device ids does this window need a
  // stream for right now" — 2026-09-09 fix. `state` is a brand-new object on
  // EVERY `cbhelp:update` push, including the main window's item-12b
  // `centerPreviewDataUrl` heartbeat (a few times a second, unconditionally,
  // for the whole capture-screen lifetime — see that field's own doc
  // comment), so keying the effect below directly on `state.frames` (an
  // array reference that changes every single tick even when its actual
  // device-id content is identical) meant this effect re-ran, and re-tried
  // opening every not-yet-open device, on EVERY heartbeat — including a
  // device id that isn't currently plugged in at all (a 3-camera capture
  // configuration with only 1 camera actually connected, say), which then
  // fails with the same `OverconstrainedError` and gets retried again well
  // under a second later, forever, as fast as `getUserMedia` itself can
  // reject. Sorting+joining into one string means the effect's dependency
  // array only actually changes when the SET of needed device ids changes —
  // a real hot-plug/step change — not on every content-identical republish.
  const centerFrameDeviceId = state.frames.find((f) => f.role === 'CENTER')?.deviceId ?? null;
  const neededDeviceIdsKey = state.frames
    .filter((f) => isFrameLive(f, state.simultaneous, centerFrameDeviceId))
    .map((f) => f.deviceId as string)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const neededDeviceIds = new Set(neededDeviceIdsKey ? neededDeviceIdsKey.split(',') : []);

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
          // Logged once per actual device-set change now (see this effect's
          // dependency array), not in a sub-second retry storm — a device
          // that genuinely is not plugged in (fewer cameras connected than
          // the capture configuration expects, an explicitly allowed
          // situation — see the multi-camera capture-configuration
          // decision) will keep failing here, but only once per real change,
          // not continuously.
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
  }, [neededDeviceIdsKey]);

  // Unmount: never leave a camera open once this window closes.
  useEffect(
    () => () => {
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streamsRef.current.clear();
    },
    []
  );

  // CCCD-scan NOT_FOUND (2026-09-09) — takes over the whole window, ahead of
  // even the greeting: a scanned card that doesn't match the roster means
  // capture must not proceed, so nothing else on this window should look
  // like it's mid-session. Stays up until `FaceCaptureApp.tsx`'s
  // `handleCccdScan` publishes something else (a fresh attempt clearing it,
  // or a FOUND greeting) — see `CbHelpPublishState.errorMessage`'s own doc
  // comment.
  if (state.errorMessage) {
    return (
      <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 overflow-hidden px-12 text-center">
        <span className="text-6xl">⚠️</span>
        <p className="text-2xl sm:text-3xl font-semibold max-w-3xl leading-snug">{state.errorMessage}</p>
      </div>
    );
  }

  // Post-save "Cảm ơn" overlay (2026-09-09) — takes over the whole window
  // for the same fixed window `FaceCaptureApp.tsx`'s own `thankYouStudent`
  // is up, ahead of the greeting/idle/frame-grid branches below (mirrors
  // `errorMessage`'s own priority — this window only ever shows one
  // full-screen takeover at a time). Publisher clears this before the next
  // greeting ever arrives, so the two branches never actually contend.
  if (state.thankYou) {
    return (
      <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3 overflow-hidden px-8 text-center">
        <span className="text-6xl">✅</span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-wide">Cảm ơn {state.thankYou.name || 'bạn'}!</h1>
        <p className="text-lg text-slate-400">Hồ sơ ảnh đã được lưu thành công.</p>
      </div>
    );
  }

  // Full-screen greeting (2026-09-07) — takes over the whole window for
  // GREETING_DURATION_MS (or until real frames arrive, see the collapse
  // effects above), ahead of every other branch below including the idle
  // placeholder.
  if (localGreeting && !greetingCollapsed) {
    return (
      <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3 overflow-hidden px-8 text-center">
        <span className="text-6xl">👋</span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-wide">Xin chào, {localGreeting.name}!</h1>
        <p className="text-lg text-slate-400">
          Lớp {localGreeting.className} · {localGreeting.major} · Năm học {localGreeting.academicYear}
        </p>
      </div>
    );
  }

  // Once collapsed, the student's info follows as a small corner badge —
  // rendered on top of whichever branch below is showing (idle placeholder,
  // or the real frame grid once the session actually starts).
  const cornerBadge = localGreeting && greetingCollapsed && (
    <div className="absolute left-4 top-4 z-10 rounded-lg bg-slate-900/90 px-3 py-2 shadow-lg">
      <p className="text-xs text-slate-400">Sinh viên</p>
      <p className="text-sm font-semibold text-slate-100">{localGreeting.name}</p>
      <p className="text-xs text-slate-400">
        Lớp {localGreeting.className} · {localGreeting.major}
      </p>
    </div>
  );

  if (state.phase === 'idle' || state.frames.length === 0) {
    return (
      <div className="relative w-screen h-screen bg-slate-950 text-slate-100 flex items-center justify-center overflow-hidden">
        {cornerBadge}
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
    <div className="relative w-screen h-screen bg-slate-950 text-slate-100 flex flex-col p-4 gap-2 overflow-hidden">
      {cornerBadge}
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
        {state.frames.map((frame) => {
          // Item 12b: CENTER never gets its own stream in this window
          // anymore (see `isFrameLive`) — once it is COMPLETED, the real
          // captured photo takes over exactly like every other frame, but
          // until then it shows the periodic `centerPreviewDataUrl` push
          // instead of a blank/dead `<video>` with no stream bound.
          const isCenter = frame.role === 'CENTER';
          const centerLiveImage = isCenter && frame.status !== 'COMPLETED' ? state.centerPreviewDataUrl : null;
          return (
            <FrameTile
              key={frame.stepId}
              size="large"
              className="w-full h-full"
              label={frame.label}
              roleLabel={CAMERA_ROLE_LABELS_VI[frame.role as CameraRole] ?? frame.role}
              deviceLabel={frame.deviceId ? deviceLabelsRef.current.get(frame.deviceId) ?? null : null}
              stream={isCenter ? null : frame.deviceId ? streamsRef.current.get(frame.deviceId) ?? null : null}
              status={frame.status}
              imagePath={centerLiveImage ?? frame.capturedDataUrl}
              mirrored={CAPTURE_MIRRORED}
            />
          );
        })}
      </div>
    </div>
  );
}
