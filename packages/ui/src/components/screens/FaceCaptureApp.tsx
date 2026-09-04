import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { SlidersHorizontal, Camera } from 'lucide-react';
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
  CAMERA_ROLE_LABELS_VI,
  FramePreflight,
  FrameSpec,
} from '../../lib/multiFrame.js';
import type { MultiFrameViewProps, MultiFrameViewFrame } from './views/types.js';
import { GuidedCaptureScreen } from './GuidedCaptureScreen.js';
import { SessionReviewModal } from '../workflow/SessionReviewModal.js';
import { SimulationSliders, SimulationSettings } from '../debug/SimulationSliders.js';
import { StepItem } from '../workflow/StepProgress.js';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip.js';
import { getSettings, updateSettings } from '../../lib/settingsStore.js';
import { CaptureSink, RunScopedCaptureSession } from '../../lib/CaptureSink.js';
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
 *
 * Also reports the resolved steps to the CB Help display (§3.5), if one is
 * open, via `notifyCbHelpSessionStarted` — the one place every session-start
 * call site already passes through, so that screen's "new run" reset never
 * has to be wired in separately at each of them.
 */
async function resolveActiveWorkflow(): Promise<{
  workflow: CaptureWorkflow;
  triggerConfig: { mode: CaptureTriggerMode; autoHoldMs: number };
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
  } catch (err) {
    console.error('[FaceCaptureApp] resolveActiveWorkflow failed, using defaultWorkflow:', err);
  }

  try {
    await faceAPI?.notifyCbHelpSessionStarted?.(
      workflow.steps.map((s) => ({ id: s.id, type: s.type, instruction: s.instruction }))
    );
  } catch {
    /* no CB Help window open, or not running under the desktop app at all — fine either way */
  }

  const settings = getSettings();
  return {
    workflow,
    triggerConfig: {
      mode: campaignMode ?? settings.captureMode ?? 'MANUAL',
      autoHoldMs: campaignAutoHoldMs ?? settings.autoHoldMs ?? 2000,
    },
    blockedReason,
    simultaneousCapture,
  };
}

type StatsEventType = 'SESSION_COMPLETED' | 'UPLOAD_SUCCESS' | 'UPLOAD_FAILED' | 'RETAKE' | 'CB_HELP_INTERVENTION';

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

  /** Stops and clears every open frame stream — see the call sites below. */
  const closeFrameStreams = () => {
    for (const [stepId, mediaStream] of Object.entries(frameStreamsRef.current)) {
      mediaStream.getTracks().forEach((t) => t.stop());
      const videoEl = frameVideoElsRef.current[stepId];
      if (videoEl) videoEl.srcObject = null;
    }
    frameStreamsRef.current = {};
    setFrameStreams({});
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
          video: { deviceId: { exact: frame.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        frameStreamsRef.current[frame.stepId] = mediaStream;

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
      } = await resolveActiveWorkflow();
      setDeviceBlockedReason(blockedReason);
      if (blockedReason) {
        setIsWorkflowStarted(false);
        isWorkflowStartedRef.current = false;
        return;
      }
      setActiveWorkflow(workflow);
      activeEngine.setCaptureTriggerConfig(triggerConfig);

      const canStart = await runSimultaneousCaptureGate(mode === 'live', campaignSimultaneous, workflow);
      if (!canStart) {
        setIsWorkflowStarted(false);
        isWorkflowStartedRef.current = false;
        return;
      }

      await activeEngine.startSession(workflow);
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
   */
  const approveUpload = async (): Promise<boolean> => {
    try {
      await runSessionRef.current.approve();
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
                  console.warn(
                    `[FaceCaptureApp] simultaneous capture: no snapshot for ${frame.label} (${frame.role}) — left pending for retake`
                  );
                  continue;
                }
                liveEngine.recordExternalCapture(frame.stepId, dataUrl);
              }
            }
          }
        });

        liveEngine.on('completed', (completedSession: CaptureSession) => {
          setSession(completedSession);
          setShowReviewModal(true);
          if (repoRef.current) void repoRef.current.saveSession(completedSession);
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
        });

        const {
          workflow: liveWorkflow,
          triggerConfig: liveTriggerConfig,
          blockedReason: liveBlockedReason,
          simultaneousCapture: liveSimultaneous,
        } = await resolveActiveWorkflow();
        setDeviceBlockedReason(liveBlockedReason);
        setActiveWorkflow(liveWorkflow);
        liveEngine.setCaptureTriggerConfig(liveTriggerConfig);
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
                const wf = liveWorkflowEngineRef.current as any;
                // Pass the same frame isFaceReady was just computed from, so
                // the engine's own quality gate (WorkflowEngine.
                // triggerManualCapture) has something real to re-check at the
                // moment the gesture actually fires. Calling this with no
                // faceState at all used to skip that check silently — this
                // gesture path had nothing else standing between a smiling
                // face and a completed capture.
                if (wf.triggerManualCapture) wf.triggerManualCapture(currentFaceState);
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
    if (liveWorkflowEngineRef.current && faceState?.detected) {
      const wf = liveWorkflowEngineRef.current as any;
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
    captureTriggerRef.current.updateConfig({ mode: newMode });
    simWorkflowEngineRef.current?.setCaptureTriggerConfig({ mode: newMode });
    liveWorkflowEngineRef.current?.setCaptureTriggerConfig({ mode: newMode });
  }, []);

  const handleAutoHoldMsChange = useCallback((newMs: number) => {
    captureTriggerRef.current.updateConfig({ autoHoldMs: newMs });
    simWorkflowEngineRef.current?.setCaptureTriggerConfig({ autoHoldMs: newMs });
    liveWorkflowEngineRef.current?.setCaptureTriggerConfig({ autoHoldMs: newMs });
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

  const handleRetakeStep = async (stepId: string) => {
    const engine = liveWorkflowEngineRef.current;
    if (!engine) return;

    const started = await engine.retakeStep(stepId);
    if (!started) return;

    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;

    // Simultaneous capture: a side frame's retake has no shutter/gesture/
    // AUTO trigger of its own to wait on — engine.retakeStep() above already
    // put the session back in RUNNING with this step no longer COMPLETED,
    // so snapshot it right now, ungated. CENTER's retake keeps going through
    // the normal capture-trigger path above instead, and that handler's own
    // not-COMPLETED filter guarantees it will not re-snapshot the side
    // frames this block already (re)captured.
    if (simultaneousCaptureRef.current) {
      const frame = framesForWorkflow(activeWorkflowRef.current).find((f) => f.stepId === stepId);
      if (frame && frame.role !== 'CENTER') {
        const videoEl = frameVideoElsRef.current[stepId];
        const dataUrl = videoEl ? snapshotVideoFrame(videoEl) : null;
        if (dataUrl) {
          engine.recordExternalCapture(stepId, dataUrl);
        } else {
          console.warn(`[FaceCaptureApp] simultaneous retake: no snapshot for ${frame.label} (${frame.role})`);
        }
      }
    }
  };

  const handleRestart = async () => {
    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    reportStatsEvent('RETAKE');
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
      } = await resolveActiveWorkflow();
      setDeviceBlockedReason(blockedReason);
      setActiveWorkflow(workflow);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
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
   * elsewhere in this file: it only watches whether a session is running and
   * a camera stream exists, and starts/stops a `MediaRecorder` accordingly.
   *
   * `activeSession?.id` may briefly still name the previous run in the gap
   * between `setIsWorkflowStarted(true)` and the engine actually creating a
   * new session — acceptable here, since `capture_streams.session_id` is a
   * plain grouping tag on the desktop side, not an enforced foreign key
   * (see CaptureStreamRepository's own doc comment): worst case one
   * recording is tagged with the wrong session id, nothing is lost or
   * corrupted.
   *
   * No upload path here on purpose — whether video ever leaves the kiosk is
   * still an open question (that doc's §4 #3); this only ever writes to
   * local disk.
   *
   * Fallback only: once ≥2 physical cameras are mapped to roles, the
   * multi-channel effect below takes over instead, so this skips out to
   * avoid double-recording whichever camera happens to be active.
   */
  useEffect(() => {
    if (!stream || !isWorkflowStarted || multiChannelDeviceIds.length >= 2) return;
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.startVideoStream) return; // web build, or no bridge to a desktop main process

    let cancelled = false;
    let recorder: MediaRecorder | null = null;
    let streamId: string | null = null;
    const chunks: BlobPart[] = [];
    const startedAt = Date.now();

    void (async () => {
      const mimeType =
        typeof MediaRecorder !== 'undefined'
          ? ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      try {
        const result = await faceAPI.startVideoStream({
          sessionId: activeSession?.id ?? 'unknown',
          cameraId: selectedDeviceId || 'default',
          mimeType,
        });
        if (cancelled) return;
        streamId = result.streamId;

        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.start();
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
      if (!recorder || (recorder as MediaRecorder).state === 'inactive') return;

      const finishedRecorder = recorder;
      const finishedStreamId = streamId;
      finishedRecorder.onstop = async () => {
        if (!finishedStreamId) return;
        try {
          const blob = new Blob(chunks, { type: finishedRecorder.mimeType });
          const data = new Uint8Array(await blob.arrayBuffer());
          await faceAPI.endVideoStream({
            streamId: finishedStreamId,
            data,
            durationMs: Date.now() - startedAt,
          });
        } catch (err) {
          console.error('[FaceCaptureApp] video recording failed to save:', err);
        }
      };
      finishedRecorder.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, isWorkflowStarted, multiChannelDeviceIds.length]);

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
   */
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    if (!isWorkflowStarted || multiChannelDeviceIds.length < 2 || !faceAPI?.startVideoStream) return;

    let cancelled = false;
    const sessionId = activeSession?.id ?? 'unknown';
    const startedAt = Date.now();
    const channels: Array<{
      mediaStream: MediaStream;
      recorder: MediaRecorder;
      streamId: string;
      chunks: BlobPart[];
      /** Whether this effect opened `mediaStream` itself and must stop its tracks — false for a stream reused from `frameStreamsRef`, which openFrameStreams/closeFrameStreams own instead. */
      ownsStream: boolean;
    }> = [];

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
    })();

    return () => {
      cancelled = true;
      for (const channel of channels) {
        const { recorder, mediaStream, streamId, chunks, ownsStream } = channel;
        if (recorder.state === 'inactive') {
          if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
          continue;
        }
        recorder.onstop = async () => {
          if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType });
            const data = new Uint8Array(await blob.arrayBuffer());
            await faceAPI.endVideoStream({ streamId, data, durationMs: Date.now() - startedAt });
          } catch (err) {
            console.error(`[FaceCaptureApp] multi-channel recording failed to save for ${streamId}:`, err);
          }
        };
        recorder.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorkflowStarted, multiChannelDeviceIds.join(','), simultaneousCapture]);

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
                : 'PENDING',
              imagePath: sessionStep?.capturedImagePath,
            };
          }),
          blocked: framePreflight,
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
    </TooltipProvider>
  );

  const handleCancelWorkflow = useCallback(async () => {
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    setLatestCapturedImage(null);
    // Cancelling abandons a run that has not completed, same as "Chụp lại
    // toàn bộ" in handleRestart — see RunScopedCaptureSession's doc comment
    // for why the next run must not inherit this one's session id.
    runSessionRef.current.reset();
    // Frame streams are the multi-camera equivalent of the session reset
    // above: an abandoned simultaneous-capture run must not leave its side
    // cameras open into whatever comes next.
    closeFrameStreams();
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        simultaneousCapture: campaignSimultaneous,
      } = await resolveActiveWorkflow();
      setDeviceBlockedReason(blockedReason);
      setActiveWorkflow(workflow);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
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
            const approved = await approveUpload();
            if (!approved) return;
            await finishSession();
            // The one true "this session is done" moment — the operator
            // confirmed it and approval actually succeeded, not merely that
            // the last capture step was reached (see this handler's own
            // doc comment on why finishSession lives here, not in the
            // engine's 'completed' handler above).
            reportStatsEvent('SESSION_COMPLETED');
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
