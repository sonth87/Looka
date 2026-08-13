import { useEffect, useRef, useState, useCallback } from 'react';
import { SlidersHorizontal, Camera } from 'lucide-react';
import {
  CameraDevice,
  CaptureSession,
  CaptureSensitivity,
  CaptureTriggerMode,
  CaptureWorkflow,
  FaceState,
  GestureState,
  GuidanceState,
} from '@face/core';
import { BrowserCameraService } from '@face/camera';
import { MockCVEngine, FramePipeline } from '@face/cv-engine';
import { MediaPipeCVEngine } from '@face/cv-mediapipe';
import { MediaPipeGestureEngine } from '@face/hand-gesture';
import { WorkflowEngine, CaptureTriggerEvaluator } from '@face/workflow-engine';
import { SQLiteStorageAdapter, SessionRepository } from '@face/database';
import {
  GuidedCaptureScreen,
  SessionReviewModal,
  SimulationSliders,
  SimulationSettings,
  StepItem,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@face/ui';
import { getSettings, updateSettings } from '@face/ui';

const defaultWorkflow: CaptureWorkflow = {
  id: 'workflow_standard_5step',
  name: 'Quy trình 5 hướng chuẩn',
  version: 1,
  steps: [
    {
      id: 'step-front',
      type: 'FRONT',
      instruction: 'Nhìn thẳng vào camera',
      pose: { yaw: { target: 0, tolerance: 7 }, pitch: { target: 0, tolerance: 7 } },
      capture: { enabled: true },
    },
    {
      id: 'step-left',
      type: 'LEFT',
      instruction: 'Quay mặt sang trái (40° - 90°)',
      pose: { yaw: { target: -65, tolerance: 25 } },
      capture: { enabled: true },
    },
    {
      id: 'step-right',
      type: 'RIGHT',
      instruction: 'Quay mặt sang phải (40° - 90°)',
      pose: { yaw: { target: 65, tolerance: 25 } },
      capture: { enabled: true },
    },
    {
      id: 'step-up',
      type: 'UP',
      instruction: 'Ngẩng đầu lên (25° - 50°)',
      pose: { pitch: { target: -37.5, tolerance: 12.5 } },
      capture: { enabled: true },
    },
    {
      id: 'step-down',
      type: 'DOWN',
      instruction: 'Cúi đầu xuống (25° - 50°)',
      pose: { pitch: { target: 37.5, tolerance: 12.5 } },
      capture: { enabled: true },
    },
  ],
};

export default function App() {
  const [mode, setMode] = useState<'simulation' | 'live'>(() => {
    if (typeof window !== 'undefined' && (window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))) {
      return 'live';
    }
    return 'simulation';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getSettings().theme || 'light');

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      updateSettings({ theme: nextTheme });
      return nextTheme;
    });
  };
  const [stream, setStream] = useState<MediaStream | null>(null);
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
  const repoRef = useRef<SessionRepository | null>(null);
  const gestureEngineRef = useRef<MediaPipeGestureEngine | null>(null);
  const captureTriggerRef = useRef<CaptureTriggerEvaluator>(new CaptureTriggerEvaluator());
  const gestureAnimRef = useRef<number | null>(null);

  useEffect(() => {
    async function init() {
      const adapter = new SQLiteStorageAdapter();
      await adapter.initialize().catch((e) => console.warn('SQLiteStorageAdapter init warning:', e));
      repoRef.current = new SessionRepository(adapter);

      // ── Simulation Workflow Engine ──────────────────────────────
      const simEngine = new WorkflowEngine();
      simEngine.setSensitivity(sensitivity);
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
        if (repoRef.current) repoRef.current.saveSession(completedSession);
      });

      const mockCv = new MockCVEngine({ simulatedDelayMs: 10 });
      mockCv.updateSettings({ detected: false, faceCount: 0 });
      await mockCv.initialize();
      mockEngineRef.current = mockCv;

      const simPipeline = new FramePipeline(mockCv);
      simPipelineRef.current = simPipeline;

      simPipeline.onResult(async (state, fps) => {
        if (mode === 'simulation') {
          setFaceState(state);
          setCvFps(fps);
        }
        await simEngine.processFrame(state);
      });

      await simEngine.startSession(defaultWorkflow);

      // ── Live Workflow Engine ────────────────────────────────────
      const liveEngine = new WorkflowEngine();
      liveEngine.setSensitivity(sensitivity);
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
      });

      liveEngine.on('completed', (completedSession: CaptureSession) => {
        setSession(completedSession);
        setShowReviewModal(true);
        if (repoRef.current) repoRef.current.saveSession(completedSession);
      });

      await liveEngine.startSession(defaultWorkflow);

      if (typeof window !== 'undefined' && (window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))) {
        startLiveMode();
      }
    }

    init();

    return () => {
      cameraServiceRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mediaPipeCvRef = useRef<MediaPipeCVEngine | null>(null);

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
          const frame = cameraServiceRef.current.getFrame();
          if (frame) {
            try {
              const gs = await gestureEngineRef.current.processFrame(frame);
              setGestureState(gs);

              const currentFaceState = faceState;
              const decision = captureTriggerRef.current.evaluate({
                faceReady: currentFaceState?.detected ?? false,
                faceStabilityProgress: 0,
                gestureState: gs,
                currentTime: now,
              });
              setGestureProgress(decision.gestureProgress ?? 0);

              if (decision.capture && liveWorkflowEngineRef.current) {
                captureTriggerRef.current.reset();
                const wf = liveWorkflowEngineRef.current as any;
                if (wf.triggerManualCapture) wf.triggerManualCapture();
              }
            } catch (e) {
              // ignore gesture errors
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
  }, [mode, faceState]);

  const handleShutterCapture = useCallback(() => {
    if (liveWorkflowEngineRef.current && faceState?.detected) {
      const wf = liveWorkflowEngineRef.current as any;
      if (wf.triggerManualCapture) wf.triggerManualCapture();
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
          eyesVisible: true,
          mouthVisible: true,
          occluded: false,
          reasons: [],
        },
        timestamp: Date.now(),
      });
    }
  };

  const startLiveMode = async () => {
    setMode('live');
    setFaceState(null);

    try {
      if (!mediaPipeCvRef.current) {
        const mpCv = new MediaPipeCVEngine();
        await mpCv.initialize().catch((e) => {
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
        ge.initialize().catch((e) =>
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
        newLivePipeline.onResult(async (state, fps) => {
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
    } catch (err: any) {
      console.warn('Live camera unavailable:', err);
      setStream(null);
    }
  };

  const switchToSimulationMode = async () => {
    if (cameraServiceRef.current) {
      await cameraServiceRef.current.stop();
      setStream(null);
    }
    setFaceState(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    setMode('simulation');
  };

  const handleSelectCamera = async (devId: string) => {
    setSelectedDeviceId(devId);
    if (cameraServiceRef.current) {
      const st = await cameraServiceRef.current.start({ deviceId: devId });
      setStream(st);
    }
  };

  const handleRestart = async () => {
    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
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

  const stepsList: StepItem[] = defaultWorkflow.steps.map((s, idx) => {
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
      thumbnailUrl: sessionStep?.capturedImagePath,
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
    const activeEngine = mode === 'live' ? liveWorkflowEngineRef.current : simWorkflowEngineRef.current;
    if (activeEngine) {
      await activeEngine.startSession(defaultWorkflow);
    }
  }, [mode]);

  return (
    <div className="relative min-h-screen">
      <GuidedCaptureScreen
        stream={stream}
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
        hasCompletedSession={session?.status === 'COMPLETED'}
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
          session={session}
          onAccept={() => {
            alert('Hồ sơ đã được xác nhận và lưu vào SQLite thành công!');
            setShowReviewModal(false);
          }}
          onRetake={handleRestart}
          onClose={() => setShowReviewModal(false)}
        />
      )}
    </div>
  );
}
