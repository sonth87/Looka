import { useEffect, useRef, useState, useCallback } from 'react';
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

  const handleStartWorkflow = async () => {
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      await activeEngine.startSession(defaultWorkflow);
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
    }
  };

  useEffect(() => {
    async function init() {
      // Guarded on its own, separate from the try below: a database that fails
      // to open must degrade the local cache, not the whole screen. The two were
      // once one try/catch, so a browser that could not open sql.js never got as
      // far as starting the camera either.
      try {
        const adapter = new SQLiteStorageAdapter();
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
          mode: getSettings().captureMode || 'AUTO',
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

        await simEngine.startSession(defaultWorkflow);

        const liveEngine = new WorkflowEngine();
        liveEngine.setSensitivity(sensitivity);
        liveEngine.setCaptureTriggerConfig({
          mode: getSettings().captureMode || 'AUTO',
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

        await liveEngine.startSession(defaultWorkflow);

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

    try {
      if (!mediaPipeCvRef.current) {
        const mpCv = new MediaPipeCVEngine();
        await mpCv.initialize().catch((e: any) => {
          console.warn('MediaPipe initialization fallback to MockCVEngine:', e);
        });
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
  };

  const switchToSimulationMode = async () => {
    if (cameraServiceRef.current) {
      await cameraServiceRef.current.stop();
      setStream(null);
    }
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
  };

  const handleRestart = async () => {
    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
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
      await activeEngine.startSession(defaultWorkflow);
    }
    if (mode === 'simulation') {
      setFaceState(null);
      if (mockEngineRef.current) mockEngineRef.current.updateSettings({ detected: false, faceCount: 0 });
    }
  };

  const activeGuidance = mode === 'live' ? liveGuidance : simGuidance;
  const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
  const activeSession = activeEngine?.currentSession;

  // Annotated on the callback, not just on stepsList: an object literal returned
  // from an unannotated .map() is checked for assignability only, so a misspelt
  // field is dropped in silence — which is how the step thumbnails were passed
  // under a name StepItem does not have and never rendered.
  const stepsList: StepItem[] = defaultWorkflow.steps.map((s, idx): StepItem => {
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
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      await activeEngine.startSession(defaultWorkflow);
    }
  }, [mode]);

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col bg-slate-950 text-slate-100">
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
