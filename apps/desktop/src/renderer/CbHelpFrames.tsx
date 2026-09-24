import { useEffect, useRef, useState } from 'react';
import type { CameraRole } from '@face/core';
import { CAMERA_ROLE_LABELS_VI, CAPTURE_MIRRORED, FrameTile } from '@face/ui';
import { Settings, X, ChevronUp, ChevronDown } from 'lucide-react';

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
  /**
   * Periodic still of THIS frame's own live camera, relayed from the main
   * kiosk window's ALREADY-open stream (2026-09-23 fix, live field report,
   * quoted verbatim: "màn extend khi mở chọn cam giữa thì hiển thị cả 3 góc
   * cam nhưng ảnh chỉ của cam giữa" — see the `neededDeviceIdsKey`
   * computation's own doc comment further down for the confirmed root
   * cause: a non-CENTER role must never try to open a second, competing
   * `getUserMedia` for a physical device the main window already holds
   * exclusively during an active session). Mirrors how CENTER's own
   * `centerPreviewDataUrl` (on `CbHelpPublishState`) already works, just
   * scoped per-frame here since every non-CENTER role has its own distinct
   * device/stream. `undefined`/`null` once COMPLETED (the real
   * `capturedDataUrl` already covers it) or while the main window hasn't
   * published a still for this device yet.
   */
  livePreviewDataUrl?: string | null;
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
   * the same frame grid as `'live'`, just with every frame's own
   * `capturedDataUrl` already covering it (no live stream or relayed still
   * needed) and a different header (see the render below).
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
   * the CENTER tile below instead of a live `<video>` stream, whenever
   * `centerLiveDeviceId`'s own separate attempt (see that computation's doc
   * comment) hasn't opened one.
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
  /**
   * Saved role→deviceId mapping plus which of those devices are actually
   * connected right now — mirrors `FaceCaptureApp.tsx`'s own copy of this
   * field (2026-09-15). Published unconditionally (every phase, idle
   * included), so this window can preview a visible non-CENTER camera the
   * settings panel marks visible even with no capture session running — see
   * `idlePreviewRoles` below.
   */
  cameraRoleMapping?: Record<string, string>;
  connectedDeviceIds?: string[];
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
  cameraRoleMapping: {},
  connectedDeviceIds: [],
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
 * Trimmed to 2000 (2026-09-10 perf pass) to match `FaceCaptureApp.tsx`'s own
 * value after its own trim — keep these two in sync.
 */
const GREETING_DURATION_MS = 2000;

/**
 * REMOVED 2026-09-23 — this used to be `isFrameLive(frame, simultaneous,
 * centerDeviceId)`, deciding whether a non-CENTER frame should get its OWN,
 * independently-opened `getUserMedia` stream in this window (simultaneous
 * mode: every not-yet-COMPLETED frame; sequential mode: only CURRENT).
 *
 * Live field report, quoted verbatim: "màn extend khi mở chọn cam giữa thì
 * hiển thị cả 3 góc cam nhưng ảnh chỉ của cam giữa" — CB Help shows all 3
 * camera-angle tiles during an active session, but only CENTER ever has a
 * real image. Confirmed root cause by reading `FaceCaptureApp.tsx`'s own
 * `frameStreamsRef`/`openRoundStreams`/`openFrameStreams`: the MAIN kiosk
 * window already holds an EXCLUSIVE `getUserMedia` open for every non-CENTER
 * frame's physical device for the entire active-session lifetime (not just
 * while that frame is the CURRENT shot) — the identical "one UVC reader at a
 * time" driver contention `centerLiveDeviceId` below already documents for
 * CENTER, and `CampaignGate.tsx`'s `pausedForSetup` documents for the Camera
 * Setup popup, just contended against the active session's OWN streams this
 * time. This window's second `getUserMedia` for that same deviceId always
 * lost that race and failed silently (`NotReadableError: Device in use`),
 * leaving every non-CENTER tile blank — exactly the reported symptom.
 *
 * See the `neededDeviceIdsKey` computation further down for what replaced
 * this: non-CENTER frames no longer attempt their own stream at all during
 * an active session, and instead render a relayed still
 * (`frame.livePreviewDataUrl`, pushed by `FaceCaptureApp.tsx`'s
 * `publishCbHelpState` from ITS OWN already-open stream) — see
 * `sideLiveImage` in the render below. The old `centerDeviceId`-sharing
 * exclusion this function also did (two roles resolving to the same
 * physical device as CENTER) needs no replacement: that case was never an
 * "opens its own stream" case in the first place, and still picks up
 * `centerLiveStream` for free via `neededDeviceIdsKey`'s own
 * `centerLiveDeviceId` term.
 */

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
 * Per-column max width, as a percent of the window's own width — 2026-09-15
 * field request: with the CB Help visibility panel now able to show as few
 * as 1 tile, an unconstrained `1fr` column would stretch that lone tile
 * across the whole screen. 32 keeps a 1-3 tile layout close in scale to
 * what the full 5-tile layout already looks like (5 × ~20vw), rather than
 * ballooning.
 *
 * Applied as a cap on the GRID CONTAINER's total width (`N * MAX_TILE_WIDTH_VW`,
 * see both grids below), not on each column's own track size — an earlier
 * version used `minmax(0, min(1fr, ${MAX_TILE_WIDTH_VW}vw))` per column,
 * which is invalid CSS (a `<flex>` value like `1fr` cannot appear inside
 * `min()`/`max()`/`clamp()` per the CSS Values spec) and silently made the
 * ENTIRE `grid-template-columns` declaration invalid — Chromium then fell
 * back to the property's initial value (`none`), collapsing every column
 * into one single implicit column with items auto-placed into new rows.
 * This is the real root cause of the long-standing "hiển thị theo dạng
 * row" field report: a pure CSS parse failure, invisible to any amount of
 * JS-side data/diagnostic logging, which is why the frames data itself
 * kept checking out correct while the rendered layout stayed wrong.
 * Confirmed via a standalone DOM repro in a live browser tab before this
 * fix (computed `gridTemplateColumns` was a single `84px` track, not 5).
 */
const MAX_TILE_WIDTH_VW = 32;

/**
 * Same literal as `CameraSetupScreen.tsx`/`FaceCaptureApp.tsx`/`CampaignGate.tsx`
 * — see any of their own doc comments for why this is duplicated rather than
 * imported (main-process/renderer/packages boundaries). 2026-09-23 addition —
 * see the local `tetheredCenterPreview` poll effect further down for why this
 * window now needs to know it directly instead of only reading it off
 * `state.cameraRoleMapping.CENTER` inline.
 */
const TETHERED_DEVICE_ID = 'tethered:gphoto2';

/**
 * Which camera roles show on CB Help and in what order — mirrors
 * `FaceCaptureApp.tsx`'s own `CbHelpVisibilityState`/`DEFAULT_CB_HELP_VISIBILITY`
 * (duplicated across the IPC boundary, same convention every other type in
 * this file already follows). Every role, always fully populated (defaults
 * filled in for whatever the saved map doesn't cover).
 */
interface CbHelpCameraVisibility {
  visible: boolean;
  order: number;
}
type CbHelpVisibilityState = Record<CameraRole, CbHelpCameraVisibility>;
const CB_HELP_ROLES: CameraRole[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];
const DEFAULT_CB_HELP_VISIBILITY: CbHelpVisibilityState = {
  CENTER: { visible: true, order: 0 },
  LEFT: { visible: false, order: 1 },
  RIGHT: { visible: false, order: 2 },
  UP: { visible: false, order: 3 },
  DOWN: { visible: false, order: 4 },
};

/**
 * Shared by the settings panel below (its own read/write UI) AND the main
 * `CbHelpFrames` component (2026-09-15 — needs read-only access to decide
 * `idlePreviewRoles`, see that computation's own doc comment). Each caller
 * gets its own independent subscription — `onCbHelpVisibilityChanged` is a
 * plain `ipcRenderer.on` listener, which supports multiple listeners fine,
 * so there is no need to lift this into a single shared instance/context
 * for what is, at most, two consumers in one window.
 */
/**
 * Returns `[visibility, setVisibilityOptimistic]` — the setter is for
 * `CbHelpVisibilitySettings`'s own use only (see its `persist()`'s doc
 * comment for why a write needs it); every read-only caller should just
 * destructure the first element and ignore the second.
 */
function useCbHelpVisibility(): [CbHelpVisibilityState, (next: CbHelpVisibilityState) => void] {
  const [visibility, setVisibility] = useState<CbHelpVisibilityState>({ ...DEFAULT_CB_HELP_VISIBILITY });
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    const resolve = (saved: Partial<Record<CameraRole, CbHelpCameraVisibility>> | null | undefined) => {
      const next = { ...DEFAULT_CB_HELP_VISIBILITY };
      if (saved) {
        for (const role of CB_HELP_ROLES) {
          if (saved[role]) next[role] = saved[role]!;
        }
      }
      setVisibility(next);
    };
    // 2026-09-15 field report ("tắt cam trái nhưng button checkbox vẫn hiển
    // thị") — a stale-overwrite race: `getCbHelpVisibility()` (the one-time
    // bootstrap fetch, fired on every mount — e.g. opening this settings
    // panel) and `onCbHelpVisibilityChanged` (the live broadcast, fired on
    // every toggle) are two independent async channels with no ordering
    // guarantee between them. If the panel happens to mount around the same
    // time the operator is toggling checkboxes, the bootstrap fetch's reply
    // can arrive AFTER a fresher broadcast already applied the real change —
    // silently overwriting it back to the older snapshot for whichever role
    // changed in between (every OTHER checkbox stays correct, since only
    // that one differed from the stale snapshot — exactly the reported
    // symptom). Once any broadcast has been applied, the bootstrap fetch's
    // own eventual reply is superseded and must be ignored — the broadcast
    // channel is the only one that can still be trusted as "latest" after
    // that point.
    let supersededByBroadcast = false;
    faceAPI?.getCbHelpVisibility?.().then((saved: Partial<Record<CameraRole, CbHelpCameraVisibility>> | null | undefined) => {
      if (!supersededByBroadcast) resolve(saved);
    });
    return faceAPI?.onCbHelpVisibilityChanged?.((saved: Partial<Record<CameraRole, CbHelpCameraVisibility>> | null | undefined) => {
      supersededByBroadcast = true;
      resolve(saved);
    });
  }, []);
  return [visibility, setVisibility];
}

/**
 * In-window "cấu hình hiển thị camera" panel — 2026-09-15 field request:
 * "muốn hiển thị thêm thì sẽ cài đặt ở trong màn mở rộng đó, có thể thay
 * đổi được vị trí các cam ở các grid". Previously the only way to change
 * which cameras show here (and in what order) was the separate Camera Setup
 * popup window (`Ctrl/Cmd+Shift+K`, opened from the MAIN kiosk window) —
 * this brings the same `getCbHelpVisibility`/`setCbHelpVisibility` calls
 * directly into this window instead, since it's naturally the place an
 * operator is actually looking at while deciding what should show here.
 *
 * Reordering is up/down buttons swapping `order` with the adjacent visible
 * row, not drag-and-drop — same end result ("thay đổi vị trí") without a
 * DnD library dependency for what is, at most, 5 rows.
 *
 * Writes go straight through `setCbHelpVisibility` (persists + broadcasts
 * to the main kiosk window, see `main/index.ts`'s handler and preload's
 * `onCbHelpVisibilityChanged` doc comment) — the main window's own
 * `buildCbHelpFrames` picks up the change and republishes a re-filtered/
 * sorted `frames` array, which arrives back here via the existing
 * `onCbHelpUpdate` subscription and simply re-renders the grid below. This
 * panel never touches `state.frames` itself.
 */
function CbHelpVisibilitySettings({ onClose }: { onClose: () => void }) {
  const [visibility, setVisibility] = useCbHelpVisibility();

  function persist(next: CbHelpVisibilityState) {
    // 2026-09-15 field report ("chỉ click hiển thị thêm được 1 màn" — every
    // click seemed to replace the previous selection instead of adding to
    // it): `toggleVisible`/`move` below both build `next` by spreading the
    // CURRENT `visibility` from this render's closure. Two clicks fired in
    // quick succession (well within the round-trip time to main and back)
    // both close over the SAME pre-either-click `visibility` snapshot, since
    // React hasn't re-rendered with the first click's result yet — so the
    // second click's payload effectively re-sends the first role's OLD
    // value alongside its own change, reverting click 1 the moment click 2's
    // broadcast reply lands. Setting local state OPTIMISTICALLY, synchron-
    // ously, right here — instead of only after the round-trip confirms —
    // means the very next click (even a near-instant one) closes over an
    // already-updated `visibility`, so consecutive toggles accumulate
    // correctly instead of stomping each other. The broadcast reply that
    // follows still reconciles/confirms this normally (and remains the
    // source of truth for any OTHER window's change, e.g. Camera Setup).
    setVisibility(next);
    void (window as any).faceAPI?.setCbHelpVisibility?.(next);
  }

  function toggleVisible(role: CameraRole) {
    persist({ ...visibility, [role]: { ...visibility[role], visible: !visibility[role].visible } });
  }

  // Swaps `order` with the nearest OTHER role in that direction — using the
  // full role list (not just the visible ones) so a hidden role's order
  // still moves sensibly if it's later made visible.
  function move(role: CameraRole, direction: -1 | 1) {
    const sorted = [...CB_HELP_ROLES].sort((a, b) => visibility[a].order - visibility[b].order);
    const idx = sorted.indexOf(role);
    const swapWith = sorted[idx + direction];
    if (!swapWith) return;
    persist({
      ...visibility,
      [role]: { ...visibility[role], order: visibility[swapWith].order },
      [swapWith]: { ...visibility[swapWith], order: visibility[role].order },
    });
  }

  const orderedRoles = [...CB_HELP_ROLES].sort((a, b) => visibility[a].order - visibility[b].order);

  return (
    <div className="absolute right-4 top-4 z-20 w-72 rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Cấu hình hiển thị camera</h2>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Đóng">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {orderedRoles.map((role, idx) => (
          <li key={role} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800/60">
            <label className="flex flex-1 items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={visibility[role].visible}
                onChange={() => toggleVisible(role)}
                className="h-4 w-4 accent-blue-600"
              />
              {CAMERA_ROLE_LABELS_VI[role] ?? role}
            </label>
            <div className="flex shrink-0 gap-0.5">
              <button
                onClick={() => move(role, -1)}
                disabled={idx === 0}
                className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label={`Đưa ${CAMERA_ROLE_LABELS_VI[role] ?? role} lên trước`}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => move(role, 1)}
                disabled={idx === orderedRoles.length - 1}
                className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label={`Đưa ${CAMERA_ROLE_LABELS_VI[role] ?? role} xuống sau`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
 * Live video: this window opens its own
 * `getUserMedia({ video: { deviceId: { exact } } })`, but — as of
 * 2026-09-23 — only for CENTER (see `centerLiveDeviceId`'s own doc comment
 * for the automatic per-device fallback to `centerPreviewDataUrl` if it
 * fails to open — this reopens, but does not blindly repeat, item
 * 12b/2026-09-09's original "CENTER stayed blank on common Windows UVC
 * drivers" field bug) and for idle-phase preview roles (`idlePreviewDeviceIds`,
 * 2026-09-15). Non-CENTER frames during an ACTIVE SESSION deliberately do
 * NOT open their own stream anymore — see the `neededDeviceIdsKey`
 * computation's own doc comment further down for the live field report and
 * confirmed root cause (this window's own attempt always lost the "one UVC
 * reader at a time" race against the main kiosk window's already-open
 * stream for the identical physical device); they render a relayed still
 * (`frame.livePreviewDataUrl`) instead, the same item-12b-style mechanism
 * CENTER's own `centerPreviewDataUrl` already used. Streams are keyed by
 * `deviceId` (not by step/role, so two roles sharing one physical device
 * reuse a single open stream instead of each trying their own) and reused
 * across pushes — the reconciliation effect below only opens a device it
 * does not already hold a stream for, and only stops one nothing needs live
 * anymore (a visibility toggle, hot-unplug, or phase change).
 */
export default function CbHelpFrames() {
  const [state, setState] = useState<CbHelpPublishState>(EMPTY_STATE);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const deviceLabelsRef = useRef<Map<string, string>>(new Map());
  const [, forceRerender] = useState(0);
  /** In-window camera-visibility config panel (2026-09-15) — see `CbHelpVisibilitySettings`'s own doc comment. Available in every phase (idle and active grid alike), not just while a session is live. */
  const [showSettings, setShowSettings] = useState(false);
  /** Read-only copy for `idlePreviewRoles` below — the settings panel itself (when open) has its own independent copy via the same hook. */
  const [visibility] = useCbHelpVisibility();

  /**
   * Whether `role`'s saved mapping (`state.cameraRoleMapping`) currently
   * resolves to a physically-connected device — i.e. this role could open a
   * real live stream right now. Used both to decide `idlePreviewRoles`
   * membership's live-vs-placeholder rendering and to dedup live devices
   * below.
   */
  function isRoleLive(role: CameraRole): boolean {
    const deviceId = state.cameraRoleMapping?.[role];
    return !!deviceId && (state.connectedDeviceIds ?? []).includes(deviceId);
  }

  /**
   * Which non-CENTER roles get a tile on the idle screen — 2026-09-15 field
   * request: the settings panel could already mark a LEFT/RIGHT/UP/DOWN
   * camera "visible", but nothing showed it until an actual capture session
   * started (`state.frames` is empty in `idle` phase — see
   * `CbHelpPublishState.frames`'s own doc comment).
   *
   * 2026-09-16 field request ("campaign đó có nhiều cam, và cần 3 cam, khi
   * tôi click chọn thì vẫn phải hiển thị các góc cam dù chưa được kết
   * nối"): a role now qualifies as soon as it's marked visible — connection
   * status no longer excludes it from the grid, it only decides what
   * renders INSIDE that role's tile (`isRoleLive` above: a live stream when
   * connected, a MISSING/UNASSIGNED placeholder otherwise — see the render
   * below). This lets an operator preparing a kiosk see every camera angle
   * the campaign's workflow expects (e.g. "cần 3 cam") and which ones still
   * need to be plugged in, rather than the tile just silently not existing.
   */
  const idlePreviewRoles = (() => {
    const visibleRoles = CB_HELP_ROLES.filter((role) => role !== 'CENTER' && visibility[role].visible).sort(
      (a, b) => visibility[a].order - visibility[b].order
    );

    // De-duplicated by physical device, but ONLY among roles that would
    // actually open a live stream (2026-09-15 field report: "rất lag, ...
    // hiển thị toàn bộ cam" — on a kiosk with fewer physical cameras than
    // roles, two+ roles can share one deviceId via the same fallback mapping
    // `resolveStepCamera` applies elsewhere; without this, each of those
    // roles opened its OWN `getUserMedia` for the identical device —
    // redundant negotiation, the lag — and rendered as separate, visually-
    // identical tiles). A role with no live feed (not connected, or not
    // mapped at all) has nothing to duplicate, so it always keeps its own
    // placeholder tile regardless of this dedup. CENTER's own device
    // (already covered by `centerPreviewDataUrl`, never opened as a second
    // stream here) claims its slot first, same reasoning the
    // `neededDeviceIdsKey` computation's own `centerLiveDeviceId` term
    // applies for the active-session case further down.
    const claimedDeviceIds = new Set<string>();
    const centerDeviceId = state.cameraRoleMapping?.CENTER;
    if (centerDeviceId) claimedDeviceIds.add(centerDeviceId);

    return visibleRoles.filter((role) => {
      if (!isRoleLive(role)) return true;
      const deviceId = state.cameraRoleMapping![role]!;
      if (claimedDeviceIds.has(deviceId)) return false;
      claimedDeviceIds.add(deviceId);
      return true;
    });
  })();

  /**
   * Full render order for the idle grid, CENTER included — 2026-09-16 fix
   * ("vị trí các cam khi được đổi thì trên giao diện chưa đổi"): the grid
   * below used to always render CENTER's tile FIRST, unconditionally, before
   * mapping `idlePreviewRoles` for the rest — so re-ordering CENTER in the
   * settings panel (its row has the same up/down controls as every other
   * role) visibly did nothing, since CENTER's position was never actually
   * driven by `visibility.CENTER.order` in the first place. This merges
   * CENTER into the same order-sorted list so its position (and every other
   * role's, relative to it) genuinely reflects the settings panel.
   *
   * Known limitation, not addressed here: if CENTER itself is unchecked
   * (hidden) while exactly one other role stays visible, this still falls
   * into the single-tile branch below, which is hardcoded to CENTER's own
   * live-stream/preview fields — an unlikely combination (CENTER is the
   * main required shot) not worth the extra branching for right now.
   */
  const idleGridRoles: CameraRole[] = (
    visibility.CENTER.visible ? [...idlePreviewRoles, 'CENTER' as const] : idlePreviewRoles
  ).sort((a, b) => visibility[a].order - visibility[b].order);

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

    // TEMP DIAGNOSTIC (2026-09-15, round 3) — "vẫn lag" after reopening
    // multiple times with no `[CbHelpDiag3]` open-success log AND no
    // `[cb-help] failed to open camera` error either: the CENTER live-stream
    // attempt (`centerLiveDeviceId`) is apparently never even reached, which
    // only happens if `state.cameraRoleMapping.CENTER` or
    // `state.connectedDeviceIds` is missing/empty at the moment this window
    // reads state. Logs exactly what actually arrives, once per distinct
    // value, to settle which one.
    let lastMappingDiagKey: string | null = null;
    const diagLogMapping = (s: CbHelpPublishState | null | undefined) => {
      const key = `${JSON.stringify(s?.cameraRoleMapping ?? null)}|${JSON.stringify(s?.connectedDeviceIds ?? null)}`;
      if (lastMappingDiagKey === key) return;
      lastMappingDiagKey = key;
      console.warn(
        `[CbHelpDiag3] cameraRoleMapping/connectedDeviceIds ${JSON.stringify({
          cameraRoleMapping: s?.cameraRoleMapping ?? null,
          connectedDeviceIds: s?.connectedDeviceIds ?? null,
        })}`
      );
    };

    let cancelled = false;
    faceAPI.getCbHelpState().then((s: CbHelpPublishState) => {
      diagLogMapping(s);
      if (!cancelled) setState(s ?? EMPTY_STATE);
    });

    const unsubscribe = faceAPI.onCbHelpUpdate?.((s: CbHelpPublishState) => {
      diagLogMapping(s);
      setState(s ?? EMPTY_STATE);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /**
   * Direct tethered live-view poll (2026-09-23 — "vẫn khá lag, cần mượt như
   * màn action chụp"). Diagnostic logging (now removed) proved the actual
   * bottleneck: `centerPreviewDataUrl` was relayed through the MAIN kiosk
   * window's own `publishCbHelpState`/`tetheredPreview` poll, and that
   * window's JS thread is busy running real-time face-detection ML
   * inference continuously — measured gaps between consecutive
   * `cbhelp:update` pushes averaged ~350ms (up to ~900ms). This window's own
   * JS thread has no such competing workload, so it now polls
   * `getTetheredLiveViewFrame()` directly, the same call and the same
   * backoff shape `TetheredCameraPanel.tsx`/`FaceCaptureApp.tsx` already
   * use, completely bypassing the busy relay for this one field. Falls
   * back to the relayed `state.centerPreviewDataUrl` (see the 3 read sites
   * below) only for the brief window before this poll's own first frame
   * lands, so there's still something to show immediately on open.
   *
   * `BASE_INTERVAL_MS` (2026-09-24 fix, confirmed audit finding): this was
   * left at 60ms — a leftover from the same 2026-09-23 experiment
   * `TetheredCameraPanel.tsx`/`FaceCaptureApp.tsx`/`CampaignGate.tsx` were
   * all reverted back to 200ms from, the same day, once it turned out 60ms
   * was fast enough to measurably compete with real webcams' own idle
   * preview streams. This poll runs in its own separate `BrowserWindow`, so
   * it does not hit that exact contention itself, but a 60ms cadence here
   * still made `tetheredCamera.ts`'s unrelated capture/live-view race (this
   * poll racing a real multi-second Canon shutter release for the same
   * USB/PTP session) far more likely to actually land. Matched back to
   * 200ms, same as the other three pollers, per this file's own doc comment
   * a few lines up ("the same backoff shape ... already use").
   */
  const [tetheredCenterPreview, setTetheredCenterPreview] = useState<string | null>(null);
  const centerIsTethered = state.cameraRoleMapping?.CENTER === TETHERED_DEVICE_ID;
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    if (!centerIsTethered || !faceAPI?.getTetheredLiveViewFrame) {
      setTetheredCenterPreview(null);
      return;
    }
    const BASE_INTERVAL_MS = 200;
    const MAX_INTERVAL_MS = 8000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await faceAPI.getTetheredLiveViewFrame();
        if (cancelled) return;
        if (result?.ok) {
          setTetheredCenterPreview(result.dataUrl);
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
        }
      } catch {
        consecutiveFailures += 1;
      }
      if (cancelled) return;
      const delay = Math.min(BASE_INTERVAL_MS * 2 ** consecutiveFailures, MAX_INTERVAL_MS);
      timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [centerIsTethered]);

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
  // Idle-preview device ids (2026-09-15) — only relevant in `idle` phase;
  // once a real session starts, non-CENTER frames no longer open their own
  // stream at all (2026-09-23 fix, see this const's sibling comment below
  // on `neededDeviceIdsKey` for why), so this stays scoped to `idle` phase
  // alone regardless — there is no "already live-streaming" case to avoid
  // duplicating anymore. Filtered to `isRoleLive` (2026-09-16) —
  // `idlePreviewRoles` now also includes roles with no connected device at
  // all (see its own doc comment), and there is nothing to open a stream
  // FOR those; they render a MISSING/UNASSIGNED placeholder below instead.
  const idlePreviewDeviceIds =
    state.phase === 'idle'
      ? idlePreviewRoles.filter(isRoleLive).map((role) => state.cameraRoleMapping![role] as string)
      : [];
  // CENTER's own live stream attempt (2026-09-15, "muốn mượt như ở màn
  // action" field request) — see `centerLiveStream`'s own read site below
  // for the full item-12b history this reopens: a live `getUserMedia` for
  // CENTER was removed because a second concurrent reader of the SAME
  // physical device commonly fails on Windows UVC webcam drivers, leaving
  // the tile fully blank with no fallback. This attempts it again, but —
  // unlike the original item-12b code — with an automatic, per-device
  // fallback: if `getUserMedia` for this id rejects (logged once by the
  // reconciliation effect below, same as any other device), it simply
  // never lands in `streamsRef`, and every CENTER render below already
  // passes BOTH `stream` and `imagePath` — `FrameTile` itself prefers
  // `stream` when present and only falls back to `imagePath` when
  // `!stream` (see its own doc comment on that prop combination), so a
  // failed open here silently degrades back to the existing
  // `centerPreviewDataUrl` snapshot instead of a blank tile. Best case (the
  // driver tolerates it): real smooth video, same as the main window.
  // Worst case: exactly today's snapshot behavior, never worse.
  const centerLiveDeviceId = (() => {
    const id = state.cameraRoleMapping?.CENTER;
    return id && (state.connectedDeviceIds ?? []).includes(id) ? id : null;
  })();
  // Non-CENTER active-session frames deliberately do NOT contribute their
  // deviceId here anymore (2026-09-23 fix, live field report, quoted
  // verbatim: "màn extend khi mở chọn cam giữa thì hiển thị cả 3 góc cam
  // nhưng ảnh chỉ của cam giữa" — all 3 tiles show during an active
  // session, but only CENTER ever has a real image). Confirmed root cause
  // by reading `FaceCaptureApp.tsx`'s own `frameStreamsRef`/
  // `openRoundStreams`/`openFrameStreams`: the MAIN kiosk window already
  // holds an EXCLUSIVE `getUserMedia` open for every non-CENTER frame's
  // physical device for the entire active-session lifetime (not just while
  // that frame is the CURRENT shot) — the identical "one UVC reader at a
  // time" driver contention `centerLiveDeviceId` above already documents
  // for CENTER, and `CampaignGate.tsx`'s `pausedForSetup` documents for the
  // Camera Setup popup, just contended against the active session's OWN
  // streams this time. This window's second `getUserMedia` for that same
  // deviceId always lost that race and failed silently (`NotReadableError:
  // Device in use`, logged by the reconciliation effect below), leaving
  // every non-CENTER tile blank — exactly the reported symptom. Removed the
  // attempt entirely rather than adding yet another pause/resume IPC
  // coordination pair (the pattern `pausedForSetup` uses): unlike the
  // Camera Setup popup, there is no natural point where the active session
  // would ever release these devices, so "pause the session's own streams
  // while CB Help needs them" is not an option here. Instead each frame now
  // carries its own `livePreviewDataUrl` (see `CbHelpFrame`'s own doc
  // comment) — a periodic still relayed from the main window's ALREADY-open
  // stream, the exact same mechanism item 12b already uses for CENTER's own
  // `centerPreviewDataUrl` (see `FaceCaptureApp.tsx`'s `publishCbHelpState`)
  // — rendered below instead of a live `<video>` (see the `sideLiveImage`
  // computation further down).
  const neededDeviceIdsKey = [
    ...idlePreviewDeviceIds,
    ...(centerLiveDeviceId ? [centerLiveDeviceId] : []),
  ]
    .sort()
    .join(',');
  const centerLiveStream = centerLiveDeviceId ? streamsRef.current.get(centerLiveDeviceId) ?? null : null;

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
          // TEMP DIAGNOSTIC (2026-09-15, round 3) — "muốn mượt như ở màn
          // action" / "vẫn lag và khá delay" field report: confirms whether
          // CENTER's own live-stream attempt (`centerLiveDeviceId`) actually
          // succeeds in THIS window, since success is otherwise silent (only
          // the catch branch below logs anything) — no news was ambiguous
          // ("no error" could mean "opened fine" or "never even tried").
          const track = stream.getVideoTracks()[0];
          console.warn(
            `[CbHelpDiag3] opened live stream for ${deviceId}: ${JSON.stringify({
              settings: track?.getSettings?.() ?? null,
            })}`
          );
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

  // Gear toggle for `CbHelpVisibilitySettings` — same "always available,
  // every phase" placement as `cornerBadge` above, so an operator can
  // reconfigure which cameras show without waiting for a session to start.
  const settingsToggle = (
    <button
      onClick={() => setShowSettings((v) => !v)}
      className="absolute right-4 top-4 z-20 rounded-lg bg-slate-900/90 p-2 text-slate-400 shadow-lg hover:text-slate-100"
      aria-label="Cấu hình hiển thị camera"
      title="Cấu hình hiển thị camera"
    >
      <Settings className="h-4 w-4" />
    </button>
  );

  if (state.phase === 'idle' || state.frames.length === 0) {
    // 2026-09-15 field request: previously this screen only ever showed
    // CENTER, regardless of the settings panel — `idlePreviewRoles` (see
    // its own doc comment) is the visible, mapped, connected non-CENTER
    // cameras, so a grid renders here whenever there's more than one tile
    // total (`idleGridRoles`, CENTER included — see its own doc comment).
    const showGrid = idleGridRoles.length > 1;
    return (
      <div className="relative w-screen h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-6 overflow-hidden p-4">
        {cornerBadge}
        {showSettings ? <CbHelpVisibilitySettings onClose={() => setShowSettings(false)} /> : settingsToggle}
        {showGrid ? (
          <div
            className="flex-1 min-h-0 w-full grid justify-center mx-auto"
            style={{
              gridTemplateColumns: `repeat(${idleGridRoles.length}, minmax(0, 1fr))`,
              maxWidth: `${idleGridRoles.length * MAX_TILE_WIDTH_VW}vw`,
              gap: TILE_GAP_PX,
            }}
          >
            {idleGridRoles.map((role) => {
              if (role === 'CENTER') {
                return (
                  <FrameTile
                    key="CENTER"
                    size="large"
                    className="w-full h-full"
                    label="FRONT"
                    roleLabel={CAMERA_ROLE_LABELS_VI.CENTER}
                    deviceLabel={centerLiveDeviceId ? deviceLabelsRef.current.get(centerLiveDeviceId) ?? null : null}
                    stream={centerLiveStream}
                    status="READY"
                    imagePath={tetheredCenterPreview ?? state.centerPreviewDataUrl}
                    mirrored={CAPTURE_MIRRORED}
                    showCompositionGrid
                  />
                );
              }
              const deviceId = state.cameraRoleMapping?.[role];
              const live = isRoleLive(role);
              // MISSING: mapped to a real device, just not plugged in right
              // now — same status/label ("Thiếu camera") `MultiFrameGrid`
              // already uses for exactly this during an active session.
              // UNASSIGNED: this role has no saved device at all yet.
              const status = live ? 'READY' : deviceId ? 'MISSING' : 'UNASSIGNED';
              return (
                <FrameTile
                  key={role}
                  size="large"
                  className="w-full h-full"
                  label={role}
                  roleLabel={CAMERA_ROLE_LABELS_VI[role]}
                  deviceLabel={live && deviceId ? deviceLabelsRef.current.get(deviceId) ?? null : null}
                  stream={live && deviceId ? streamsRef.current.get(deviceId) ?? null : null}
                  status={status}
                  mirrored={CAPTURE_MIRRORED}
                />
              );
            })}
          </div>
        ) : (
          /* Live CENTER camera feed (2026-09-10, "camera live vẫn phải hiển
             thị") — proves the kiosk's cameras are actively working between
             students instead of leaving this screen fully blank; publisher
             side already stopped gating this on an active session, see
             FaceCaptureApp.tsx's own centerPreviewDataUrl doc comment.
             Only used when no OTHER camera is also marked visible — with
             more than one, the grid above (which already includes CENTER)
             takes over instead, so CENTER is never shown twice.

             2026-09-15 ("muốn mượt như ở màn action"): now a `FrameTile`
             instead of a plain `<img>` — same live-stream-with-fallback as
             every other CENTER render in this file (see
             `centerLiveDeviceId`'s own doc comment), and it comes with
             mirroring already built in, closing the exact gap the previous
             version's own comment here had to patch by hand. */
          (centerLiveStream || state.centerPreviewDataUrl) && (
            <FrameTile
              size="large"
              // Height-driven sizing (2026-09-16 field request: "hiển thị lớn
              // hơn tránh bị nhỏ ở chính giữa") — the previous `max-w-3xl`
              // capped this at a flat 768px regardless of screen size, which
              // reads as tiny and lost in the middle of a large external
              // display. Sizing off viewport HEIGHT instead (with `w-auto` so
              // `aspect-video` derives the matching width) lets it fill most
              // of the vertical space this idle screen actually has, since
              // the container is a `flex-col` column with only the caption
              // text below competing for room; `max-w-[92vw]` is just a
              // safety net for an unusually narrow/tall window.
              className="w-auto h-[70vh] max-w-[92vw] aspect-video rounded-2xl"
              label="FRONT"
              roleLabel={CAMERA_ROLE_LABELS_VI.CENTER}
              deviceLabel={centerLiveDeviceId ? deviceLabelsRef.current.get(centerLiveDeviceId) ?? null : null}
              stream={centerLiveStream}
              status="READY"
              imagePath={tetheredCenterPreview ?? state.centerPreviewDataUrl}
              mirrored={CAPTURE_MIRRORED}
              showCompositionGrid
            />
          )
        )}
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
      {showSettings ? <CbHelpVisibilitySettings onClose={() => setShowSettings(false)} /> : settingsToggle}
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
        2-over-1/2x2 grouping, just `repeat(N, ...)` columns that every frame
        count from 1 to 5 fits into equally. `FrameTile`'s `size="large"`
        variant stretches to fill whatever box it is given (see its own doc
        comment), so each column's video/photo covers it edge-to-edge —
        cropping a 16:9 feed's sides into the tall column shape is expected
        and fine.

        The grid's total width is capped at `frames.length * MAX_TILE_WIDTH_VW`
        and the row centered (2026-09-15 field request: "nếu hiển thị không
        hết khung hình thì sẽ gom lại giữa, giới hạn độ rộng của màn hình") —
        with the CB Help visibility panel able to hide down to just 1-2 tiles
        now, an unconstrained container would stretch a lone CENTER tile
        across the ENTIRE screen width, badly distorting its crop. Capping
        `maxWidth` on the CONTAINER (not each column's own track size —
        see `MAX_TILE_WIDTH_VW`'s own doc comment for why `minmax(0, min(1fr,
        ...))` per column is invalid CSS and silently broke this into a
        single-column row-stack) only ever narrows the grid below its natural
        full-width share (never widens it — 5 tiles' natural width is already
        well under the cap, so this changes nothing for the full 5-camera
        layout). Centering that now-narrower box needs `mx-auto` on the grid
        element itself (2026-09-15, second pass — "cam chưa đẩy ra giữa" field
        report): `justify-content: center` alone does NOT do this — it only
        distributes leftover space AMONG the grid's own tracks, within the
        grid box's OWN (already `maxWidth`-shrunk) content area, and since
        the tracks here are `1fr` (always expand to fill 100% of whatever
        width the box has), there is never any leftover space inside the box
        for `justify-content` to redistribute. `mx-auto` is what centers the
        shrunk BOX itself within ITS OWN parent (ordinary block-level
        auto-margin centering) — `justify-content: center` is kept only for
        the (currently theoretical) case a future change gives a track less
        than its `1fr` share.
      */}
      <div
        className="flex-1 min-h-0 w-full grid justify-center mx-auto"
        style={{
          gridTemplateColumns: `repeat(${state.frames.length}, minmax(0, 1fr))`,
          maxWidth: `${state.frames.length * MAX_TILE_WIDTH_VW}vw`,
          gap: TILE_GAP_PX,
        }}
      >
        {state.frames.map((frame) => {
          // CENTER (2026-09-15, "muốn mượt như ở màn action" — see
          // `centerLiveDeviceId`'s own doc comment for the item-12b history
          // and the automatic fallback): tries its own live stream first,
          // same as every other frame, falling back to the periodic
          // `centerPreviewDataUrl` snapshot only if that stream never opened
          // — `FrameTile` itself picks between the two (prefers `stream`,
          // falls back to `imagePath` only when `!stream`), so both are
          // always passed here unconditionally. Once COMPLETED, the real
          // captured photo takes over regardless, exactly like every other
          // frame (same `FrameTile` rule: `status === 'COMPLETED'` wins).
          const isCenter = frame.role === 'CENTER';
          const centerLiveImage =
            isCenter && frame.status !== 'COMPLETED' ? tetheredCenterPreview ?? state.centerPreviewDataUrl : null;
          // Non-CENTER (2026-09-23 fix — see the `neededDeviceIdsKey`
          // computation's own doc comment above for the full root-cause
          // story). This window no longer opens its own competing stream
          // for a non-CENTER frame during an active session, so `stream`
          // below is always `null` for one UNLESS it happens to share
          // CENTER's exact physical device (the
          // `streamsRef.current.get(frame.deviceId)` fallback below still
          // picks that up for free — see `centerLiveDeviceId`'s own doc
          // comment). The relayed `frame.livePreviewDataUrl` — a periodic
          // still of the main window's ALREADY-open stream for this exact
          // device, pushed by `FaceCaptureApp.tsx`'s `publishCbHelpState` —
          // fills the gap `imagePath` needs for every other case, same
          // "prefers stream, falls back to imagePath" `FrameTile` rule
          // CENTER already relies on above.
          const sideLiveImage =
            !isCenter && frame.status !== 'COMPLETED' ? frame.livePreviewDataUrl ?? null : null;
          return (
            <FrameTile
              key={frame.stepId}
              size="large"
              className="w-full h-full"
              label={frame.label}
              roleLabel={CAMERA_ROLE_LABELS_VI[frame.role as CameraRole] ?? frame.role}
              deviceLabel={frame.deviceId ? deviceLabelsRef.current.get(frame.deviceId) ?? null : null}
              stream={isCenter ? centerLiveStream : frame.deviceId ? streamsRef.current.get(frame.deviceId) ?? null : null}
              status={frame.status}
              imagePath={centerLiveImage ?? sideLiveImage ?? frame.capturedDataUrl}
              mirrored={CAPTURE_MIRRORED}
              // 2026-09-15 field request: the extended display's CENTER tile
              // (the printed/matched photo — always shown by default, see
              // `DEFAULT_CB_HELP_VISIBILITY` in FaceCaptureApp.tsx) needs the
              // same rule-of-thirds composition guide the main kiosk window's
              // own CENTER stage already has (`DesktopCaptureView.tsx`), so a
              // CB Help watcher can also judge framing.
              showCompositionGrid={isCenter}
            />
          );
        })}
      </div>
    </div>
  );
}
