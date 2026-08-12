import React, { useState, useEffect, useRef } from 'react';
import {
  CameraDevice,
  FaceState,
  GuidanceState,
  CaptureWorkflow,
  AttendanceResult,
  FrameInput,
} from '@face/core';
import { BrowserCameraService } from '@face/camera';
import { MockCVEngine } from '@face/cv-engine';
import { QualityEvaluator } from '@face/face-quality';
import { WorkflowEngine } from '@face/workflow-engine';
import {
  SQLiteStorageAdapter,
  PersonRepository,
  FaceProfileRepository,
  AttendanceRepository,
} from '@face/database';
import { ProfileBuilder, MockEmbeddingExtractor } from '@face/biometric';
import { AttendanceService } from '@face/attendance-engine';
import {
  GuidedCaptureScreen,
  KioskAttendanceScreen,
  SimulationSliders,
  SimulationSettings,
} from '@face/ui';

const sampleWorkflow: CaptureWorkflow = {
  id: 'standard_5_pose',
  name: 'Chuẩn 5 tư thế khuôn mặt',
  version: 1,
  steps: [
    {
      id: 'step_front',
      type: 'FRONT',
      instruction: 'Nhanh chóng nhìn thẳng vào camera',
      pose: { yaw: { target: 0, tolerance: 10 }, pitch: { target: 0, tolerance: 10 }, roll: { target: 0, tolerance: 10 } },
      stability: { durationMs: 1000 },
      capture: { enabled: true },
    },
    {
      id: 'step_left',
      type: 'LEFT',
      instruction: 'Quay đầu từ từ sang bên trái',
      pose: { yaw: { target: -25, tolerance: 10 } },
      stability: { durationMs: 1000 },
      capture: { enabled: true },
    },
  ],
};

export const App: React.FC = () => {
  const [appMode, setAppMode] = useState<'REGISTRATION' | 'KIOSK'>('KIOSK');
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

  // Camera & Services
  const [cameraService] = useState(() => new BrowserCameraService());
  const [cvEngine] = useState(() => new MockCVEngine());
  const [qualityEvaluator] = useState(() => new QualityEvaluator());
  const [workflowEngine] = useState(() => new WorkflowEngine());

  // Storage Repositories
  const [storageAdapter] = useState(() => new SQLiteStorageAdapter());
  const [personRepo, setPersonRepo] = useState<PersonRepository | null>(null);
  const [profileRepo, setProfileRepo] = useState<FaceProfileRepository | null>(null);
  const [_attendanceRepo, setAttendanceRepo] = useState<AttendanceRepository | null>(null);
  const [attendanceService, setAttendanceService] = useState<AttendanceService | null>(null);

  // States
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [faceState, setFaceState] = useState<FaceState | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState>(workflowEngine.currentState);
  const [attendanceResult, setAttendanceResult] = useState<AttendanceResult | null>(null);

  // Simulation controls
  const [simSettings, setSimSettings] = useState<SimulationSettings>({
    presence: 'SINGLE_FACE',
    yaw: 0,
    pitch: 0,
    roll: 0,
    faceSizeRatio: 0.45,
    qualityScore: 0.9,
  });

  const dummyFrameRef = useRef<FrameInput>({
    data: new Uint8ClampedArray(640 * 480 * 4),
    width: 640,
    height: 480,
    timestamp: Date.now(),
  });

  // 1. Initialize SQLite Database & Repositories
  useEffect(() => {
    storageAdapter.initialize().then(() => {
      const pRepo = new PersonRepository(storageAdapter);
      const prRepo = new FaceProfileRepository(storageAdapter);
      const aRepo = new AttendanceRepository(storageAdapter);

      setPersonRepo(pRepo);
      setProfileRepo(prRepo);
      setAttendanceRepo(aRepo);

      const attService = new AttendanceService(aRepo, { cooldownWindowMs: 60000 });
      setAttendanceService(attService);

      pRepo.savePerson({
        id: 'person_demo_1',
        displayName: 'Nguyễn Văn A',
        employeeCode: 'EMP001',
        status: 'ACTIVE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  }, [storageAdapter]);

  // 2. Camera Setup
  useEffect(() => {
    cvEngine.initialize();
    cameraService.requestPermission().then(() => {
      cameraService.enumerateDevices().then((devs: CameraDevice[]) => {
        setDevices(devs);
        if (devs.length > 0) setSelectedDeviceId(devs[0].id);
      });
      cameraService.start().then((s: MediaStream) => setStream(s));
    });

    return () => {
      cameraService.stop();
    };
  }, [cameraService, cvEngine]);

  // 3. Workflow Listener
  useEffect(() => {
    workflowEngine.startSession(sampleWorkflow, 'person_demo_1');
    workflowEngine.on('state-change', (gState: GuidanceState) => setGuidance(gState));
  }, [workflowEngine]);

  // 4. Real-time Analysis Loop
  useEffect(() => {
    let frameId: number;

    const processLoop = async () => {
      dummyFrameRef.current.timestamp = Date.now();
      const state = await cvEngine.processFrame(dummyFrameRef.current);

      if (simSettings.presence === 'NO_FACE') {
        state.detected = false;
        state.faceCount = 0;
        state.presence = 'NO_FACE';
      } else {
        state.detected = true;
        state.presence = simSettings.presence;
        state.pose = { yaw: simSettings.yaw, pitch: simSettings.pitch, roll: simSettings.roll };

        if (state.detection) {
          const q = qualityEvaluator.evaluateQuality(
            state.detection.boundingBox,
            640,
            480
          );
          state.quality = q;
        }
      }

      setFaceState(state);

      if (appMode === 'REGISTRATION') {
        await workflowEngine.processFrame(state);
      } else if (appMode === 'KIOSK' && attendanceService && profileRepo) {
        const activeProfiles = await profileRepo.getActiveProfiles();
        const gallery = activeProfiles.map((p) => ({
          profile: p.profile,
          centroid: p.vectors[0] || new Float32Array(512),
        }));

        if (state.detected && gallery.length > 0) {
          const extractor = new MockEmbeddingExtractor();
          const probe = extractor.generateEmbedding('sample_probe');
          const res = await attendanceService.processRecognition(probe, gallery);
          setAttendanceResult(res);
        }
      }

      frameId = requestAnimationFrame(processLoop);
    };

    frameId = requestAnimationFrame(processLoop);
    return () => cancelAnimationFrame(frameId);
  }, [cvEngine, qualityEvaluator, workflowEngine, simSettings, appMode, attendanceService, profileRepo]);

  // Handle Session Completion & Profile Persistence
  useEffect(() => {
    if (guidance.status === 'SUCCESS' && personRepo && profileRepo) {
      const session = workflowEngine.currentSession;
      if (session) {
        const builder = new ProfileBuilder();
        const { profile } = builder.buildProfileFromSession('person_demo_1', session);
        const extractor = new MockEmbeddingExtractor();

        profileRepo.saveProfile({
          profile,
          embeddings: [
            {
              id: `emb_${Date.now()}`,
              embedding: {
                vector: extractor.generateEmbedding('person_demo_1'),
                dimension: 512,
                modelFamily: 'ArcFace-Demo',
                modelVersion: 'v1.0',
                preprocessingVersion: 'v1.0',
                similarityMetric: 'cosine',
              },
              pose: { yaw: 0, pitch: 0, roll: 0 },
              qualityScore: 0.95,
              taskType: 'FRONT',
            },
          ],
        });
      }
    }
  }, [guidance.status, workflowEngine, personRepo, profileRepo]);

  const modeButton = (
    <button
      onClick={() => setAppMode(appMode === 'REGISTRATION' ? 'KIOSK' : 'REGISTRATION')}
      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition-all cursor-pointer shadow-md"
    >
      {appMode === 'REGISTRATION' ? 'Kiosk Chấm Công' : 'Mode Đăng Ký'}
    </button>
  );

  return (
    <div className="relative min-h-screen bg-slate-950">
      {appMode === 'REGISTRATION' ? (
        <GuidedCaptureScreen
          stream={stream}
          faceState={faceState}
          guidance={guidance}
          steps={sampleWorkflow.steps.map((s) => ({
            id: s.id,
            type: s.type,
            label: s.type,
            status: s.id === guidance.stepId ? 'CURRENT' : 'PENDING',
          }))}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={(id) => {
            setSelectedDeviceId(id);
            cameraService.start({ deviceId: id }).then((s: MediaStream) => setStream(s));
          }}
          cameraFps={30}
          cvFps={30}
          stabilityProgress={guidance.progress}
          showDebugPanel={true}
          theme={theme}
          onToggleTheme={toggleTheme}
          modeButton={modeButton}
          onCancel={() => setAppMode('KIOSK')}
        />
      ) : (
        <KioskAttendanceScreen
          stream={stream}
          faceState={faceState}
          attendanceResult={attendanceResult}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={(id) => {
            setSelectedDeviceId(id);
            cameraService.start({ deviceId: id }).then((s: MediaStream) => setStream(s));
          }}
          cameraFps={30}
          cvFps={30}
          showDebugPanel={true}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSwitchMode={() => setAppMode('REGISTRATION')}
        />
      )}

      <SimulationSliders
        initialSettings={simSettings}
        onChange={(updated: SimulationSettings) => setSimSettings(updated)}
        theme={theme}
      />
    </div>
  );
};
