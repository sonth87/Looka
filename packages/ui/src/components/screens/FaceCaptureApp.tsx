import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { SlidersHorizontal, Camera, Monitor } from 'lucide-react';
import {
  CameraDevice,
  CaptureSession,
  CaptureSensitivity,
  CaptureTriggerMode,
  CaptureWorkflow,
  FaceState,
  FrameInput,
  GestureState,
  GuidanceState,
  defaultCameraRoleForStepType,
} from '@face/core';
import { BrowserCameraService } from '@face/camera';
import { MockCVEngine, FramePipeline } from '@face/cv-engine';
import { MediaPipeCVEngine } from '@face/cv-mediapipe';
import { MediaPipeGestureEngine } from '@face/hand-gesture';
import { WorkflowEngine, CaptureTriggerEvaluator } from '@face/workflow-engine';
import {
  framesForWorkflow,
  checkFramesReadiness,
  snapshotVideoFrame,
  allSideFramesReady,
  firstNotReadyFrameRole,
  CAMERA_ROLE_LABELS_VI,
  FramePreflight,
  FrameSpec,
} from '../../lib/multiFrame.js';
import {
  shouldRecordSingleStream,
  shouldRecordMultiChannel,
  isRecordingOverCap,
  MAX_RECORDING_DURATION_MS,
} from '../../lib/recordingGate.js';
import type { MultiFrameViewProps, MultiFrameViewFrame } from './views/types.js';
import { GuidedCaptureScreen } from './GuidedCaptureScreen.js';
import { SessionReviewModal } from '../workflow/SessionReviewModal.js';
import { CAPTURE_MIRRORED } from '../camera/CameraPreview.js';
import { SimulationSliders, SimulationSettings } from '../debug/SimulationSliders.js';
import { StepItem } from '../workflow/StepProgress.js';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip.js';
import { getSettings, updateSettings } from '../../lib/settingsStore.js';
import { CaptureSink, RunScopedCaptureSession } from '../../lib/CaptureSink.js';
import type { ApprovalStepInfo } from '../../lib/CaptureSink.js';
import { SQLiteStorageAdapter, SessionRepository } from '@face/database';

const defaultWorkflow: CaptureWorkflow = {
  id: 'workflow_standard_5step',
  name: 'Quy trình 5 hướng chuẩn',
  version: 1,
  steps: [
    {
      id: 'step-front',
      type: 'FRONT',
      instruction: 'Nhìn thẳng vào camera',
      // Widened for real degrees. The 7 here was set when pitch and yaw came
      // from a 2D proxy whose numbers stayed small whatever the head did; a
      // solved 3D pose reports the actual angle, and a webcam sitting below eye
      // level already puts a seated person 10 degrees or so off axis before
      // they have moved at all.
      //
      // roll was missing entirely here, so a tilted head passed FRONT
      // unflagged — StepEvaluator only checks an axis the step actually
      // declares a target for, and this is meant to be the one straight,
      // level reference shot of the five.
      pose: {
        yaw: { target: 0, tolerance: 12 },
        pitch: { target: 0, tolerance: 12 },
        roll: { target: 0, tolerance: 12 },
      },
      // Posture/shoulder-level checking is skipped for every step, not just
      // LEFT/RIGHT — see postureCheck on those steps for the mechanism.
      postureCheck: false,
      capture: { enabled: true },
    },
    {
      id: 'step-left',
      type: 'LEFT',
      instruction: 'Quay mặt sang trái (15° - 30°)',
      // Was target -65/tolerance 25 (a 40-90 degree window) — a much shallower
      // turn than the operator actually wants for this angle. At 15-30 degrees
      // perspective foreshortening (~cos(yaw)) is negligible (0.97x-0.87x), so
      // the FACE_TOO_SMALL floor this used to need at the old, deeper angle
      // no longer applies — MEDIUM's default minFaceSizeRatio is fine here.
      pose: { yaw: { target: -22.5, tolerance: 7.5 } },
      postureCheck: false,
      capture: { enabled: true },
    },
    {
      id: 'step-right',
      type: 'RIGHT',
      instruction: 'Quay mặt sang phải (15° - 30°)',
      pose: { yaw: { target: 22.5, tolerance: 7.5 } },
      postureCheck: false,
      capture: { enabled: true },
    },
    {
      id: 'step-up',
      type: 'UP',
      instruction: 'Ngẩng đầu lên (15° - 35°)',
      // Positive pitch is looking up — the convention documented on
      // PoseEstimator. These two were swapped, so the step asked the subject
      // to look down while the hint told them the opposite, and it could not
      // be completed by following its own instruction.
      // Real degrees now: the angle comes from MediaPipe's solved 3D pose
      // rather than from how far the nose appears to sit below the eye line.
      pose: { pitch: { target: 25, tolerance: 10 } },
      capture: { enabled: true },
    },
    {
      id: 'step-down',
      type: 'DOWN',
      instruction: 'Cúi đầu xuống (15° - 35°)',
      pose: { pitch: { target: -25, tolerance: 10 } },
      capture: { enabled: true },
    },
  ],
};

/**
 * The steps a session actually runs — `defaultWorkflow` above, unless the
 * kiosk's campaign configures its own set (`captureAngles`, see
 * docs/plans/multi-camera-device-management-discussion.md §3.6). Called at
 * the start of every session, not cached here: `window.faceAPI.getDeviceAccessStatus()`
 * already has its own process-lifetime cache on the main-process side (see
 * `deviceApi.ts`), so re-reading it here just picks up whatever change an
 * admin made without needing a restart — resolving open question #3 in that
 * doc's §4 in favor of "next session picks it up." Also carries §3.3's
 * fail-closed verdict (`blockedReason`) — see this function's return type.
 *
 * `(window as any).faceAPI` rather than a typed global: matches how the rest
 * of this package already reaches the preload bridge (see CaptureSink.ts and
 * SessionReviewModal.tsx) without pulling apps/desktop's preload types into a
 * package the web app also builds, where that global does not exist at all —
 * which is also why this is wrapped in try/catch and always has
 * `defaultWorkflow` to fall back to: the web build, and any error reaching
 * the admin portal, must never block a session from starting.
 */
async function resolveActiveWorkflow(): Promise<{
  workflow: CaptureWorkflow;
  triggerConfig: {
    mode: CaptureTriggerMode;
    autoHoldMs: number;
    /**
     * True when the campaign itself set `captureMode` (`config?.captureMode`
     * below was non-null/non-undefined) — carried through to
     * `effectiveTriggerConfig.fromCampaign` in FaceCaptureApp so the settings
     * UI (DesktopCaptureView's mode picker, OverlayConfigPanel) can show
     * "Theo cấu hình campaign" and stop the operator from locally picking a
     * mode the WorkflowEngine was never actually told to honour. See the bug
     * this field fixes, 2026-09-05: a campaign-forced OFF/MANUAL mode used to
     * never reach the capture views at all, which kept rendering whatever
     * this machine's own local settings said instead.
     */
    fromCampaign: boolean;
  };
  /**
   * §3.3's fail-closed verdict — non-null means the caller must refuse to
   * start a session at all, not merely fall back to defaultWorkflow. Distinct
   * from a config-fetch error (handled below by falling back, same as
   * always): this is the admin portal actively saying this device may not
   * capture, or having said nothing confirmable in over 24h.
   */
  blockedReason: 'unauthorized' | 'unreachable-too-long' | null;
  /**
   * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture)
   * — true only when the campaign explicitly turns it on. Absent/undefined
   * on older builds' config is treated as false, same fallback-is-safe
   * reasoning as every other campaign-config field here.
   */
  simultaneousCapture: boolean;
  /**
   * Campaign-level "Quay video trong lúc chụp" switch (§3.1, 2026-09-05) —
   * true only when the campaign explicitly turns it on. Absent/undefined
   * (older server, or no campaign at all) is treated as false, same
   * fallback-is-safe reasoning as `simultaneousCapture` above: no
   * `capture_streams` row is created and neither recording effect in this
   * file runs unless this is true.
   */
  recordVideo: boolean;
}> {
  const faceAPI = (window as any).faceAPI;
  let workflow = defaultWorkflow;
  // Campaign-configured capture mode/hold time (§3.8) — undefined/null when
  // the campaign hasn't set one, in which case this machine's own local
  // settings (debug panel) decide, same as before this existed.
  let campaignMode: CaptureTriggerMode | null | undefined;
  let campaignAutoHoldMs: number | null | undefined;
  let blockedReason: 'unauthorized' | 'unreachable-too-long' | null = null;
  let simultaneousCapture = false;
  let recordVideo = false;
  try {
    const status = await faceAPI?.getDeviceAccessStatus?.();
    blockedReason = status?.blocked ? status.reason ?? 'unauthorized' : null;
    const config = status?.config;
    if (config?.captureAngles && Array.isArray(config.captureAngles) && config.captureAngles.length > 0) {
      workflow = { ...defaultWorkflow, steps: config.captureAngles };
    }
    campaignMode = config?.captureMode;
    campaignAutoHoldMs = config?.autoHoldMs;
    simultaneousCapture = config?.simultaneousCapture === true;
    recordVideo = config?.recordVideo === true;
  } catch (err) {
    console.error('[FaceCaptureApp] resolveActiveWorkflow failed, using defaultWorkflow:', err);
  }

  const settings = getSettings();
  return {
    workflow,
    triggerConfig: {
      mode: campaignMode ?? settings.captureMode ?? 'MANUAL',
      autoHoldMs: campaignAutoHoldMs ?? settings.autoHoldMs ?? 2000,
      fromCampaign: campaignMode != null,
    },
    blockedReason,
    simultaneousCapture,
    recordVideo,
  };
}

type StatsEventType =
  | 'SESSION_COMPLETED'
  | 'UPLOAD_SUCCESS'
  | 'UPLOAD_FAILED'
  | 'RETAKE'
  | 'CB_HELP_INTERVENTION'
  | 'SESSION_REPORT'
  | 'PHOTO_STATUS';

/**
 * Reports a stats-worthy moment (§3.4) to the desktop main process, if this
 * is running under the desktop app at all — a no-op on the web build, same
 * `(window as any).faceAPI` guard as `resolveActiveWorkflow`. Never throws:
 * a failed/impossible report must not interrupt the capture flow that
 * triggered it, so this is fire-and-forget from every call site.
 */
function reportStatsEvent(type: StatsEventType, metadata?: Record<string, unknown>): void {
  try {
    void (window as any).faceAPI?.recordStatsEvent?.({ type, metadata });
  } catch {
    /* no bridge, or not running under the desktop app — fine either way */
  }
}

/**
 * The CB Help extended-display window's own capture-frames snapshot (§3.5,
 * 2026-09-05 product decision — the window shows only the capture frames
 * live + captured, not a mirror of this whole app; see cbHelpWindow.ts's own
 * doc comment). Kept local to this file — the desktop app's preload bridge
 * (`apps/desktop/src/preload/index.ts`) declares its own copy of this same
 * shape rather than importing it, the same "duplicate the IPC payload shape
 * on each side" pattern every other `faceAPI` method here already follows.
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
   * The CB Help window's own presentation mode (§3.5, 2026-09-05 second
   * product decision: captured photos must stay visible after the shot).
   * `running` alone can no longer tell the window what to render, because
   * "not running" now covers two different things — a finished session
   * whose photos must stay up (`'review'` while SessionReviewModal is still
   * open, `'done'` once the operator has accepted it) vs. a genuinely empty
   * window with nothing to show (`'idle'`: no session yet, cancelled,
   * restarted, or live mode was left). `'live'` always matches
   * `running: true`. See `publishCbHelpState` below for how this is chosen.
   */
  phase: 'idle' | 'live' | 'review' | 'done';
  simultaneous: boolean;
  currentStepId: string | null;
  frames: CbHelpFrame[];
}

/**
 * Builds the CB Help window's per-frame snapshot from the live engine's own
 * session/state.
 *
 * One shape for both capture modes: sequential mode only fills in a
 * `deviceId` for whichever frame is CURRENT (falling back to the main
 * camera's own `selectedDeviceId`, since sequential mode already switches
 * that per step — see the role-mapping effect further down); simultaneous
 * mode fills in every frame's own mapped device regardless of which one is
 * "current", since every not-yet-COMPLETED frame is meant to go live at
 * once there. Deciding which frames actually go live in the CB Help window
 * itself is `CbHelpFrames.tsx`'s own call (simultaneous: everything not
 * COMPLETED; sequential: only CURRENT), not encoded in this payload.
 *
 * CENTER is special-cased to `currentDeviceId` in both modes, same as the
 * main window's own multi-frame grid does (`frame.role === 'CENTER' ?
 * selectedDeviceId : cameraRoleMapping[frame.role]` a bit further down) —
 * CENTER is deliberately never a key in `roleMapping` (it stays the one
 * analysed/active camera, not something the camera-setup screen assigns),
 * so reading `roleMapping['CENTER']` alone always misses and, in
 * simultaneous mode, fell through to `null` (the sequential-only fallback
 * below it never applied) — the CB Help window's CENTER tile then never
 * qualified as "live" and stayed blank even though the same camera was
 * clearly showing in the main window.
 */
function buildCbHelpFrames(
  workflow: CaptureWorkflow,
  session: CaptureSession | null,
  currentStepIndex: number,
  simultaneous: boolean,
  roleMapping: Record<string, string>,
  currentDeviceId: string
): CbHelpFrame[] {
  return framesForWorkflow(workflow).map((frame, idx) => {
    const sessionStep = session?.steps.find((st) => st.stepId === frame.stepId);
    const isCompleted = sessionStep?.status === 'COMPLETED';
    const isCurrent = !isCompleted && idx === currentStepIndex;
    const status: CbHelpFrameStatus = isCompleted
      ? 'COMPLETED'
      : isCurrent
      ? 'CURRENT'
      : sessionStep?.status === 'FAILED'
      ? 'FAILED'
      : 'PENDING';
    const mappedDeviceId =
      frame.role === 'CENTER' ? currentDeviceId || null : roleMapping[frame.role] ?? null;

    return {
      stepId: frame.stepId,
      stepType: frame.type,
      role: frame.role,
      label: frame.label,
      deviceId: mappedDeviceId ?? (!simultaneous && isCurrent ? currentDeviceId || null : null),
      status,
      capturedDataUrl: sessionStep?.capturedImagePath,
      attempt: sessionStep?.attempts ?? 0,
    };
  });
}

/**
 * Resolves once `video` has genuinely rendered a real frame — not merely
 * "has a stream attached." 2026-09-05 field bug this defends against: a
 * side camera's offscreen `<video>` can already report `videoWidth > 0`
 * while still delivering the driver's placeholder/negotiation buffer, so
 * checking `videoWidth`/`readyState` alone at the instant the shutter fires
 * is not enough — see `snapshotVideoFrame`'s own luminance guard in
 * lib/multiFrame.ts for the second, pixel-level layer of this same fix.
 *
 * Prefers `requestVideoFrameCallback` — every Chromium build this app ships
 * on (Electron) supports it, and it only fires once a decoded frame has
 * actually been presented to the compositor. Falls back to polling
 * `readyState`/`videoWidth` where it's unavailable (e.g. a test
 * environment's stubbed `HTMLVideoElement`).
 */
function markFrameReadyWhenPlaying(video: HTMLVideoElement, onReady: () => void): void {
  let settled = false;
  const markReady = () => {
    if (settled) return;
    settled = true;
    onReady();
  };

  const rvfc = (video as any).requestVideoFrameCallback;
  if (typeof rvfc === 'function') {
    rvfc.call(video, markReady);
    return;
  }

  const poll = () => {
    if (settled) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      markReady();
      return;
    }
    requestAnimationFrame(poll);
  };
  poll();
}

export interface FaceCaptureAppProps {
  appId?: string;
  windowId?: string;
  /**
   * Where captures are kept.
   *
   * Supplied by the host application: the desktop kiosk hands photos to its
   * main process, the web app posts them to a backend. Without one the screen
   * captures but stores nothing, and says so rather than appearing to work.
   */
  sink?: CaptureSink;
}

export function FaceCaptureApp(props: FaceCaptureAppProps) {
  const sink = props.sink ?? null;
  const [mode, setMode] = useState<'simulation' | 'live'>('live');

  const [theme, setTheme] = useState<'dark' | 'light'>(() => getSettings().theme || 'light');

  const toggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      updateSettings({ theme: nextTheme });
      return nextTheme;
    });
  };

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [faceState, setFaceState] = useState<FaceState | null>(null);
  const [gestureState, setGestureState] = useState<GestureState | null>(null);
  const [gestureProgress, setGestureProgress] = useState<number>(0);

  const initialGuidance: GuidanceState = {
    status: 'INITIALIZING',
    primaryInstruction: 'Hãy điều chỉnh slider để mô phỏng tư thế...',
    primaryReason: 'NO_FACE',
    progress: 0,
    hints: [],
    currentStepIndex: 0,
    totalSteps: 5,
    stepId: 'step-front',
    stepType: 'FRONT',
  };

  const [simGuidance, setSimGuidance] = useState<GuidanceState>(initialGuidance);
  const [liveGuidance, setLiveGuidance] = useState<GuidanceState>(initialGuidance);

  const [session, setSession] = useState<CaptureSession | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [cameraFps] = useState(30);
  const [cvFps, setCvFps] = useState(0);
  const [latestCapturedImage, setLatestCapturedImage] = useState<{ stepId: string; imagePath: string } | null>(null);
  const [sensitivity, setSensitivity] = useState<CaptureSensitivity>(() => getSettings().sensitivity || 'MEDIUM');
  const [showScreenDebugStats, setShowScreenDebugStats] = useState<boolean>(() => getSettings().showScreenDebugStats ?? true);

  const handleToggleShowScreenDebugStats = useCallback((show: boolean) => {
    setShowScreenDebugStats(show);
    updateSettings({ showScreenDebugStats: show });
  }, []);

  const [isWorkflowStarted, setIsWorkflowStarted] = useState<boolean>(false);
  const isWorkflowStartedRef = useRef(false);

  useEffect(() => {
    isWorkflowStartedRef.current = isWorkflowStarted;
  }, [isWorkflowStarted]);

  /**
   * The workflow actually running — `defaultWorkflow` until
   * `resolveActiveWorkflow()` resolves, at every session start, to whatever
   * the kiosk's campaign configures instead (see that function's own doc
   * comment). `stepsList` below renders from this, not `defaultWorkflow`
   * directly, so the on-screen step indicator matches whatever was actually
   * passed to `startSession`.
   */
  const [activeWorkflow, setActiveWorkflow] = useState<CaptureWorkflow>(defaultWorkflow);
  /**
   * §3.3's fail-closed verdict — non-null means every session-start call site
   * below must refuse to start one at all, and the render below replaces the
   * whole capture screen with a blocking message instead. Cleared the moment
   * a later `resolveActiveWorkflow()` call comes back unblocked (device
   * reactivated, connectivity restored within the 24h window, etc.).
   */
  const [deviceBlockedReason, setDeviceBlockedReason] = useState<'unauthorized' | 'unreachable-too-long' | null>(
    null
  );

  /**
   * Ref mirror of `activeWorkflow`, readable from inside the live engine's
   * capture-trigger handler below — that handler is registered once, inside
   * a mount-only effect (`useEffect(..., [])`), so it would otherwise only
   * ever see the `defaultWorkflow` this state started as. Same pattern as
   * `isWorkflowStartedRef`/`faceStateRef` elsewhere in this file.
   */
  const activeWorkflowRef = useRef<CaptureWorkflow>(defaultWorkflow);
  useEffect(() => {
    activeWorkflowRef.current = activeWorkflow;
  }, [activeWorkflow]);

  /**
   * The capture-trigger config actually in effect for whichever engine
   * (sim/live) the UI is currently showing — set at every call site that
   * hands a resolved config to an engine via `setCaptureTriggerConfig`
   * (`resolveActiveWorkflow`'s init/start/restart/cancel sites below), and by
   * `handleCaptureModeChange`/`handleAutoHoldMsChange` when the operator
   * changes it locally. Passed down to DesktopCaptureView/MobileCaptureView
   * as `captureMode`/`autoHoldMs` instead of letting them (via
   * GuidedCaptureScreen) fall back to their own copy read straight from the
   * local settings store — see the bug this fixes, 2026-09-05: a
   * campaign-forced OFF/MANUAL mode reached the engine (`WorkflowEngine.
   * setCaptureTriggerConfig`) but never reached the views, so a campaign set
   * to OFF still rendered the AUTO/MANUAL UI (no shutter button, a
   * misleading countdown ring) while the engine silently waited for a
   * shutter press that had no way to happen.
   */
  const [effectiveTriggerConfig, setEffectiveTriggerConfig] = useState<{
    mode: CaptureTriggerMode;
    autoHoldMs: number;
    /** True while `mode` came from the campaign, not this machine's local settings. */
    fromCampaign: boolean;
  }>({ mode: 'MANUAL', autoHoldMs: 2000, fromCampaign: false });

  /**
   * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture)
   * — the campaign's own `simultaneousCapture` flag, refreshed at every
   * session start/restart/cancel by `resolveActiveWorkflow()`, same cadence
   * as `deviceBlockedReason` above. Only ever acted on in live mode — see
   * the `multiFrame` prop built further down, which simulation mode never
   * receives regardless of this flag.
   */
  const [simultaneousCapture, setSimultaneousCapture] = useState<boolean>(false);
  /** Ref mirror of `simultaneousCapture`, for the same reason `activeWorkflowRef` exists above. */
  const simultaneousCaptureRef = useRef<boolean>(false);
  useEffect(() => {
    simultaneousCaptureRef.current = simultaneousCapture;
  }, [simultaneousCapture]);

  /**
   * Campaign-level "Quay video trong lúc chụp" switch (§3.1, 2026-09-05) —
   * the campaign's own `recordVideo` flag, refreshed at every session
   * start/restart/cancel by `resolveActiveWorkflow()`, same cadence as
   * `simultaneousCapture` above. Both recording effects further down are
   * gated on this: false means neither ever opens a `MediaRecorder` or
   * creates a `capture_streams` row.
   */
  const [recordVideo, setRecordVideo] = useState<boolean>(false);

  /**
   * The engine session actually being recorded, for the two recording
   * effects further down ONLY — `null` whenever no real (operator-started)
   * session is open. Deliberately keyed on the session's own id rather than
   * a plain boolean — see `recordingGate.ts`'s own doc comment for the full
   * mechanism this replaces and why.
   *
   * **2026-09-05 field bug this fixes**: a Windows kiosk running a 3-camera
   * simultaneous campaign with `recordVideo=true` had a session started,
   * abandoned by the operator with no cancel/complete ever firing, and its
   * recorders kept running — two `capture_streams` rows eventually closed at
   * ~234 MB each, one was left OPEN (`size_bytes=0`, `ended_at=null`). The
   * *next* real session then created NO recording rows at all. Root cause:
   * an earlier fix (still visible in ROADMAP.md's §3.1 history) replaced
   * gating these effects on `isWorkflowStarted` with a dedicated
   * `isRecordingSession` **boolean** — correctly separating "is a session
   * running" from "should recording be on" — but a boolean can't tell two
   * different sessions apart. The abandoned run left it stuck at `true`
   * (nothing resets it on mere inactivity — there was no idle/runaway cap at
   * all), so the next session's `setIsRecordingSession(true)` was a no-op
   * (same value in, no re-render), the effects' dependency arrays never
   * changed, and they never re-ran: the stale recorder from the abandoned
   * run just kept going while the new session got no recorder of its own.
   *
   * **Fix**: this key is set to the engine's actual `currentSession.id` the
   * moment a real session starts (`handleStartWorkflow`, the only call site
   * that ever set the old flag `true`) — a brand-new session always has a
   * genuinely different id, so the effects' dependency arrays always change
   * and always restart, even if the previous session's teardown never ran.
   * Reset to `null` at every real end-of-session point, same set of call
   * sites the old flag used — the engine's `completed` event (live and
   * simulation), `handleCancelWorkflow`, `handleRestart`, and leaving live
   * mode — each of which also causes the effects to clean up (stop every
   * recorder, finalize via `endVideoStream`) since the key changes away from
   * a real value. A session with no operator action *at all* (this bug's
   * exact scenario) is additionally bounded by a runaway cap inside the
   * effects themselves (`isRecordingOverCap`/`MAX_RECORDING_DURATION_MS` in
   * recordingGate.ts) — after 10 minutes the recording stops and finalizes
   * on its own, logged, regardless of whether anything else ever happens.
   */
  const [recordingSessionKey, setRecordingSessionKey] = useState<string | null>(null);

  /**
   * Latest simultaneous-capture readiness check — non-null once
   * `runFramePreflight` has run at least once. `!ok` means the session must
   * not start; rendered via GuidedCaptureScreen's `multiFrame.blocked` prop.
   */
  const [framePreflight, setFramePreflight] = useState<FramePreflight | null>(null);
  /**
   * One MediaStream per non-CENTER frame's physical camera, opened by
   * `openFrameStreams` right before a simultaneous-capture session starts.
   * The ref is what every other piece of logic here actually reads (capture
   * snapshots, the multi-channel recording effect's reuse path below); the
   * state mirror exists only so FrameTile's `stream` prop re-renders when a
   * stream opens or closes.
   */
  const frameStreamsRef = useRef<Record<string, MediaStream>>({});
  const [frameStreams, setFrameStreams] = useState<Record<string, MediaStream>>({});
  /**
   * One offscreen `<video>` per non-CENTER frame, fed from the same stream
   * in `frameStreamsRef` and kept playing — so a CENTER capture's snapshot
   * of every other frame (see the capture-trigger handler below) never has
   * to wait on `play()` at the exact instant the shutter fires.
   */
  const frameVideoElsRef = useRef<Record<string, HTMLVideoElement>>({});
  /**
   * Whether each non-CENTER frame's offscreen `<video>` (`frameVideoElsRef`)
   * has actually rendered a real frame yet — 2026-09-05 black-frame fix (see
   * `allSideFramesReady`/`snapshotVideoFrame` in lib/multiFrame.ts): a
   * stream being attached (`frameStreamsRef`) is not the same thing as the
   * camera actually delivering pixels, and the RIGHT camera's tile still
   * read "not ready" at the exact instant the shutter fired in the field
   * report this fixes. Absent from the map (not just `false`) also means
   * "not ready" — see the pure helpers' own doc comments. The ref is read
   * everywhere gating actually happens (the shutter-enable computation
   * below reads `frameReadiness` state instead, since that's what needs to
   * re-render); `frameReadinessRef` exists only so `openFrameStreams`'
   * readiness callback (which can fire well after the function that started
   * it has returned) always sees the latest map instead of a stale closure.
   */
  const frameReadinessRef = useRef<Record<string, boolean>>({});
  const [frameReadiness, setFrameReadiness] = useState<Record<string, boolean>>({});

  /** Stops and clears every open frame stream — see the call sites below. */
  const closeFrameStreams = () => {
    for (const [stepId, mediaStream] of Object.entries(frameStreamsRef.current)) {
      mediaStream.getTracks().forEach((t) => t.stop());
      const videoEl = frameVideoElsRef.current[stepId];
      if (videoEl) videoEl.srcObject = null;
    }
    frameStreamsRef.current = {};
    setFrameStreams({});
    frameReadinessRef.current = {};
    setFrameReadiness({});
  };

  /**
   * Refreshes the camera role mapping and connected devices, then checks
   * every frame the workflow needs against them (see `checkFramesReadiness`
   * in lib/multiFrame.ts). Always re-reads both rather than trusting
   * whatever `cameraRoleMapping`/`devices` state already holds — the same
   * reasoning `resolveActiveWorkflow` gives for re-reading campaign config
   * on every session start: an admin can change the mapping, or a camera
   * can be plugged/unplugged, between sessions with no restart in between.
   */
  const runFramePreflight = async (workflow: CaptureWorkflow): Promise<FramePreflight> => {
    const faceAPI = (window as any).faceAPI;
    let mapping: Record<string, string> = {};
    try {
      mapping = (await faceAPI?.getCameraRoleMapping?.()) ?? {};
    } catch {
      /* no bridge, or no mapping saved yet — stay on {} */
    }
    setCameraRoleMapping(mapping);

    let devs = devices;
    try {
      devs = (await cameraServiceRef.current?.enumerateDevices()) ?? devices;
      setDevices(devs);
    } catch (err) {
      console.error('[FaceCaptureApp] runFramePreflight enumerateDevices failed:', err);
    }

    const frames: FrameSpec[] = framesForWorkflow(workflow);
    const preflight = checkFramesReadiness(frames, mapping, devs);
    setFramePreflight(preflight);
    return preflight;
  };

  /**
   * Opens one dedicated getUserMedia stream per non-CENTER frame (CENTER
   * keeps using `cameraServiceRef`'s already-open stream — see the CENTER
   * device-switch in `runSimultaneousCaptureGate` below). Idempotent: a
   * frame whose stream from a previous call is still live is left alone
   * instead of opened a second time, so a restart/cancel that resolves back
   * to the same mapping never double-opens a physical camera — the same
   * kind of USB/driver contention this file's other multi-camera effects
   * already warn about.
   */
  const openFrameStreams = async (preflight: FramePreflight): Promise<boolean> => {
    for (const frame of preflight.frames) {
      if (frame.role === 'CENTER' || !frame.deviceId) continue;

      const existing = frameStreamsRef.current[frame.stepId];
      if (existing && existing.getTracks().some((t) => t.readyState === 'live')) continue;

      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          // 1280x720, not 1920x1080: these are process-evidence frames, not
          // the printed/matched photo (§2.8's resolution floor is FRONT-only
          // by product decision 2026-09-05), and three cameras sharing one
          // USB bus need the FRONT camera to keep the bandwidth for its own
          // 1080p capture rather than splitting it three ways.
          video: { deviceId: { exact: frame.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        frameStreamsRef.current[frame.stepId] = mediaStream;

        // 2026-09-05 black-frame fix: a genuinely new stream starts "not
        // ready" until it actually renders a frame — see
        // `frameReadinessRef`'s own doc comment and `markFrameReadyWhenPlaying`
        // below. Not reset on the idempotent reuse path above (an already-live
        // stream this function left alone is presumably already ready).
        frameReadinessRef.current[frame.stepId] = false;
        setFrameReadiness((prev) => ({ ...prev, [frame.stepId]: false }));

        let videoEl = frameVideoElsRef.current[frame.stepId];
        if (!videoEl) {
          videoEl = document.createElement('video');
          videoEl.muted = true;
          videoEl.playsInline = true;
          frameVideoElsRef.current[frame.stepId] = videoEl;
        }
        videoEl.srcObject = mediaStream;
        videoEl.play().catch((err: any) =>
          console.error(
            `[FaceCaptureApp] frame stream failed for ${frame.label}: ${err?.name}: ${err?.message}`
          )
        );
        markFrameReadyWhenPlaying(videoEl, () => {
          frameReadinessRef.current[frame.stepId] = true;
          setFrameReadiness((prev) => ({ ...prev, [frame.stepId]: true }));
        });

        // Diagnostic for the field issue "FRONT face < 250px with three
        // cameras open": records what the OS/driver actually granted this
        // side camera, so a kiosk with three cameras contending for one USB
        // bus shows the trade-off in main.log instead of only showing up
        // later as a downstream quality failure on the FRONT frame.
        //
        // Formatted as one string (JSON.stringify), not a message + object:
        // Electron's `console-message` forwarding to the main process only
        // carries the renderer console call's first string argument — a
        // second object argument used to be dropped before reaching
        // main.log, showing up there as just this bare message with no
        // resolution at all.
        const settings = mediaStream.getVideoTracks()[0]?.getSettings();
        console.warn(
          `[FaceCaptureApp] frame stream opened ${JSON.stringify({
            label: frame.label,
            role: frame.role,
            width: settings?.width,
            height: settings?.height,
          })}`
        );
      } catch (err: any) {
        console.error(`[FaceCaptureApp] frame stream failed for ${frame.label}: ${err?.name}: ${err?.message}`);
        closeFrameStreams();
        setFramePreflight({
          ok: false,
          frames: preflight.frames,
          missing: [...preflight.missing, { ...frame, connected: false }],
          duplicates: preflight.duplicates,
        });
        return false;
      }
    }

    setFrameStreams({ ...frameStreamsRef.current });
    return true;
  };

  /**
   * The simultaneous-capture gate every live-engine session start goes
   * through (handleStartWorkflow, handleRestart, handleCancelWorkflow, and
   * the initial mount-effect start below) — see the product requirement
   * that a session must not start while any frame lacks a connected,
   * distinct camera. Simulation mode ignores the flag entirely (no physical
   * cameras to check), which is also why the sequential single-camera path
   * — where `simultaneous` is always false — only ever takes the
   * `closeFrameStreams` branch below, unchanged from today.
   */
  const runSimultaneousCaptureGate = async (
    isLive: boolean,
    simultaneous: boolean,
    workflow: CaptureWorkflow
  ): Promise<boolean> => {
    setSimultaneousCapture(simultaneous);
    if (!isLive || !simultaneous) {
      closeFrameStreams();
      return true;
    }

    const preflight = await runFramePreflight(workflow);
    if (!preflight.ok) return false;

    const centerFrame = preflight.frames.find((f) => f.role === 'CENTER');
    if (centerFrame?.deviceId && centerFrame.deviceId !== cameraServiceRef.current?.getSelectedDevice()?.id) {
      await handleSelectCamera(centerFrame.deviceId);
    }

    return openFrameStreams(preflight);
  };

  /**
   * Simultaneous capture (§ desktop kiosk multi-camera capture, product
   * decision 2026-09-05 #3, second pass): while a side frame is being
   * retaken — `engine.retakingStepId` is set by `handleRetakeStep` below via
   * `WorkflowEngine.retakeStep(stepId, { externalCapture: true })` — no
   * trigger mode may complete that step through the engine's own capture
   * path. `triggerManualCapture`'s snapshot always comes from this engine's
   * shared snapshot provider, which only ever reads the CENTER-analysed
   * camera (see `liveEngine.setSnapshotProvider` in the mount effect below);
   * for a side frame that is simply the wrong physical camera. Every trigger
   * call site — the shutter button, the gesture loop, and the engine's own
   * AUTO auto-fire (re-emitted here as `external-capture-ready`, see
   * WorkflowEngine.processFrame) — routes through this first instead:
   * snapshot that frame's own `<video>` element and hand it to
   * `recordExternalCapture` directly, the same mechanism the initial
   * simultaneous shot's fan-out already uses.
   *
   * Returns true when it handled the trigger this way — the caller must not
   * also run its normal `triggerManualCapture` path — and false for every
   * other case (not simultaneous, no retake in progress, or retaking CENTER,
   * which still goes through the normal capture-trigger path unmodified).
   */
  const captureRetakingSideFrame = (engine: WorkflowEngine, stepIdOverride?: string): boolean => {
    if (!simultaneousCaptureRef.current) return false;
    const stepId = stepIdOverride ?? engine.retakingStepId;
    if (!stepId) return false;

    const frame = framesForWorkflow(activeWorkflowRef.current).find((f) => f.stepId === stepId);
    if (!frame || frame.role === 'CENTER') return false;

    const videoEl = frameVideoElsRef.current[stepId];
    const dataUrl = videoEl ? snapshotVideoFrame(videoEl) : null;
    if (!dataUrl) {
      // 2026-09-05 black-frame fix: `snapshotVideoFrame` now also returns
      // null for a near-black/blank frame (see its own doc comment), not
      // just "no video element yet" — either way this is "treat as no
      // snapshot," but the operator needs to actually see it to know a
      // retake is still needed, not just a line in main.log.
      console.warn(`[FaceCaptureApp] retake trigger: no snapshot for ${frame.label} (${frame.role})`);
      setStoreError(
        `Khung ${frame.label} (${CAMERA_ROLE_LABELS_VI[frame.role]}): camera chưa sẵn sàng, chụp lại góc này.`
      );
      return true; // still "handled" — the normal path must not run for this frame either
    }
    engine.recordExternalCapture(stepId, dataUrl);
    return true;
  };

  const handleStartWorkflow = async () => {
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        simultaneousCapture: campaignSimultaneous,
        recordVideo: campaignRecordVideo,
      } = await resolveActiveWorkflow();
      setDeviceBlockedReason(blockedReason);
      if (blockedReason) {
        setIsWorkflowStarted(false);
        isWorkflowStartedRef.current = false;
        return;
      }
      setActiveWorkflow(workflow);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
      setEffectiveTriggerConfig(triggerConfig);
      captureTriggerRef.current.updateConfig({ mode: triggerConfig.mode, autoHoldMs: triggerConfig.autoHoldMs });
      setRecordVideo(campaignRecordVideo);

      const canStart = await runSimultaneousCaptureGate(mode === 'live', campaignSimultaneous, workflow);
      if (!canStart) {
        setIsWorkflowStarted(false);
        isWorkflowStartedRef.current = false;
        return;
      }

      // Keys both recording effects to THIS session specifically (see
      // `recordingSessionKey`'s own doc comment) — reading the id off the
      // engine's return value rather than `activeEngine.currentSession?.id`
      // read later, so there is no gap where a stale render still sees the
      // previous session's id.
      const startedSession = await activeEngine.startSession(workflow);
      setRecordingSessionKey(startedSession.id);
    }
  };

  const cameraServiceRef = useRef<BrowserCameraService | null>(null);
  const mockEngineRef = useRef<MockCVEngine | null>(null);
  const simWorkflowEngineRef = useRef<WorkflowEngine | null>(null);
  const liveWorkflowEngineRef = useRef<WorkflowEngine | null>(null);
  const simPipelineRef = useRef<FramePipeline | null>(null);
  const livePipelineRef = useRef<FramePipeline | null>(null);
  /** Set when a capture could not be stored; surfaced, never swallowed. */
  const [storeError, setStoreError] = useState<string | null>(null);
  /**
   * Fixed at no-zoom/centred now that auto-zoom has been removed (see the
   * removal note further down) — CameraPreview still takes scale/origin
   * props, so these stay as the values that mean "native framing."
   */
  const digitalZoomScale = 1;
  const digitalZoomCenter = { x: 0.5, y: 0.5 };
  /**
   * Caches the sink's session id for the run currently in progress. See
   * RunScopedCaptureSession's own doc comment for why a run that is
   * abandoned (cancelled, or "Chụp lại toàn bộ") must call `.reset()` rather
   * than let the next run silently reuse this id.
   */
  const runSessionRef = useRef<RunScopedCaptureSession>(new RunScopedCaptureSession(sink));
  /**
   * Local record of the session, in the browser's own sql.js database.
   *
   * Kept alongside the API sink rather than instead of it: the sink is what
   * makes the photo durable (sql.js is in-memory and gone on reload), while this
   * is what lets the review screen and any offline tooling read a session back
   * without a round trip, and it is what @face/database's tests and the desktop
   * app's repository code already assume exists.
   */
  const repoRef = useRef<SessionRepository | null>(null);
  const gestureEngineRef = useRef<MediaPipeGestureEngine | null>(null);
  const captureTriggerRef = useRef<CaptureTriggerEvaluator>(new CaptureTriggerEvaluator());
  const gestureAnimRef = useRef<number | null>(null);
  const mediaPipeCvRef = useRef<MediaPipeCVEngine | null>(null);

  /** Most recent grabbed frame, shared so only one GPU readback happens per tick. */
  const latestFrameRef = useRef<FrameInput | null>(null);

  /**
   * Face state readable from inside the animation loops.
   *
   * The gesture loop read `faceState` directly, which forced it into the
   * effect's dependency list — so every processed frame cancelled and recreated
   * the requestAnimationFrame loop, dozens of times a second.
   */
  const faceStateRef = useRef<FaceState | null>(null);
  useEffect(() => {
    faceStateRef.current = faceState;
  }, [faceState]);

  /**
   * Store one capture as its step completes.
   *
   * A failure is shown rather than logged: the operator is the only one who can
   * tell whether to retake now, and a photo silently missing from a finished
   * session is discovered far too late to do anything about. The record this
   * run's photos attach to is opened lazily, on this first call, by
   * RunScopedCaptureSession itself — so idly opening the screen does not leave
   * empty sessions behind.
   */
  const storePhoto = async (stepId: string, dataUrl: string, attempt: number) => {
    if (!sink) {
      setStoreError('Chưa cấu hình nơi lưu ảnh — ảnh chụp sẽ không được giữ lại.');
      return;
    }
    try {
      await runSessionRef.current.savePhoto({ stepId, attempt, dataUrl });
      setStoreError(null);
    } catch (err) {
      console.error('[FaceCaptureApp] storePhoto failed:', err);
      setStoreError(`Không lưu được ảnh ${stepId}: ${(err as Error).message}`);
    }
  };

  /**
   * Release this run's staged captures for upload, now that the operator has
   * reviewed and confirmed them in SessionReviewModal.
   *
   * Called from onAccept, before finishSession — see RunScopedCaptureSession's
   * own doc comment on why the order matters: finishSession drops the cached
   * session id, and calling this after that would silently find nothing to
   * approve. Returns whether it succeeded so onAccept can decide whether it is
   * safe to close the review screen: on failure, the captures are still safe
   * (they simply remain staged, exactly as an abandoned run would), so the
   * modal is left open and the operator can retry by pressing the same button
   * again rather than losing the chance to approve this run at all.
   *
   * `steps` (built by onAccept from the completed session) carries per-step
   * stepType/cameraRole/capturedAt through to the main process — see
   * `ApprovalStepInfo`'s own doc comment for why the outbox row alone cannot
   * supply those.
   */
  const approveUpload = async (steps?: ApprovalStepInfo[]): Promise<boolean> => {
    // Diagnostic only (2026-09-05 field bug — operator confirms, modal
    // closes, nothing ever gets approved, with no trace anywhere). Logging
    // the id this run is about to approve, before the call, means a future
    // mismatch between this id and whatever `session:approveUpload`'s own
    // warn line reports on the main-process side is visible from the
    // renderer's console/devtools even if the main-process log is not at
    // hand.
    console.warn('[FaceCaptureApp] onAccept: approving sessionId=', runSessionRef.current.cachedSessionId);
    try {
      await runSessionRef.current.approve(steps);
      setStoreError(null);
      return true;
    } catch (err) {
      console.error('[FaceCaptureApp] approveUpload failed:', err);
      setStoreError(
        `Không xác nhận được lượt tải lên (ảnh vẫn được giữ an toàn trên máy) — vui lòng bấm "Xác nhận & Lưu hồ sơ" để thử lại: ${(err as Error).message}`
      );
      return false;
    }
  };

  /** Close the record. The photos are already stored; this only ends the run. */
  const finishSession = async () => {
    try {
      await runSessionRef.current.complete();
    } catch (err) {
      console.error('[FaceCaptureApp] finishSession failed:', err);
      setStoreError(`Không đóng được phiên: ${(err as Error).message}`);
    } finally {
      closeFrameStreams();
    }
  };

  useEffect(() => {
    async function init() {
      // Guarded on its own, separate from the try below: a database that fails
      // to open must degrade the local cache, not the whole screen. The two were
      // once one try/catch, so a browser that could not open sql.js never got as
      // far as starting the camera either.
      try {
        // Relative, not '/wasm/' (the adapter's default): under file:// (the
        // packaged desktop app) an absolute path resolves to file:///wasm/,
        // which doesn't exist — './wasm/' resolves next to the loaded
        // document (dist/index.html → dist/wasm/) and is equally correct for
        // the web build, which is served from '/'.
        const adapter = new SQLiteStorageAdapter({ wasmBaseUrl: './wasm/' });
        await adapter.initialize();
        repoRef.current = new SessionRepository(adapter);
      } catch (err) {
        console.warn('[FaceCaptureApp] local SQLite cache unavailable:', err);
      }

      try {

        const simEngine = new WorkflowEngine();
        simEngine.setSensitivity(sensitivity);
        // Without this, autoHoldMs stays null until the operator touches the
        // hold-time slider, and the engine's own fallback default silently
        // took over instead — see the comment on WorkflowEngine.processFrame.
        simEngine.setCaptureTriggerConfig({
          mode: getSettings().captureMode || 'MANUAL',
          autoHoldMs: getSettings().autoHoldMs || 2000,
        });
        simEngine.setSnapshotProvider(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(320, 240, 120, 0, Math.PI * 2);
          ctx.fill();
          return canvas.toDataURL('image/jpeg', 0.85);
        });
        simWorkflowEngineRef.current = simEngine;

        simEngine.on('state-change', (state: GuidanceState) => {
          setSimGuidance({ ...state });
        });

        simEngine.on('capture-trigger', (data: { stepId: string; imagePath: string }) => {
          setLatestCapturedImage({ ...data });

          // Mirrors liveEngine's identical handler below — without this,
          // simulated captures only ever update the flash-preview state and
          // never reach runSessionRef, so RunScopedCaptureSession.sessionId
          // stays null for the whole run and the review screen's "Xác nhận"
          // button fails with "no active session to approve" even though
          // every step visibly completed.
          const step = simEngine.currentSession?.steps.find((st) => st.stepId === data.stepId);
          void storePhoto(data.stepId, data.imagePath, (step?.attempts ?? 0) + 1);
        });

        simEngine.on('completed', (completedSession: CaptureSession) => {
          setSession(completedSession);
          setShowReviewModal(true);
          if (repoRef.current) void repoRef.current.saveSession(completedSession);
          // finishSession() is NOT called here — see the identical comment on
          // liveEngine's 'completed' handler below for why.
          // Stop-recording hook (§3.1 fix, 2026-09-05) — see
          // `recordingSessionKey`'s own doc comment; included here too even
          // though simulation mode has no physical camera to record, for
          // symmetry with liveEngine's identical handler.
          setRecordingSessionKey(null);
        });

        const mockCv = new MockCVEngine({ simulatedDelayMs: 10 });
        mockCv.updateSettings({ detected: false, faceCount: 0 });
        await mockCv.initialize();
        mockEngineRef.current = mockCv;

        const simPipeline = new FramePipeline(mockCv);
        simPipelineRef.current = simPipeline;

        simPipeline.onResult(async (state: FaceState, fps: number) => {
          if (mode === 'simulation') {
            setFaceState(state);
            setCvFps(fps);
          }
          await simEngine.processFrame(state);
        });

        const {
          workflow: simWorkflow,
          triggerConfig: simTriggerConfig,
          blockedReason: simBlockedReason,
        } = await resolveActiveWorkflow();
        setDeviceBlockedReason(simBlockedReason);
        setActiveWorkflow(simWorkflow);
        simEngine.setCaptureTriggerConfig(simTriggerConfig);
        setEffectiveTriggerConfig(simTriggerConfig);
        captureTriggerRef.current.updateConfig({ mode: simTriggerConfig.mode, autoHoldMs: simTriggerConfig.autoHoldMs });
        if (!simBlockedReason) await simEngine.startSession(simWorkflow);

        const liveEngine = new WorkflowEngine();
        liveEngine.setSensitivity(sensitivity);
        liveEngine.setCaptureTriggerConfig({
          mode: getSettings().captureMode || 'MANUAL',
          autoHoldMs: getSettings().autoHoldMs || 2000,
        });
        liveEngine.setSnapshotProvider(() => {
          if (cameraServiceRef.current) {
            return cameraServiceRef.current.captureBase64Snapshot();
          }
          return null;
        });
        liveWorkflowEngineRef.current = liveEngine;

        liveEngine.on('state-change', (state: GuidanceState) => {
          setLiveGuidance({ ...state });

          // CB Help "step change" (§3.5) — de-duped against this event's
          // real firing rate (once per processed frame) via
          // `lastCbHelpKeyRef`; only an actual session start or step change
          // is worth a `cbhelp:publish` call. See publishCbHelpState's own
          // doc comment.
          const cbHelpKey = `${liveEngine.currentSession?.id ?? ''}:${state.currentStepIndex}`;
          if (cbHelpKey !== lastCbHelpKeyRef.current) {
            lastCbHelpKeyRef.current = cbHelpKey;
            publishCbHelpState();
          }
        });

        liveEngine.on('capture-trigger', (data: { stepId: string; imagePath: string }) => {
          setLatestCapturedImage({ ...data });

          // attempts counts completed retakes, so the wire value is 1-based: a
          // first capture and its first retake must not share a key, or the
          // retake is taken for a duplicate and dropped.
          const step = liveEngine.currentSession?.steps.find((st) => st.stepId === data.stepId);
          void storePhoto(data.stepId, data.imagePath, (step?.attempts ?? 0) + 1);

          // Simultaneous capture (§ desktop kiosk multi-camera capture): one
          // CENTER shutter feeds every other frame at once. Gated on the
          // triggering step's OWN role, not on call order or a re-entrancy
          // flag: `engine.recordExternalCapture` below re-emits this very
          // 'capture-trigger' event for each side frame it marks COMPLETED,
          // which re-enters this same handler synchronously — but that
          // re-entrant call's frame role is never CENTER, so this block
          // simply does not run for it, and there is no second round of
          // snapshots.
          if (simultaneousCaptureRef.current) {
            const frames = framesForWorkflow(activeWorkflowRef.current);
            const triggeredFrame = frames.find((f) => f.stepId === data.stepId);
            if (triggeredFrame?.role === 'CENTER') {
              for (const frame of frames) {
                if (frame.stepId === data.stepId) continue;
                const sessionStep = liveEngine.currentSession?.steps.find((st) => st.stepId === frame.stepId);
                if (sessionStep?.status === 'COMPLETED') continue;

                const videoEl = frameVideoElsRef.current[frame.stepId];
                const dataUrl = videoEl ? snapshotVideoFrame(videoEl) : null;
                if (!dataUrl) {
                  // 2026-09-05 black-frame fix: this is the exact path the
                  // field bug went through — `snapshotVideoFrame` now rejects
                  // a near-black/blank frame instead of returning it, so a
                  // not-yet-ready side camera leaves its frame pending for
                  // retake (unchanged mechanism) instead of storing/
                  // uploading a black still. Surfaced to the operator, not
                  // just main.log, since a retake is actually needed here.
                  console.warn(
                    `[FaceCaptureApp] simultaneous capture: no snapshot for ${frame.label} (${frame.role}) — left pending for retake`
                  );
                  setStoreError(
                    `Khung ${frame.label} (${CAMERA_ROLE_LABELS_VI[frame.role]}): camera chưa sẵn sàng, chụp lại góc này.`
                  );
                  continue;
                }
                liveEngine.recordExternalCapture(frame.stepId, dataUrl);
              }
            }
          }

          // CB Help (§3.5): a fresh photo for this frame — refresh the
          // published snapshot so the extended display swaps that tile's
          // live video for the captured still. Runs once per real capture,
          // plus once more per side frame the block above just fanned out to
          // (each of those is its own re-entrant 'capture-trigger') — a few
          // redundant IPC calls in a single burst, not a correctness issue.
          publishCbHelpState();
        });

        // AUTO mode's auto-fire for a simultaneous-capture side frame being
        // retaken (§ desktop kiosk multi-camera capture, product decision
        // 2026-09-05 #3, second pass) — the engine re-emits this instead of
        // completing the step itself once stability is reached, since its
        // own snapshot provider only ever reads the CENTER-analysed camera
        // (see WorkflowEngine's `externalCaptureOnly` doc comment). Routes
        // through the exact same helper the shutter/gesture call sites use.
        liveEngine.on('external-capture-ready', (data: { stepId: string }) => {
          captureRetakingSideFrame(liveEngine, data.stepId);
        });

        liveEngine.on('completed', (completedSession: CaptureSession) => {
          setSession(completedSession);
          setShowReviewModal(true);
          if (repoRef.current) void repoRef.current.saveSession(completedSession);
          // CB Help (§3.5, 2026-09-05 second pass): the finished photos must
          // STAY on the extended display, not drop to idle — `phase:
          // 'review'` publishes a running:false snapshot built from this
          // very session (every step's `capturedImagePath`, already
          // COMPLETED) while SessionReviewModal is open. It only goes idle
          // on a genuinely abandoned/replaced run: cancel, "Chụp lại toàn
          // bộ", or a fresh session starting.
          publishCbHelpState({ phase: 'review' });
          // Used to call finishSession() right here — wrong once approval was
          // introduced. finishSession() -> runSessionRef.current.complete()
          // clears the cached session id (see RunScopedCaptureSession's own
          // doc comment: approve() must run BEFORE complete(), never after).
          // Calling it the instant the workflow completes tore down the
          // session before the operator had even seen the review screen this
          // handler just opened, so clicking "Xác nhận & Lưu hồ sơ" moments
          // later always found no session left to approve — every natural
          // (non-manual-review) completion hit this, which is the common
          // case. finishSession() now runs only from onAccept, after
          // approveUpload() succeeds, which is the one place with the
          // correct ordering.
          //
          // Stop-recording hook (§3.1 fix, 2026-09-05) — see
          // `recordingSessionKey`'s own doc comment: this is the real
          // end-of-session boundary the recording effects need, which
          // `isWorkflowStarted` alone never reliably reaches on this path.
          setRecordingSessionKey(null);
        });

        const {
          workflow: liveWorkflow,
          triggerConfig: liveTriggerConfig,
          blockedReason: liveBlockedReason,
          simultaneousCapture: liveSimultaneous,
          recordVideo: liveRecordVideo,
        } = await resolveActiveWorkflow();
        setDeviceBlockedReason(liveBlockedReason);
        setActiveWorkflow(liveWorkflow);
        liveEngine.setCaptureTriggerConfig(liveTriggerConfig);
        setEffectiveTriggerConfig(liveTriggerConfig);
        captureTriggerRef.current.updateConfig({ mode: liveTriggerConfig.mode, autoHoldMs: liveTriggerConfig.autoHoldMs });
        setRecordVideo(liveRecordVideo);
        const canStartLive = await runSimultaneousCaptureGate(true, liveSimultaneous, liveWorkflow);
        if (!liveBlockedReason && canStartLive) await liveEngine.startSession(liveWorkflow);

        // Opening the camera was gated behind a user-agent test, so a desktop
        // showed a live-mode interface with no picture in it: stream stayed
        // null and the face overlay, which needs one, drew nothing.
        startLiveMode();
      } catch (err) {
        console.error('❌ [FaceCaptureApp] Initialization error:', err);
      }
    }

    init();

    return () => {
      cameraServiceRef.current?.stop();
      closeFrameStreams();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let animId: number;
    let lastSimTime = 0;

    const processFrameLoop = () => {
      if (mode === 'simulation' && simPipelineRef.current) {
        const now = Date.now();
        if (now - lastSimTime >= 80) {
          lastSimTime = now;
          const dummyFrame = {
            data: new Uint8ClampedArray(640 * 480 * 4),
            width: 640,
            height: 480,
            timestamp: now,
          };
          simPipelineRef.current.pushFrame(dummyFrame);
        }
      } else if (mode === 'live' && cameraServiceRef.current && livePipelineRef.current) {
        const frame = cameraServiceRef.current.getFrame();
        if (frame) {
          // Reading pixels back from the GPU is the expensive part of a frame,
          // so the gesture loop reuses this one instead of taking its own.
          latestFrameRef.current = frame;
          livePipelineRef.current.pushFrame(frame);
        }
      }
      animId = requestAnimationFrame(processFrameLoop);
    };

    animId = requestAnimationFrame(processFrameLoop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'live') {
      if (gestureAnimRef.current) cancelAnimationFrame(gestureAnimRef.current);
      setGestureState(null);
      setGestureProgress(0);
      captureTriggerRef.current.reset();
      return;
    }

    let lastGestureTime = 0;
    const gestureLoop = async () => {
      if (cameraServiceRef.current && gestureEngineRef.current?.isInitialized) {
        const now = Date.now();
        if (now - lastGestureTime >= 80) {
          lastGestureTime = now;
          const frame = latestFrameRef.current;
          if (frame) {
            try {
              const gs = await gestureEngineRef.current.processFrame(frame);
              setGestureState(gs);

              const currentFaceState = faceStateRef.current;
              const isFaceReady =
                currentFaceState?.detected === true &&
                currentFaceState?.presence === 'SINGLE_FACE' &&
                currentFaceState?.quality?.accepted === true;

              const decision = captureTriggerRef.current.evaluate({
                faceReady: isFaceReady,
                faceStabilityProgress: 0,
                gestureState: gs,
                currentTime: now,
              });
              setGestureProgress(decision.gestureProgress ?? 0);

              if (decision.capture && liveWorkflowEngineRef.current) {
                captureTriggerRef.current.reset();
                const engine = liveWorkflowEngineRef.current;
                // Simultaneous capture: a side frame being retaken (MANUAL
                // mode's gesture) must snapshot its own camera, never the
                // engine's normal (CENTER-only) capture path — see
                // captureRetakingSideFrame's own doc comment.
                if (!captureRetakingSideFrame(engine)) {
                  const wf = engine as any;
                  // Pass the same frame isFaceReady was just computed from, so
                  // the engine's own quality gate (WorkflowEngine.
                  // triggerManualCapture) has something real to re-check at the
                  // moment the gesture actually fires. Calling this with no
                  // faceState at all used to skip that check silently — this
                  // gesture path had nothing else standing between a smiling
                  // face and a completed capture.
                  if (wf.triggerManualCapture) wf.triggerManualCapture(currentFaceState);
                }
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }
      gestureAnimRef.current = requestAnimationFrame(gestureLoop);
    };

    gestureAnimRef.current = requestAnimationFrame(gestureLoop);
    return () => {
      if (gestureAnimRef.current) cancelAnimationFrame(gestureAnimRef.current);
    };
  }, [mode]);

  const handleShutterCapture = useCallback(() => {
    const engine = liveWorkflowEngineRef.current;
    if (!engine) return;

    // Simultaneous capture: a side frame being retaken (OFF mode's shutter
    // button) must snapshot its own camera, never the engine's normal
    // (CENTER-only) capture path — see captureRetakingSideFrame's own doc
    // comment. Checked ahead of the `faceState?.detected` gate below: a side
    // frame's retake does not depend on CENTER seeing a face at all.
    if (captureRetakingSideFrame(engine)) return;

    if (faceState?.detected) {
      const wf = engine as any;
      // Same reasoning as the gesture trigger above: pass the faceState this
      // click was actually decided under so the engine's quality gate has
      // real data to re-check, instead of silently accepting whatever the
      // shutter button's own `enabled` prop happened to miss (e.g. a smile
      // that started the instant before the click landed).
      if (wf.triggerManualCapture) wf.triggerManualCapture(faceState);
    }
  }, [faceState]);

  const handleSensitivityChange = useCallback((newSensitivity: CaptureSensitivity) => {
    setSensitivity(newSensitivity);
    simWorkflowEngineRef.current?.setSensitivity(newSensitivity);
    liveWorkflowEngineRef.current?.setSensitivity(newSensitivity);
    mediaPipeCvRef.current?.setSensitivity?.(newSensitivity);
    mockEngineRef.current?.setSensitivity?.(newSensitivity);
  }, []);

  const handleCaptureModeChange = useCallback((newMode: CaptureTriggerMode) => {
    // The settings UI disables the mode picker entirely while the campaign
    // dictates the mode (`effectiveTriggerConfig.fromCampaign`) — this guard
    // is a second line of defense against the same case, so a local change
    // can never again silently drift from what the engine actually honours.
    if (effectiveTriggerConfig.fromCampaign) return;
    captureTriggerRef.current.updateConfig({ mode: newMode });
    simWorkflowEngineRef.current?.setCaptureTriggerConfig({ mode: newMode });
    liveWorkflowEngineRef.current?.setCaptureTriggerConfig({ mode: newMode });
    setEffectiveTriggerConfig((prev) => ({ ...prev, mode: newMode, fromCampaign: false }));
  }, [effectiveTriggerConfig.fromCampaign]);

  const handleAutoHoldMsChange = useCallback((newMs: number) => {
    captureTriggerRef.current.updateConfig({ autoHoldMs: newMs });
    simWorkflowEngineRef.current?.setCaptureTriggerConfig({ autoHoldMs: newMs });
    liveWorkflowEngineRef.current?.setCaptureTriggerConfig({ autoHoldMs: newMs });
    setEffectiveTriggerConfig((prev) => ({ ...prev, autoHoldMs: newMs }));
  }, []);

  const handleSimulationChange = async (settings: SimulationSettings) => {
    if (!mockEngineRef.current || !simPipelineRef.current) return;

    mockEngineRef.current.updateSettings({
      detected: settings.presence !== 'NO_FACE',
      faceCount: settings.presence === 'MULTIPLE_FACES' ? 2 : settings.presence === 'SINGLE_FACE' ? 1 : 0,
      pose: { yaw: settings.yaw, pitch: settings.pitch, roll: settings.roll },
      quality: {
        faceSizeRatio: settings.faceSizeRatio,
        overallScore: settings.qualityScore,
        accepted: settings.qualityScore >= 0.7,
      },
    });

    const dummyFrame = {
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
      timestamp: Date.now(),
    };

    const detected = settings.presence !== 'NO_FACE';
    const faceCount = settings.presence === 'MULTIPLE_FACES' ? 2 : settings.presence === 'SINGLE_FACE' ? 1 : 0;

    const primaryBox = {
      x: 160,
      y: 72,
      width: 320,
      height: 336,
    };

    const allDetections = Array.from({ length: faceCount }, (_, idx) => {
      if (idx === 0) return { boundingBox: primaryBox, confidence: 0.98 };
      return {
        boundingBox: { x: 40 + idx * 115, y: 120, width: 180, height: 216 },
        confidence: 0.92,
      };
    });

    simPipelineRef.current.pushFrame(dummyFrame);
    if (!detected) {
      setFaceState({
        timestamp: Date.now(),
        detected: false,
        faceCount: 0,
        presence: 'NO_FACE',
      });
    } else {
      setFaceState({
        detected: true,
        faceCount,
        presence: settings.presence,
        detection: allDetections[0],
        allDetections,
        pose: { yaw: settings.yaw, pitch: settings.pitch, roll: settings.roll },
        quality: {
          faceSizeRatio: settings.faceSizeRatio,
          overallScore: settings.qualityScore,
          accepted: settings.qualityScore >= 0.7,
          sharpness: 1,
          brightness: 0.5,
          centerXOffset: 0,
          centerYOffset: 0,
          eyeOpenScore: 1,
          smileScore: 0,
          eyesVisible: true,
          mouthVisible: true,
          occluded: false,
          neutralExpression: true,
          // Matches primaryBox below (320x336 on the 640x480 dummyFrame) —
          // simulation mode's synthetic box, not driven by the faceSizeRatio
          // slider, same as the rest of this mock quality reading.
          faceWidthPx: 320,
          faceHeightPx: 336,
          reasons: [],
        },
        timestamp: Date.now(),
      });
    }
  };

  const startLiveMode = async () => {
    setMode('live');
    updateSettings({ engineMode: 'live' });
    setFaceState(null);
    setCameraError(null);
    setIsCameraLoading(true);

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      alert(
        'Trình duyệt đã chặn Camera do bạn đang truy cập qua địa chỉ IP HTTP từ máy khác.\n\n' +
          'Cách bật Camera cho máy này trên Chrome:\n' +
          '1. Mở tab mới: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n' +
          '2. Thêm URL: ' +
          window.location.origin +
          '\n' +
          '3. Chuyển sang "Enabled" và bấm Relaunch.'
      );
    }

    // Preview first, CV second: the camera is started and rendered before the
    // MediaPipe CV engine (GPU/WASM) is ever touched. Previously the CV and
    // gesture engines were awaited before `camera.start()`, so a hung/slow
    // WebGL or WASM init on a kiosk with a bad GPU meant the camera never
    // started and the user saw a black preview with no error. Now
    // getUserMedia is requested first so the preview appears as soon as it
    // resolves, and the CV engine below is bounded by a hard timeout and can
    // only ever fall back to the mock engine — it can no longer hide the
    // camera. The frame loop (`processFrameLoop` in the effect keyed on
    // `[mode]`) re-checks `livePipelineRef.current`/`cameraServiceRef.current`
    // via requestAnimationFrame on every tick rather than once in an effect
    // keyed on `stream`, so it needs no extra "CV ready" state: it naturally
    // starts pushing frames the moment `livePipelineRef.current` is assigned
    // below, whenever that happens relative to `setStream`.
    try {
      const camera = cameraServiceRef.current || new BrowserCameraService();
      cameraServiceRef.current = camera;

      const devs = await camera.enumerateDevices().catch(() => []);
      setDevices(devs);
      if (devs.length > 0) setSelectedDeviceId(devs[0].id);

      const st = await camera.start();
      setStream(st);
      setIsCameraLoading(false);
    } catch (err: any) {
      console.warn('Live camera error:', err);
      setStream(null);
      setIsCameraLoading(false);

      const errStr = String(err?.message || err || '');
      if (errStr.includes('Permission') || errStr.includes('NotAllowedError')) {
        setCameraError('Trình duyệt hoặc hệ thống đã từ chối quyền truy cập Camera. Vui lòng cho phép quyền Camera trên ô địa chỉ trình duyệt.');
      } else if (errStr.includes('NotFound') || errStr.includes('DevicesNotFoundError')) {
        setCameraError('Không tìm thấy thiết bị Camera nào trên máy tính/thiết bị này.');
      } else {
        setCameraError(`Không thể khởi động Camera: ${errStr || 'Vui lòng kiểm tra lại thiết bị camera.'}`);
      }
    }

    // CV init runs after the camera is already showing, in its own try/catch
    // isolated from the one above: a hung/slow/failing MediaPipe init must
    // only log and fall back to mockEngineRef, never touch setCameraError or
    // clear the stream the block above just set.
    try {
      if (!mediaPipeCvRef.current) {
        const mpCv = new MediaPipeCVEngine();
        const CV_INIT_TIMEOUT_MS = 20000;
        const initPromise = mpCv.initialize();
        await Promise.race([
          initPromise,
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error(`MediaPipe init timed out after ${CV_INIT_TIMEOUT_MS}ms`)),
              CV_INIT_TIMEOUT_MS
            )
          ),
        ]).catch((e: any) => {
          console.warn('[FaceCaptureApp] MediaPipe initialization fallback to MockCVEngine:', e);
        });
        // If the timeout above won the race, `initialize()` is still running
        // in the background; swallow whatever it eventually settles with so
        // it doesn't surface as an unhandled promise rejection later.
        initPromise.catch(() => {});
        if (mpCv.isInitialized) {
          mpCv.setSensitivity(sensitivity);
          mediaPipeCvRef.current = mpCv;
        }
      } else {
        mediaPipeCvRef.current.setSensitivity(sensitivity);
      }

      if (!gestureEngineRef.current) {
        const ge = new MediaPipeGestureEngine();
        ge.initialize().catch((e: any) =>
          console.warn('GestureEngine failed to init, MANUAL mode will be unavailable:', e)
        );
        gestureEngineRef.current = ge;
      }

      const engineToUse =
        mediaPipeCvRef.current && mediaPipeCvRef.current.isInitialized
          ? mediaPipeCvRef.current
          : mockEngineRef.current;

      if (engineToUse) {
        const newLivePipeline = new FramePipeline(engineToUse);
        livePipelineRef.current = newLivePipeline;
        newLivePipeline.onResult(async (state: FaceState, fps: number) => {
          setFaceState(state);
          setCvFps(fps);
          if (liveWorkflowEngineRef.current && isWorkflowStartedRef.current) {
            await liveWorkflowEngineRef.current.processFrame(state);
          }
        });
      }
    } catch (e: any) {
      console.warn('[FaceCaptureApp] CV engine initialization failed, continuing with camera preview only:', e);
    }
  };

  const switchToSimulationMode = async () => {
    if (cameraServiceRef.current) {
      await cameraServiceRef.current.stop();
      setStream(null);
    }
    closeFrameStreams();
    setFaceState(null);
    setIsCameraLoading(false);
    setCameraError(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    // Stop-recording hook (§3.1 fix, 2026-09-05) — see `recordingSessionKey`'s
    // own doc comment. The single-stream effect's own `!stream` guard would
    // already cover this (the camera stream is stopped above), but the
    // multi-channel effect does not depend on `stream`.
    setRecordingSessionKey(null);
    setMode('simulation');
    updateSettings({ engineMode: 'simulation' });
  };

  const handleSelectCamera = async (devId: string) => {
    setSelectedDeviceId(devId);
    if (cameraServiceRef.current) {
      try {
        setIsCameraLoading(true);
        const st = await cameraServiceRef.current.start({ deviceId: devId });
        setStream(st);
        setIsCameraLoading(false);
      } catch (err: any) {
        setIsCameraLoading(false);
        setCameraError(`Không thể chuyển sang camera đã chọn: ${err?.message || err}`);
      }
    }
  };


  // Auto-zoom (both the face-size seeking and its digital-crop-based
  // recentring) was removed at the operator's request — it kept fighting
  // real-world framing (tight crops, false FACE_TOO_SMALL at a turned
  // profile, zoom chasing perspective foreshortening as if the subject had
  // moved). Centring is handled by the existing OFF_CENTER quality check
  // instead: the operator physically moves into frame, guided by
  // GuidanceEngine's own instruction text, the same as FACE_TOO_SMALL/
  // FACE_TOO_LARGE already ask them to step closer or back off. The camera
  // now always runs at its native 1x framing — see BrowserCameraService's
  // digital-zoom methods, still there but unused unless something calls them.

  /**
   * Per-frame retake (§ desktop kiosk multi-camera capture, product decision
   * 2026-09-05 #3, second pass): pressing "Chụp lại" on one frame in the
   * review modal must return the operator to a LIVE capture screen showing
   * only that frame — not, as this used to, snapshot a side frame instantly
   * with no gate and no live view (the operator saw nothing happen, and the
   * extended display never went live). `engine.retakeStep()` already does
   * the session bookkeeping (marks the frame CURRENT/PENDING, leaves every
   * other frame's COMPLETED photo untouched); this function's job is putting
   * the UI back into a state where a real trigger can land a real photo:
   * - CENTER: the normal capture-trigger path (shutter/gesture/AUTO) already
   *   handles it unchanged, and that handler's own not-COMPLETED filter
   *   guarantees the fan-out will not re-touch the still-COMPLETED side
   *   frames — see the field regression `SimultaneousRetake.test.ts` covers.
   * - A side frame: has no capture path of its own inside the engine (its
   *   photo comes from a different physical camera than the one the
   *   engine's snapshot provider reads) — `{ externalCapture: true }` tells
   *   the engine so neither its own AUTO auto-fire nor a stray
   *   `triggerManualCapture` call can complete it from the wrong camera;
   *   `captureRetakingSideFrame` is what every trigger mode (shutter,
   *   gesture, and the engine's re-emitted `external-capture-ready` for
   *   AUTO) now routes through instead. See both doc comments for the full
   *   mechanism.
   */
  const handleRetakeStep = async (stepId: string) => {
    const engine = liveWorkflowEngineRef.current;
    if (!engine) return;

    const frame = simultaneousCaptureRef.current
      ? framesForWorkflow(activeWorkflowRef.current).find((f) => f.stepId === stepId)
      : null;
    const isSideFrameRetake = !!frame && frame.role !== 'CENTER';

    const started = await engine.retakeStep(stepId, { externalCapture: isSideFrameRetake });
    if (!started) return;

    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;

    if (simultaneousCaptureRef.current) {
      // Frame streams normally stay open from session start straight through
      // review (nothing closes them until finishSession/cancel/restart — see
      // closeFrameStreams' call sites), but re-open defensively in case one
      // was lost for an unrelated reason: openFrameStreams is idempotent
      // (see its own doc comment), so this is a harmless no-op in the common
      // case and the only thing standing between a lost stream and a side
      // frame that silently never goes live again.
      const preflight = await runFramePreflight(activeWorkflowRef.current);
      if (preflight.ok) await openFrameStreams(preflight);
    }

    // CB Help (§3.5): show this frame live on the extended display right
    // away. `retakeStep()`'s own 'state-change' emit above already triggers
    // a republish via the live engine's listener, but that dedupes against
    // the session/step key and could be swallowed if this step already
    // looked CURRENT from before review opened — publish explicitly rather
    // than rely on the dedupe not eating it.
    publishCbHelpState();
  };

  const handleRestart = async () => {
    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    // Stop-recording hook (§3.1 fix, 2026-09-05) — see `recordingSessionKey`'s
    // own doc comment. Already null here for a run that reached 'completed'
    // naturally (that handler above already cleared it); a harmless no-op in
    // that case, and the fix for retaking mid-session before 'completed' ever
    // fired. The `startSession` call further down (this restart's own
    // pre-armed session) deliberately does NOT set this key back — same as
    // before this fix, recording only (re)arms from a real
    // `handleStartWorkflow`, once the operator presses Start again.
    setRecordingSessionKey(null);
    reportStatsEvent('RETAKE');
    // CB Help (§3.5): an abandoned run must not leave its last frame/photo
    // showing on the extended display — the fresh session started below (if
    // any) re-publishes for real via the engine's own 'state-change'.
    publishCbHelpState({ phase: 'idle' });
    // "Chụp lại toàn bộ" reaches here before the session has necessarily
    // completed (SessionReviewModal allows reviewing, and retaking
    // everything, from as little as one captured step). Without this, the
    // next run's first capture of each step reuses the abandoned run's
    // sink session id and collides in idemKey space with it — see
    // RunScopedCaptureSession's doc comment for the full mechanism. Already
    // reset (a run that finished naturally clears it via finishSession) is a
    // harmless no-op here.
    runSessionRef.current.reset();
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        simultaneousCapture: campaignSimultaneous,
        recordVideo: campaignRecordVideo,
      } = await resolveActiveWorkflow();
      setDeviceBlockedReason(blockedReason);
      setActiveWorkflow(workflow);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
      setEffectiveTriggerConfig(triggerConfig);
      captureTriggerRef.current.updateConfig({ mode: triggerConfig.mode, autoHoldMs: triggerConfig.autoHoldMs });
      setRecordVideo(campaignRecordVideo);
      if (!blockedReason) {
        const canStart = await runSimultaneousCaptureGate(mode === 'live', campaignSimultaneous, workflow);
        if (canStart) await activeEngine.startSession(workflow);
      }
    }
    if (mode === 'simulation') {
      setFaceState(null);
      if (mockEngineRef.current) mockEngineRef.current.updateSettings({ detected: false, faceCount: 0 });
    }
  };

  const activeGuidance = mode === 'live' ? liveGuidance : simGuidance;
  const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
  const activeSession = activeEngine?.currentSession;

  /**
   * Camera role mapping (§2.1) — which physical camera plays CENTER/LEFT/
   * RIGHT, set once via the desktop app's camera setup screen
   * (`Ctrl/Cmd+Shift+K`). Fetched once on mount; `(window as any).faceAPI`
   * is undefined on the web build, so `cameraRoleMapping` just stays `{}`
   * there and every effect below becomes a no-op — exactly today's
   * single-camera behavior, unchanged.
   */
  const [cameraRoleMapping, setCameraRoleMapping] = useState<Record<string, string>>({});
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    faceAPI?.getCameraRoleMapping?.()
      .then((m: Record<string, string>) => setCameraRoleMapping(m ?? {}))
      .catch(() => {
        /* no bridge, or no mapping saved yet — stay on {} */
      });
  }, []);

  /**
   * The CB Help extended-display window's open/closed state (§3.5) —
   * reflects the "Màn hình mở rộng" toggle button below. Note the window it
   * toggles is no longer a mirror of this whole app (that decision was
   * reversed 2026-09-05): it now shows only the capture frames, live +
   * captured — see `publishCbHelpState` further down for what feeds it, and
   * cbHelpWindow.ts's own doc comment. `toggleCbHelpWindow`/
   * `isCbHelpWindowOpen` only exist under the desktop app's preload bridge,
   * never on the web build, so this stays `false` there and the button
   * itself does not render at all (see `cbHelpButton` below) — same
   * `(window as any).faceAPI` guard pattern as `cameraRoleMapping` above.
   */
  const [cbHelpOpen, setCbHelpOpen] = useState(false);
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    faceAPI?.isCbHelpWindowOpen?.()
      .then((open: boolean) => setCbHelpOpen(!!open))
      .catch(() => {
        /* no bridge — stay closed */
      });
  }, []);

  const handleToggleCbHelp = useCallback(async () => {
    const faceAPI = (window as any).faceAPI;
    try {
      const result = await faceAPI?.toggleCbHelpWindow?.();
      if (result) setCbHelpOpen(!!result.open);
    } catch {
      /* no bridge, or the window failed to open/close — leave state as-is */
    }
  }, []);

  /** Ref mirror of `cameraRoleMapping`, read from `publishCbHelpState` below when it is called from inside the mount-only engine-event handlers (stale-closure concern — same reason `activeWorkflowRef` exists). */
  const cameraRoleMappingRef = useRef<Record<string, string>>({});
  useEffect(() => {
    cameraRoleMappingRef.current = cameraRoleMapping;
  }, [cameraRoleMapping]);

  /** Ref mirror of `selectedDeviceId`, same reason as `cameraRoleMappingRef` above. */
  const selectedDeviceIdRef = useRef<string>('');
  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  /**
   * De-dupes the CB Help "step change" publish (see the live engine's
   * `state-change` handler below) against that event's real firing rate —
   * once per processed video frame, many times a second — so only an actual
   * session start or step change reaches the `cbhelp:publish` IPC call, not
   * every frame `processFrame` evaluates.
   */
  const lastCbHelpKeyRef = useRef<string | null>(null);

  /**
   * Publishes a capture-frames snapshot to the CB Help window over the
   * `cbhelp:publish` bridge (§3.5, 2026-09-05 product decision — see
   * cbHelpWindow.ts's own doc comment for what the window shows now: only
   * the capture frames, live + captured, not a mirror of this whole app).
   * Live-mode only — simulation mode has no physical cameras/`deviceId`s for
   * the CB Help window to open a stream against.
   *
   * Reads everything through refs (`activeWorkflowRef`,
   * `simultaneousCaptureRef`, `cameraRoleMappingRef`, `selectedDeviceIdRef`)
   * plus the live engine's own `currentSession`/`currentState`, rather than
   * this component's React state directly — the engine instance itself
   * never goes stale (it is created once and kept in
   * `liveWorkflowEngineRef`), so this stays correct however it's called:
   * from a regular event handler here, or from inside the mount-only
   * effect's engine event listeners below, which would otherwise only ever
   * see the render they were registered on.
   *
   * `opts.phase` picks the CB Help window's presentation mode explicitly —
   * see `CbHelpPublishState.phase`'s own doc comment for what each value
   * means. Omitted (the plain per-frame/per-step republish below) derives it
   * the same way this always has: `'live'` while the engine's own session is
   * RUNNING, `'idle'` otherwise. `'review'`/`'done'` still build `frames`
   * from the engine's session exactly like `'live'` does — a session that
   * just completed (or is COMPLETED and being reviewed/accepted) still holds
   * every step's `capturedImagePath`, `status: 'COMPLETED'`, on
   * `currentSession` until the next `startSession()` overwrites it, so the
   * snapshot is simply "every frame, already completed." Only an explicit
   * `phase: 'idle'` (cancel, restart, or leaving live mode) forces an empty
   * `frames` list regardless of what the engine still holds — an abandoned
   * or restarted run must not leave its last frame/photo showing on the
   * extended display.
   */
  const publishCbHelpState = useCallback((opts?: { phase?: 'idle' | 'review' | 'done' }) => {
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.publishCbHelpState) return; // web build, or no bridge

    const engine = liveWorkflowEngineRef.current;
    const session = engine?.currentSession ?? null;
    const phase: 'idle' | 'live' | 'review' | 'done' =
      opts?.phase ?? (session?.status === 'RUNNING' ? 'live' : 'idle');
    const running = phase === 'live';
    const showFrames = phase !== 'idle';

    const state: CbHelpPublishState = {
      running,
      phase,
      simultaneous: simultaneousCaptureRef.current,
      currentStepId: running ? engine!.currentState.stepId : null,
      frames: showFrames
        ? buildCbHelpFrames(
            activeWorkflowRef.current,
            session,
            engine?.currentState.currentStepIndex ?? 0,
            simultaneousCaptureRef.current,
            cameraRoleMappingRef.current,
            selectedDeviceIdRef.current
          )
        : [],
    };
    void faceAPI.publishCbHelpState(state);
  }, []);

  /** Leaving live mode (or never having entered it) must not leave a stale live snapshot on the CB Help window. */
  useEffect(() => {
    if (mode !== 'live') publishCbHelpState({ phase: 'idle' });
  }, [mode, publishCbHelpState]);

  /**
   * Unique, currently-plugged-in physical devices behind the CENTER/LEFT/
   * RIGHT role mapping above — decides which of the two video-recording
   * effects below applies. Two roles can point at the same physical device
   * (e.g. C0 covering for a failed C1, see §2.1), so this dedupes by device
   * id rather than counting roles.
   */
  const multiChannelDeviceIds = useMemo(
    () =>
      Array.from(new Set(Object.values(cameraRoleMapping))).filter(
        (id): id is string => !!id && devices.some((d) => d.id === id)
      ),
    [cameraRoleMapping, devices]
  );

  /**
   * Local video recording alongside the session — see
   * docs/plans/multi-camera-device-management-discussion.md §3.1. A
   * self-contained effect, independent of the capture/quality-gate logic
   * elsewhere in this file: it only watches whether the campaign has
   * `recordVideo` on, a session is actually running, and a camera stream
   * exists, and starts/stops a `MediaRecorder` accordingly.
   *
   * Gated via `shouldRecordSingleStream` (recordingGate.ts) on `recordVideo`,
   * `recordingSessionKey`, `stream`, and `multiChannelDeviceIds.length < 2` —
   * see that state's own doc comment for the 2026-09-05 field bug this fixes
   * (a stuck boolean meant a new session's recorder never started while an
   * abandoned session's kept running) and why keying on the session id
   * itself, not a boolean, is the fix: `recordingSessionKey` changing to a
   * genuinely new value is what actually makes this effect's dependency
   * array change and restart, which is the only thing that runs this
   * effect's cleanup (the only place that calls `recorder.stop()` and
   * therefore `faceAPI.endVideoStream()`).
   *
   * Also bounded by a runaway cap (`isRecordingOverCap`): a session left
   * abandoned with no operator action at all — this bug's exact field
   * scenario — still gets its recording stopped, finalized, and logged after
   * `MAX_RECORDING_DURATION_MS`, instead of running until the kiosk quits.
   *
   * No upload path here on purpose — whether video ever leaves the kiosk is
   * still an open question (that doc's §4 #3, and explicitly out of scope
   * per the 2026-09-05 product decision); this only ever writes to local
   * disk.
   *
   * Fallback only: once ≥2 physical cameras are mapped to roles, the
   * multi-channel effect below takes over instead, so this skips out to
   * avoid double-recording whichever camera happens to be active.
   */
  useEffect(() => {
    if (
      !shouldRecordSingleStream({
        recordVideo,
        recordingSessionKey,
        hasStream: !!stream,
        multiChannelDeviceCount: multiChannelDeviceIds.length,
      })
    )
      return;
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.startVideoStream) return; // web build, or no bridge to a desktop main process

    let cancelled = false;
    let recorder: MediaRecorder | null = null;
    let streamId: string | null = null;
    let capTimerId: ReturnType<typeof setInterval> | null = null;
    const chunks: BlobPart[] = [];
    const startedAt = Date.now();
    // Read once, at effect-start: `recordingSessionKey` IS the real session
    // id already (unlike the old `activeSession?.id` read, which could
    // briefly still name the previous run in the gap between arming the
    // flag and the engine actually creating the new session).
    const sessionIdForLog = recordingSessionKey ?? 'unknown';

    /** Stops the recorder (if still active) and finalizes via `endVideoStream`, logging what happened either way. Idempotent: a recorder already `inactive` (already stopped by the cap, or never started) is a no-op. */
    const stopAndFinalize = (): Promise<void> => {
      if (!recorder || (recorder as MediaRecorder).state === 'inactive') return Promise.resolve();

      const finishedRecorder = recorder;
      const finishedStreamId = streamId;
      return new Promise<void>((resolve) => {
        finishedRecorder.onstop = async () => {
          let files: string[] = [];
          if (finishedStreamId) {
            try {
              const blob = new Blob(chunks, { type: finishedRecorder.mimeType });
              const data = new Uint8Array(await blob.arrayBuffer());
              const result = await faceAPI.endVideoStream({
                streamId: finishedStreamId,
                data,
                durationMs: Date.now() - startedAt,
              });
              // Previously ignored entirely — a `{ ok: false, error }` reply
              // (e.g. the main process's Uint8Array validation, or a disk
              // write failure) used to vanish silently. Surfaced now so a
              // real save failure at least reaches main.log instead of just
              // leaving the capture_streams row unfinalized with no trace of
              // why.
              if (!result?.ok) {
                console.error(`[FaceCaptureApp] video recording failed to save: ${result?.error ?? 'unknown error'}`);
              } else {
                files = [finishedStreamId];
              }
            } catch (err) {
              console.error('[FaceCaptureApp] video recording failed to save:', err);
            }
          }
          console.warn('[FaceCaptureApp] recording stopped', { sessionId: sessionIdForLog, files });
          resolve();
        };
        finishedRecorder.stop();
      });
    };

    void (async () => {
      const mimeType =
        typeof MediaRecorder !== 'undefined'
          ? ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      try {
        const result = await faceAPI.startVideoStream({
          sessionId: sessionIdForLog,
          cameraId: selectedDeviceId || 'default',
          mimeType,
        });
        if (cancelled) return;
        streamId = result.streamId;

        recorder = new MediaRecorder(stream!, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.start();

        // Runaway-recording cap (2026-09-05 fix) — see `recordingSessionKey`'s
        // own doc comment and recordingGate.ts's `isRecordingOverCap`: a
        // session abandoned with no cancel/complete/restart ever firing must
        // not record forever. Checked periodically rather than a single
        // `setTimeout` so it stays correct even if the tab/process was
        // suspended (e.g. laptop sleep) for part of the interval.
        capTimerId = setInterval(() => {
          if (cancelled || !isRecordingOverCap(startedAt)) return;
          console.warn('[FaceCaptureApp] recording exceeded max duration, stopping', {
            sessionId: sessionIdForLog,
            maxMs: MAX_RECORDING_DURATION_MS,
          });
          if (capTimerId) clearInterval(capTimerId);
          void stopAndFinalize();
          setRecordingSessionKey((current) => (current === recordingSessionKey ? null : current));
        }, 30_000);
      } catch (err: any) {
        // DOMException (e.g. from MediaRecorder/faceAPI) stringifies to
        // "[object DOMException]" once console output is captured into the
        // kiosk's main.log, so bake name/message into the string itself
        // instead of relying on console's own object formatting.
        console.error(`[FaceCaptureApp] video recording failed to start: ${err?.name}: ${err?.message}`);
      }
    })();

    return () => {
      cancelled = true;
      if (capTimerId) clearInterval(capTimerId);
      void stopAndFinalize();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordVideo, stream, recordingSessionKey, multiChannelDeviceIds.length]);

  /**
   * True simultaneous multi-channel recording — see ROADMAP.md's "what's
   * actually left, in order" and
   * docs/plans/multi-camera-device-management-discussion.md §3.1. Takes over
   * from the single-stream effect above once ≥2 physical cameras are mapped
   * to roles: instead of recording only whichever camera the CV pipeline
   * currently has active (chopped into a separate clip every time the active
   * camera switches per step — see the role-switch effect below), this opens
   * one dedicated `MediaStream` + `MediaRecorder` per physical camera and
   * keeps all of them rolling for the whole session.
   *
   * Deliberately opens its own streams via raw `getUserMedia`, entirely
   * independent of `cameraServiceRef.current` (the single active stream the
   * CV/capture pipeline switches per step) — this file's own history of
   * subtle capture-trigger bugs is the reason that pipeline is left
   * untouched here, same rationale as the role-switch effect below. No
   * explicit resolution constraint on purpose: this is process evidence, not
   * the print-quality still (see discussion doc §2.5), so the browser's
   * default is lighter on the same USB/GPU bandwidth the CV stream is
   * already drawing on.
   *
   * Known, unresolved risk: when a mapped role's device is also the CV
   * pipeline's currently-active device, that physical camera ends up opened
   * twice concurrently — the same kind of USB/driver contention
   * docs/plans/multi-camera-device-management-discussion.md §2.1 already
   * documented hitting with even a single camera. Not mitigated here; needs
   * a real multi-camera hardware test pass, same caveat this file's
   * single-stream recorder above had when it was first built (no
   * display/simulator was available to exercise `MediaRecorder` live).
   * Mitigated only for simultaneous-capture mode (`simultaneousCapture`):
   * when `frameStreams` already has a stream for a device, this reuses it
   * below instead of opening a second one — the risk above still stands for
   * a role mapping configured without that flag.
   *
   * Gated via `shouldRecordMultiChannel` (recordingGate.ts) on `recordVideo`,
   * `recordingSessionKey`, and `multiChannelDeviceIds.length >= 2` — same
   * 2026-09-05 fix and reasoning as the single-stream effect above:
   * `recordingSessionKey` changing to a genuinely new session id is what
   * makes this effect's dependency array change and restart, which is the
   * only thing that runs this effect's cleanup (the only place that stops
   * every channel's `MediaRecorder` and calls `faceAPI.endVideoStream()` for
   * it) — a plain boolean stuck `true` from an abandoned session used to
   * make that never happen. Also bounded by the same runaway cap
   * (`isRecordingOverCap`) as the single-stream effect, applied per channel.
   */
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    if (
      !shouldRecordMultiChannel({
        recordVideo,
        recordingSessionKey,
        multiChannelDeviceCount: multiChannelDeviceIds.length,
      }) ||
      !faceAPI?.startVideoStream
    )
      return;

    let cancelled = false;
    const sessionId = recordingSessionKey ?? 'unknown';
    const startedAt = Date.now();
    const channels: Array<{
      mediaStream: MediaStream;
      recorder: MediaRecorder;
      streamId: string;
      chunks: BlobPart[];
      /** Whether this effect opened `mediaStream` itself and must stop its tracks — false for a stream reused from `frameStreamsRef`, which openFrameStreams/closeFrameStreams own instead. */
      ownsStream: boolean;
    }> = [];
    let capTimerId: ReturnType<typeof setInterval> | null = null;

    /** Stops every channel's recorder (if still active) and finalizes each via `endVideoStream`, then logs the whole session's outcome once. Idempotent per channel. */
    const stopAndFinalizeAll = (): Promise<void> => {
      const stopPromises = channels.map(
        (channel) =>
          new Promise<string | null>((resolve) => {
            const { recorder, mediaStream, streamId, chunks, ownsStream } = channel;
            if (recorder.state === 'inactive') {
              if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
              resolve(null);
              return;
            }
            recorder.onstop = async () => {
              if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
              try {
                const blob = new Blob(chunks, { type: recorder.mimeType });
                const data = new Uint8Array(await blob.arrayBuffer());
                const result = await faceAPI.endVideoStream({ streamId, data, durationMs: Date.now() - startedAt });
                // Same previously-ignored-result fix as the single-stream
                // recorder above.
                if (!result?.ok) {
                  console.error(
                    `[FaceCaptureApp] multi-channel recording failed to save for ${streamId}: ${result?.error ?? 'unknown error'}`
                  );
                  resolve(null);
                } else {
                  resolve(streamId);
                }
              } catch (err) {
                console.error(`[FaceCaptureApp] multi-channel recording failed to save for ${streamId}:`, err);
                resolve(null);
              }
            };
            recorder.stop();
          })
      );
      return Promise.all(stopPromises).then((files) => {
        console.warn('[FaceCaptureApp] recording stopped', {
          sessionId,
          files: files.filter((f): f is string => !!f),
        });
      });
    };

    void (async () => {
      const mimeType =
        typeof MediaRecorder !== 'undefined'
          ? ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      for (const deviceId of multiChannelDeviceIds) {
        try {
          const reusedStream = simultaneousCapture
            ? Object.values(frameStreamsRef.current).find(
                (s) => s.getVideoTracks()[0]?.getSettings().deviceId === deviceId
              ) ?? null
            : null;
          const ownsStream = !reusedStream;

          const mediaStream =
            reusedStream ??
            (await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { deviceId: { exact: deviceId } },
            }));
          if (cancelled) {
            if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
            continue;
          }

          const result = await faceAPI.startVideoStream({ sessionId, cameraId: deviceId, mimeType });
          if (cancelled) {
            if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
            continue;
          }

          const chunks: BlobPart[] = [];
          const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.start();
          channels.push({ mediaStream, recorder, streamId: result.streamId, chunks, ownsStream });
        } catch (err: any) {
          // Same DOMException-stringification fix as the single-stream
          // recorder above — see the comment there.
          console.error(`[FaceCaptureApp] multi-channel recording failed to start for ${deviceId}: ${err?.name}: ${err?.message}`);
        }
      }

      // Runaway-recording cap (2026-09-05 fix), applied once for the whole
      // multi-channel session — see the single-stream effect's identical
      // mechanism and recordingGate.ts's `isRecordingOverCap` for why.
      if (!cancelled && channels.length > 0) {
        capTimerId = setInterval(() => {
          if (cancelled || !isRecordingOverCap(startedAt)) return;
          console.warn('[FaceCaptureApp] recording exceeded max duration, stopping', {
            sessionId,
            maxMs: MAX_RECORDING_DURATION_MS,
          });
          if (capTimerId) clearInterval(capTimerId);
          void stopAndFinalizeAll();
          setRecordingSessionKey((current) => (current === recordingSessionKey ? null : current));
        }, 30_000);
      }
    })();

    return () => {
      cancelled = true;
      if (capTimerId) clearInterval(capTimerId);
      void stopAndFinalizeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordVideo, recordingSessionKey, multiChannelDeviceIds.join(','), simultaneousCapture]);

  /**
   * Switches the active camera to whichever one is mapped to the role the
   * current step needs — see docs/plans/multi-camera-device-management-discussion.md
   * §2.1. This is the entire "use multi-camera instead of turning your head"
   * feature: it reuses `handleSelectCamera` exactly as the manual camera
   * picker already does (same `camera.start({ deviceId })` call,
   * `BrowserCameraService`/`WorkflowEngine`/`StepEvaluator` never learn the
   * difference) — deliberately not a new capture path, to avoid touching
   * the step-evaluation/quality-gate code this file's own history of
   * subtle bugs (see the capture-trigger comments elsewhere here) warns
   * against changing without being able to run the app to verify.
   *
   * FRONT/UP/DOWN stay on CENTER (there is no "up" or "down" camera — those
   * two still need the subject to tilt their head, same as today). LEFT/RIGHT
   * switch to their mapped camera when one exists, so the subject can look
   * straight ahead while that camera captures the side angle instead of
   * turning to face a single camera. No mapping configured (today's common
   * case — no site has 3 physical cameras yet) → this never fires, and the
   * app behaves exactly as it does now. Disabled entirely in simultaneous-
   * capture mode (`simultaneousCapture`): CENTER stays the one analysed/
   * active camera there, and side frames get their own always-open streams
   * instead (see `openFrameStreams`).
   */
  useEffect(() => {
    if (mode !== 'live') return;
    if (simultaneousCapture) return;
    const role =
      activeGuidance.stepType === 'LEFT' ? 'LEFT' : activeGuidance.stepType === 'RIGHT' ? 'RIGHT' : 'CENTER';
    const mappedDeviceId = cameraRoleMapping[role];
    if (!mappedDeviceId) return;
    if (mappedDeviceId === selectedDeviceId) return;
    if (!devices.some((d) => d.id === mappedDeviceId)) return; // mapped camera not plugged in right now

    void handleSelectCamera(mappedDeviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, simultaneousCapture, activeGuidance.stepType, activeGuidance.currentStepIndex, cameraRoleMapping]);

  // Annotated on the callback, not just on stepsList: an object literal returned
  // from an unannotated .map() is checked for assignability only, so a misspelt
  // field is dropped in silence — which is how the step thumbnails were passed
  // under a name StepItem does not have and never rendered.
  const stepsList: StepItem[] = activeWorkflow.steps.map((s, idx): StepItem => {
    const sessionStep = activeSession?.steps.find((st) => st.stepId === s.id);
    const isCompleted = sessionStep?.status === 'COMPLETED' || idx < activeGuidance.currentStepIndex;
    const isCurrent = isWorkflowStarted && idx === activeGuidance.currentStepIndex && !isCompleted;

    return {
      id: s.id,
      label: s.type,
      status: isCompleted
        ? 'COMPLETED'
        : isCurrent
        ? 'CURRENT'
        : sessionStep?.status === 'FAILED'
        ? 'FAILED'
        : 'PENDING',
      imagePath: sessionStep?.capturedImagePath,
    };
  });

  /**
   * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture)
   * — built only while both the campaign flag and live mode are on;
   * `undefined` otherwise, so GuidedCaptureScreen's two views take their
   * `multiFrame` prop's `undefined` branch and render exactly as they did
   * before this feature existed.
   */
  const multiFrameProp: MultiFrameViewProps | undefined =
    simultaneousCapture && mode === 'live'
      ? {
          frames: framesForWorkflow(activeWorkflow).map((frame): MultiFrameViewFrame => {
            const sessionStep = activeSession?.steps.find((st) => st.stepId === frame.stepId);
            const stepIdx = activeWorkflow.steps.findIndex((s) => s.id === frame.stepId);
            const isCompleted = sessionStep?.status === 'COMPLETED';
            const isCurrent = isWorkflowStarted && stepIdx === activeGuidance.currentStepIndex && !isCompleted;
            const isMissing = !!framePreflight?.missing.some((m) => m.stepId === frame.stepId);
            const deviceId = frame.role === 'CENTER' ? selectedDeviceId : cameraRoleMapping[frame.role];
            const deviceLabel = devices.find((d) => d.id === deviceId)?.label ?? null;
            const frameStream = frame.role === 'CENTER' ? stream : frameStreams[frame.stepId] ?? null;
            // 2026-09-05 black-frame fix: a side frame whose camera hasn't
            // actually rendered a real frame yet stays 'PENDING' ("Chờ");
            // once it has, it becomes 'READY' ("Sẵn sàng") — see
            // `frameReadiness`'s own doc comment. CENTER never needs this
            // (its readiness is already covered by the face-quality gate).
            const isReady = frame.role !== 'CENTER' && frameReadiness[frame.stepId] === true;

            return {
              stepId: frame.stepId,
              label: frame.label,
              roleLabel: CAMERA_ROLE_LABELS_VI[frame.role],
              deviceLabel,
              stream: frameStream,
              status: isCompleted
                ? 'COMPLETED'
                : isCurrent
                ? 'CURRENT'
                : sessionStep?.status === 'FAILED'
                ? 'FAILED'
                : isMissing
                // A live stream with no mapped/connected device (today's CENTER
                // case, which keeps showing the main preview's stream regardless
                // of role mapping) reads as "not yet assigned", not "broken" —
                // 'MISSING' is reserved for a tile with no stream to show at all.
                ? frameStream
                  ? 'UNASSIGNED'
                  : 'MISSING'
                : isReady
                ? 'READY'
                : 'PENDING',
              imagePath: sessionStep?.capturedImagePath,
            };
          }),
          blocked: framePreflight,
          // 2026-09-05 black-frame fix: the shutter (OFF mode, in
          // DesktopCaptureView/MobileCaptureView) stays disabled until every
          // side frame is actually rendering — see `allSideFramesReady`'s
          // own doc comment in lib/multiFrame.ts for why this can't be
          // folded into `framePreflight`/`blocked` (that check runs before
          // any stream is even opened; this one needs the stream to already
          // be live).
          allSideFramesReady: allSideFramesReady(framesForWorkflow(activeWorkflow), frameReadiness),
          notReadyRoleLabel: (() => {
            const role = firstNotReadyFrameRole(framesForWorkflow(activeWorkflow), frameReadiness);
            return role ? CAMERA_ROLE_LABELS_VI[role] : null;
          })(),
          onOpenCameraSetup: () => {
            void (window as any).faceAPI?.openCameraSetup?.();
          },
          onRecheck: () => {
            void runFramePreflight(activeWorkflow);
          },
        }
      : undefined;

  const modeButton = (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-inner">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={switchToSimulationMode}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'simulation'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Mô phỏng (Simulation)
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" theme={theme}>
              Chế độ Mô phỏng dữ liệu camera bằng thanh trượt
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={startLiveMode}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'live'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Live Camera
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" theme={theme}>
              Chế độ Live Camera thực tế
            </TooltipContent>
          </Tooltip>
        </div>

        {/*
          Only rendered under the desktop app (this bridge method does not
          exist on the web build) — see cbHelpOpen's own doc comment above.
          Same toggle `Ctrl/Cmd+Shift+H` triggers; kept next to the mode
          toggle group and the Camera Setup affordance (§2.1's
          onOpenCameraSetup below) since both are kiosk-operator-only
          controls, never shown to the person being captured on the web
          build.
        */}
        {Boolean((window as any).faceAPI?.toggleCbHelpWindow) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleCbHelp}
                className={`hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer items-center gap-1.5 shadow-inner ${
                  cbHelpOpen
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Màn hình mở rộng
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" theme={theme}>
              {cbHelpOpen
                ? 'Đóng màn hình mở rộng (Ctrl/Cmd+Shift+H)'
                : 'Mở màn hình mở rộng — hiển thị các khung hình chụp (Ctrl/Cmd+Shift+H)'}
            </TooltipContent>
          </Tooltip>
        )}

        {/*
          Same desktop-only gating as the "Màn hình mở rộng" button above —
          `openCameraSetup` does not exist on the web build. Opens the
          per-angle Camera Setup window (Ctrl/Cmd+Shift+K's own window,
          `CameraSetupScreen.tsx`) without the operator needing to know that
          shortcut — see docs/plans/multi-camera-device-management-discussion.md
          §3.6's "Gán camera cho các góc" decision.
        */}
        {Boolean((window as any).faceAPI?.openCameraSetup) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void (window as any).faceAPI?.openCameraSetup?.()}
                className="hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer items-center gap-1.5 shadow-inner bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200"
              >
                <Camera className="w-3.5 h-3.5" />
                Cài đặt camera
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" theme={theme}>
              Gán camera vật lý cho từng góc chụp (Ctrl/Cmd+Shift+K)
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );

  const handleCancelWorkflow = useCallback(async () => {
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    // Stop-recording hook (§3.1 fix, 2026-09-05) — see `recordingSessionKey`'s
    // own doc comment. Same "does not re-arm on this function's own
    // pre-armed startSession" reasoning as handleRestart above.
    setRecordingSessionKey(null);
    setLatestCapturedImage(null);
    // Cancelling abandons a run that has not completed, same as "Chụp lại
    // toàn bộ" in handleRestart — see RunScopedCaptureSession's doc comment
    // for why the next run must not inherit this one's session id.
    runSessionRef.current.reset();
    // Frame streams are the multi-camera equivalent of the session reset
    // above: an abandoned simultaneous-capture run must not leave its side
    // cameras open into whatever comes next.
    closeFrameStreams();
    // CB Help (§3.5): same reasoning as handleRestart's identical call.
    publishCbHelpState({ phase: 'idle' });
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        simultaneousCapture: campaignSimultaneous,
        recordVideo: campaignRecordVideo,
      } = await resolveActiveWorkflow();
      setDeviceBlockedReason(blockedReason);
      setActiveWorkflow(workflow);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
      setEffectiveTriggerConfig(triggerConfig);
      captureTriggerRef.current.updateConfig({ mode: triggerConfig.mode, autoHoldMs: triggerConfig.autoHoldMs });
      setRecordVideo(campaignRecordVideo);
      if (!blockedReason) {
        const canStart = await runSimultaneousCaptureGate(mode === 'live', campaignSimultaneous, workflow);
        if (canStart) await activeEngine.startSession(workflow);
      }
    }
  }, [mode]);

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      {/*
        §3.3's fail-closed verdict — a confirmed rejection, or unreachable for
        over 24h. Deliberately opaque and undismissable, unlike storeError
        below: the whole point is that capture must not proceed, not just be
        flagged while continuing underneath.
      */}
      {deviceBlockedReason && (
        <div className="absolute inset-0 z-[200] bg-slate-950/98 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-5xl">🔒</span>
          <h2 className="text-xl font-semibold">Thiết bị đã bị khoá</h2>
          <p className="max-w-md text-sm text-slate-300">
            {deviceBlockedReason === 'unauthorized'
              ? 'Thiết bị này không còn được phép hoạt động (đã hết hạn hoặc bị thu hồi). Vui lòng liên hệ quản trị viên.'
              : 'Không thể liên lạc với hệ thống quản trị trong hơn 24 giờ. Vui lòng kiểm tra kết nối mạng hoặc liên hệ quản trị viên.'}
          </p>
        </div>
      )}
      {/*
        A capture that was not stored has to be visible while the person is
        still standing there. Discovering it once the session is finished is too
        late to retake anything.
      */}
      {storeError && (
        <div className="absolute top-0 inset-x-0 z-[100] bg-amber-500 text-slate-950 text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 shadow-lg">
          <span>⚠️</span>
          <span>{storeError}</span>
          <button onClick={() => setStoreError(null)} className="ml-2 underline cursor-pointer">
            Ẩn
          </button>
        </div>
      )}
      <GuidedCaptureScreen
        stream={stream}
        zoomScale={digitalZoomScale}
        zoomOrigin={digitalZoomCenter}
        isCameraLoading={isCameraLoading}
        cameraError={cameraError}
        faceState={faceState}
        guidance={activeGuidance}
        steps={stepsList}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={handleSelectCamera}
        cameraFps={cameraFps}
        cvFps={cvFps}
        stabilityProgress={activeGuidance.status === 'STABILIZING' ? activeGuidance.progress : 0}
        countdownValue={activeGuidance.status === 'COUNTDOWN' ? activeGuidance.countdownValue || 3 : 0}
        showDebugPanel={true}
        mode={mode}
        theme={theme}
        onToggleTheme={toggleTheme}
        modeButton={modeButton}
        onCancel={handleCancelWorkflow}
        onStartLive={startLiveMode}
        isWorkflowStarted={isWorkflowStarted}
        onStartWorkflow={handleStartWorkflow}
        onOpenReview={() => setShowReviewModal(true)}
        hasCapturedImages={!!activeSession?.steps.some((st) => st.capturedImagePath)}
        showScreenDebugStats={showScreenDebugStats}
        onToggleShowScreenDebugStats={handleToggleShowScreenDebugStats}
        gestureState={gestureState}
        gestureProgress={gestureProgress}
        onShutterCapture={handleShutterCapture}
        sensitivity={sensitivity}
        onSensitivityChange={handleSensitivityChange}
        captureMode={effectiveTriggerConfig.mode}
        autoHoldMs={effectiveTriggerConfig.autoHoldMs}
        captureModeFromCampaign={effectiveTriggerConfig.fromCampaign}
        onCaptureModeChange={handleCaptureModeChange}
        onAutoHoldMsChange={handleAutoHoldMsChange}
        latestCapturedImage={latestCapturedImage}
        multiFrame={multiFrameProp}
      />

      {mode === 'simulation' && (
        <SimulationSliders onChange={handleSimulationChange} theme={theme} />
      )}

      {showReviewModal && (
        <SessionReviewModal
          // activeSession is the engine's own live session object — it already
          // has whichever steps have been captured so far. `session` (React
          // state) is only ever set by the 'completed' handler below, so
          // before the last step it stays null and this modal would render
          // nothing at all for the "Xem kết quả" button opened mid-session.
          // Falling back to `session` keeps this working after a session ends
          // and a new one has not started yet (activeSession would be gone).
          session={activeSession ?? session}
          // Same source of truth as the capture views' CameraPreview mirror
          // (product decision 2026-09-05) — the operator posed in front of a
          // mirrored preview, so the review grid must match; the underlying
          // files (and anything exported/uploaded from them) stay unmirrored.
          mirrored={CAPTURE_MIRRORED}
          // Captures are staged (written to disk, queued, but not yet
          // eligible for upload — see queueCapture's own doc comment) the
          // instant each step is shot, long before review. This button is the
          // one place that turns "staged" into "sent": approveUpload releases
          // this run's rows to the existing background UploadWorker, which
          // picks them up completely unchanged from here. Only once that
          // succeeds do we close out the local record and the modal — a
          // failed approval leaves the review open so the operator can retry
          // without losing anything (the photos stay safely staged either
          // way; see approveUpload's own doc comment).
          onAccept={async () => {
            const completedSession = activeSession ?? session;
            if (completedSession && repoRef.current) {
              void repoRef.current.saveSession(completedSession);
            }
            // Per-step context the outbox row itself cannot supply — see
            // ApprovalStepInfo's own doc comment. framesForWorkflow() already
            // resolves the same cameraRole fallback a plain
            // defaultCameraRoleForStepType(step.type) call would, keyed by
            // stepId, so it is reused here rather than duplicated; a step
            // absent from the current workflow (should not happen) still
            // gets a role from the same default function directly.
            const steps: ApprovalStepInfo[] | undefined = completedSession
              ? completedSession.steps.map((s) => {
                  const frame = framesForWorkflow(activeWorkflowRef.current).find(
                    (f) => f.stepId === s.stepId
                  );
                  return {
                    stepId: s.stepId,
                    stepType: s.stepType,
                    cameraRole: frame?.role ?? defaultCameraRoleForStepType(s.stepType),
                    attempt: s.attempts,
                    capturedAt: s.timestamp ? new Date(s.timestamp).toISOString() : undefined,
                  };
                })
              : undefined;
            const approved = await approveUpload(steps);
            if (!approved) return;
            await finishSession();
            // The one true "this session is done" moment — the operator
            // confirmed it and approval actually succeeded, not merely that
            // the last capture step was reached (see this handler's own
            // doc comment on why finishSession lives here, not in the
            // engine's 'completed' handler above).
            reportStatsEvent('SESSION_COMPLETED');
            // CB Help (§3.5, 2026-09-05 second pass): the photos stay on the
            // extended display past acceptance too — only the header moves
            // from "awaiting confirmation" to "done" (see CbHelpFrames.tsx).
            // `finishSession()` above never touches the engine's own
            // session, so it still holds every capturedImagePath this reads.
            publishCbHelpState({ phase: 'done' });
            setShowReviewModal(false);
          }}
          onRetake={handleRestart}
          onRetakeStep={handleRetakeStep}
          onClose={() => setShowReviewModal(false)}
        />
      )}
    </div>
  );
}
