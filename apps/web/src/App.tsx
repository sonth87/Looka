import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Camera } from 'lucide-react';
import {
  CameraDevice,
  CaptureSession,
  CaptureWorkflow,
  FaceState,
  GuidanceState,
} from '@face/core';
import { BrowserCameraService } from '@face/camera';
import { MockCVEngine, FramePipeline } from '@face/cv-engine';
import { MediaPipeCVEngine } from '@face/cv-mediapipe';
import { WorkflowEngine } from '@face/workflow-engine';
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

const defaultWorkflow: CaptureWorkflow = {
  id: 'standard-enrollment',
  name: 'Standard Face Capture',
  version: 1,
  steps: [
    {
      id: 'step-front',
      type: 'FRONT',
      instruction: 'Nhìn thẳng vào camera',
      pose: { yaw: { target: 0, tolerance: 10 } },
      stability: { durationMs: 400 },
      capture: { enabled: true },
    },
    {
      id: 'step-left',
      type: 'LEFT',
      instruction: 'Quay mặt sang trái',
      pose: { yaw: { target: -30, tolerance: 12 } },
      stability: { durationMs: 400 },
      capture: { enabled: true },
    },
    {
      id: 'step-right',
      type: 'RIGHT',
      instruction: 'Quay mặt sang phải',
      pose: { yaw: { target: 30, tolerance: 12 } },
      stability: { durationMs: 400 },
      capture: { enabled: true },
    },
    {
      id: 'step-up',
      type: 'UP',
      instruction: 'Ngẩng mặt lên một chút',
      pose: { pitch: { target: 15, tolerance: 10 } },
      stability: { durationMs: 400 },
      capture: { enabled: true },
    },
    {
      id: 'step-down',
      type: 'DOWN',
      instruction: 'Cúi mặt xuống một chút',
      pose: { pitch: { target: -15, tolerance: 10 } },
      stability: { durationMs: 400 },
      capture: { enabled: true },
    },
  ],
};

export default function App() {
  const [mode, setMode] = useState<'simulation' | 'live'>('simulation');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const saved = localStorage.getItem('face_ui_theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch {
      return 'dark';
    }
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('face_ui_theme', nextTheme);
      } catch {}
      return nextTheme;
    });
  };
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [faceState, setFaceState] = useState<FaceState | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState>({
    status: 'INITIALIZING',
    primaryInstruction: 'Đang khởi tạo...',
    primaryReason: 'NO_FACE',
    progress: 0,
    hints: [],
    currentStepIndex: 0,
    totalSteps: 5,
    stepId: 'step-front',
    stepType: 'FRONT',
  });
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [cameraFps] = useState(30);
  const [cvFps, setCvFps] = useState(0);

  const cameraServiceRef = useRef<BrowserCameraService | null>(null);
  const mockEngineRef = useRef<MockCVEngine | null>(null);
  const workflowEngineRef = useRef<WorkflowEngine | null>(null);
  const pipelineRef = useRef<FramePipeline | null>(null);
  const repoRef = useRef<SessionRepository | null>(null);

  useEffect(() => {
    async function init() {
      const adapter = new SQLiteStorageAdapter();
      await adapter.initialize();
      repoRef.current = new SessionRepository(adapter);

      const wfEngine = new WorkflowEngine();
      workflowEngineRef.current = wfEngine;

      wfEngine.on('state-change', (state: GuidanceState) => {
        setGuidance({ ...state });
      });

      wfEngine.on('completed', (completedSession: CaptureSession) => {
        setSession(completedSession);
        setShowReviewModal(true);
        if (repoRef.current) {
          repoRef.current.saveSession(completedSession);
        }
      });

      const mockCv = new MockCVEngine({ simulatedDelayMs: 10 });
      await mockCv.initialize();
      mockEngineRef.current = mockCv;

      const pipeline = new FramePipeline(mockCv);
      pipelineRef.current = pipeline;

      pipeline.onResult(async (state, fps) => {
        setFaceState(state);
        setCvFps(fps);
        await wfEngine.processFrame(state);
      });

      await wfEngine.startSession(defaultWorkflow);
    }

    init();

    return () => {
      cameraServiceRef.current?.stop();
    };
  }, []);

  const mediaPipeCvRef = useRef<MediaPipeCVEngine | null>(null);

  useEffect(() => {
    let animId: number;
    let lastSimTime = 0;

    const processFrameLoop = () => {
      if (mode === 'live' && cameraServiceRef.current && pipelineRef.current) {
        const frame = cameraServiceRef.current.getFrame();
        if (frame) {
          pipelineRef.current.pushFrame(frame);
        }
      } else if (mode === 'simulation' && mockEngineRef.current && pipelineRef.current) {
        const now = Date.now();
        if (now - lastSimTime >= 80) {
          // Stream ~12fps simulated frames continuously so StabilityTracker can stabilize
          lastSimTime = now;
          const dummyFrame = {
            data: new Uint8ClampedArray(640 * 480 * 4),
            width: 640,
            height: 480,
            timestamp: now,
          };
          pipelineRef.current.pushFrame(dummyFrame);
        }
      }
      animId = requestAnimationFrame(processFrameLoop);
    };

    animId = requestAnimationFrame(processFrameLoop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [mode]);

  const handleSimulationChange = async (settings: SimulationSettings) => {
    if (!mockEngineRef.current || !pipelineRef.current) return;

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

    pipelineRef.current.pushFrame(dummyFrame);
  };

  const startLiveMode = async () => {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      alert(
        'Trình duyệt đã chặn Camera do bạn đang truy cập qua địa chỉ IP HTTP từ máy khác.\n\n' +
        'Cách bật Camera cho máy này trên Chrome:\n' +
        '1. Mở tab mới: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n' +
        '2. Thêm URL: ' + window.location.origin + '\n' +
        '3. Chuyển sang "Enabled" và bấm Relaunch.'
      );
      return;
    }

    try {
      if (!mediaPipeCvRef.current) {
        const mpCv = new MediaPipeCVEngine();
        await mpCv.initialize().catch((e) => {
          console.warn('MediaPipe initialization fallback to MockCVEngine:', e);
        });
        if (mpCv.isInitialized) {
          mediaPipeCvRef.current = mpCv;
        }
      }

      // Always reconnect pipeline to MediaPipe engine (or fallback to Mock)
      const engineToUse =
        mediaPipeCvRef.current && mediaPipeCvRef.current.isInitialized
          ? mediaPipeCvRef.current
          : mockEngineRef.current;

      if (engineToUse) {
        const newPipeline = new FramePipeline(engineToUse);
        pipelineRef.current = newPipeline;
        newPipeline.onResult(async (state, fps) => {
          setFaceState(state);
          setCvFps(fps);
          if (workflowEngineRef.current) {
            await workflowEngineRef.current.processFrame(state);
          }
        });
      }

      const camera = cameraServiceRef.current || new BrowserCameraService();
      cameraServiceRef.current = camera;

      const devs = await camera.enumerateDevices();
      setDevices(devs);
      if (devs.length > 0) setSelectedDeviceId(devs[0].id);

      // Reset stale state before starting live video
      setFaceState(null);

      const st = await camera.start();
      setStream(st);
      setMode('live');
    } catch (err: any) {
      const msg = err?.message || String(err || '');
      if (msg.toLowerCase().includes('permission') || err?.name === 'NotAllowedError') {
        alert('Truy cập Camera bị từ chối. Vui lòng cho phép quyền Camera trong cài đặt trình duyệt hoặc hệ điều hành.');
      } else if (msg.toLowerCase().includes('not found') || err?.name === 'NotFoundError') {
        alert('Không tìm thấy thiết bị Camera nào kết nối với máy tính này.');
      } else {
        alert(`Không thể mở camera thực tế (${msg || 'Lỗi không xác định'}). Vui lòng kiểm tra lại thiết bị.`);
      }
    }
  };

  const switchToSimulationMode = async () => {
    if (cameraServiceRef.current) {
      await cameraServiceRef.current.stop();
      setStream(null);
    }
    // Clear stale live camera face detection state
    setFaceState(null);

    if (mockEngineRef.current) {
      const newPipeline = new FramePipeline(mockEngineRef.current);
      pipelineRef.current = newPipeline;
      newPipeline.onResult(async (state, fps) => {
        setFaceState(state);
        setCvFps(fps);
        if (workflowEngineRef.current) {
          await workflowEngineRef.current.processFrame(state);
        }
      });
      // Immediately push clean initial simulation frame
      handleSimulationChange({
        presence: 'SINGLE_FACE',
        yaw: 0,
        pitch: 0,
        roll: 0,
        qualityScore: 0.9,
        faceSizeRatio: 0.45,
      });
    }
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
    if (workflowEngineRef.current) {
      await workflowEngineRef.current.startSession(defaultWorkflow);
    }
  };

  const stepsList: StepItem[] = defaultWorkflow.steps.map((s, idx) => ({
    id: s.id,
    label: s.type,
    status:
      idx < guidance.currentStepIndex
        ? 'COMPLETED'
        : idx === guidance.currentStepIndex
        ? 'CURRENT'
        : 'PENDING',
  }));

  const modeButton = (
    <TooltipProvider>
      <div className="flex items-center gap-1 p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={switchToSimulationMode}
              className={`p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center ${
                mode === 'simulation'
                  ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-500/30'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
              }`}
            >
              <SlidersHorizontal className="w-4.5 h-4.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" theme={theme}>
            Chế độ Giả lập (Pose Simulation)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={startLiveMode}
              className={`p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center ${
                mode === 'live'
                  ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-500/30'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
              }`}
            >
              <Camera className="w-4.5 h-4.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" theme={theme}>
            Chế độ Live Camera thực tế
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );

  return (
    <div className="relative min-h-screen">
      <GuidedCaptureScreen
        stream={stream}
        faceState={faceState}
        guidance={guidance}
        steps={stepsList}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={handleSelectCamera}
        cameraFps={cameraFps}
        cvFps={cvFps}
        stabilityProgress={guidance.status === 'STABILIZING' ? guidance.progress : 0}
        countdownValue={guidance.status === 'COUNTDOWN' ? guidance.countdownValue || 3 : 0}
        showDebugPanel={true}
        mode={mode}
        theme={theme}
        onToggleTheme={toggleTheme}
        modeButton={modeButton}
        onCancel={handleRestart}
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
