import { useEffect, useRef, useState } from 'react';
import { AttendanceResult, CameraDevice, FaceState, Person } from '@face/core';
import { BrowserCameraService } from '@face/camera';
import { MockCVEngine, FramePipeline } from '@face/cv-engine';
import { MediaPipeCVEngine } from '@face/cv-mediapipe';
import { KioskAttendanceScreen } from './KioskAttendanceScreen.js';

/**
 * The "brain" `KioskAttendanceScreen` never had — that component only ever
 * rendered whatever props it was given (see its own file: no camera, no CV
 * engine, no recognition call anywhere in it), and nothing in this repo
 * constructed it with real data until this file. Mirrors the camera/CV
 * bring-up in FaceCaptureApp.tsx (proven, and this codebase has a documented
 * history of subtle bugs in that exact code — see its own comments), trimmed
 * to what attendance actually needs: no workflow engine, no capture-trigger
 * gestures, no simulation mode.
 *
 * DEMO MODE — see apps/desktop/src/main/attendance.ts's doc comment for why:
 * the embedding model behind `attendanceProcessFrame` is a wiring placeholder,
 * not real face recognition, so this will never actually confirm anyone. The
 * banner below says so; do not remove it without a real model behind the IPC
 * calls this component makes.
 */
export function KioskAttendanceApp() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>();
  const [faceState, setFaceState] = useState<FaceState | null>(null);
  const [cvFps, setCvFps] = useState(0);
  const [attendanceResult, setAttendanceResult] = useState<AttendanceResult | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [persons, setPersons] = useState<Person[]>([]);
  const [enrollName, setEnrollName] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState<string | null>(null);

  const cameraRef = useRef<BrowserCameraService | null>(null);
  const cvEngineRef = useRef<MediaPipeCVEngine | MockCVEngine | null>(null);
  const pipelineRef = useRef<FramePipeline | null>(null);
  const faceStateRef = useRef<FaceState | null>(null);
  faceStateRef.current = faceState;

  const faceAPI = () => (window as any).faceAPI;

  const reloadPersons = () => {
    faceAPI()
      ?.attendanceListPersons?.()
      .then(setPersons)
      .catch(() => {});
  };

  // Camera + CV bring-up, once on mount.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const mpCv = new MediaPipeCVEngine();
        await mpCv.initialize().catch((e: any) => {
          console.warn('[KioskAttendanceApp] MediaPipe init failed, falling back to MockCVEngine:', e);
        });
        const engine = mpCv.isInitialized ? mpCv : new MockCVEngine({ simulatedDelayMs: 10 });
        if (cancelled) return;
        cvEngineRef.current = engine;

        const pipeline = new FramePipeline(engine);
        pipeline.onResult((state: FaceState, fps: number) => {
          setFaceState(state);
          setCvFps(fps);
        });
        pipelineRef.current = pipeline;

        const camera = new BrowserCameraService();
        cameraRef.current = camera;
        const devs = await camera.enumerateDevices().catch(() => []);
        if (cancelled) return;
        setDevices(devs);
        if (devs.length > 0) setSelectedDeviceId(devs[0].id);

        const st = await camera.start();
        if (cancelled) return;
        setStream(st);
      } catch (err) {
        console.error('[KioskAttendanceApp] init error:', err);
      }
    }

    init();
    reloadPersons();

    return () => {
      cancelled = true;
      cameraRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pump camera frames into the CV pipeline every animation frame — same
  // mechanism FaceCaptureApp.tsx uses (BrowserCameraService.getFrame() is
  // pull-based, not a push subscription).
  useEffect(() => {
    let animId: number;
    const loop = () => {
      const frame = cameraRef.current?.getFrame();
      if (frame && pipelineRef.current) pipelineRef.current.pushFrame(frame);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // While a real face is detected (this part is genuine — only the identity
  // match behind it is mocked), poll the attendance pipeline. Throttled to
  // ~1/sec: TemporalConfirmer needs repeated observations over time, not
  // every-frame calls.
  useEffect(() => {
    if (!faceState?.detected) return;
    const api = faceAPI();
    if (!api?.attendanceProcessFrame) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const result = await api.attendanceProcessFrame();
        if (!cancelled) setAttendanceResult(result);
      } catch (err) {
        console.error('[KioskAttendanceApp] processFrame failed:', err);
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [faceState?.detected]);

  // Face left the frame: forget whatever identity was being confirmed so the
  // next person starts from a clean window, same as TemporalConfirmer's own
  // expireOnFaceLost behaviour.
  useEffect(() => {
    if (faceState?.detected) return;
    faceAPI()?.attendanceResetSession?.();
    setAttendanceResult(null);
  }, [faceState?.detected]);

  const handleSelectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (!cameraRef.current) return;
    try {
      const st = await cameraRef.current.start({ deviceId });
      setStream(st);
    } catch (err) {
      console.error('[KioskAttendanceApp] camera switch failed:', err);
    }
  };

  const handleEnroll = async () => {
    const displayName = enrollName.trim();
    if (!displayName) return;
    setEnrollBusy(true);
    setEnrollMessage(null);
    try {
      const result = await faceAPI().attendanceEnroll({ displayName });
      setEnrollMessage(
        `Đã tạo "${displayName}" (profile ${result.profileStatus}, model ${result.modelFamily}) — xem banner phía trên: sẽ không được nhận diện.`
      );
      setEnrollName('');
      reloadPersons();
    } catch (err) {
      setEnrollMessage(`Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEnrollBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen">
      <div className="fixed top-0 inset-x-0 z-[70] bg-amber-500 text-amber-950 text-xs sm:text-sm font-semibold text-center py-1.5 px-3">
        ⚠️ DEMO MODE — model nhận diện hiện là placeholder (mock), sẽ không nhận ra ai. Xem apps/desktop/src/main/attendance.ts.
      </div>

      <div className="pt-8">
        <KioskAttendanceScreen
          stream={stream}
          faceState={faceState}
          attendanceResult={attendanceResult}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={handleSelectDevice}
          cvFps={cvFps}
          showDebugPanel
          mode="live"
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />
      </div>

      <div className="fixed bottom-3 left-3 z-40 w-64 rounded-2xl border border-slate-800 bg-slate-950/90 backdrop-blur-md p-3 text-slate-100 shadow-2xl">
        <h3 className="text-xs font-bold mb-2">Đăng ký (demo)</h3>
        <div className="flex gap-1.5">
          <input
            value={enrollName}
            onChange={(e) => setEnrollName(e.target.value)}
            placeholder="Tên hiển thị"
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100"
          />
          <button
            onClick={handleEnroll}
            disabled={enrollBusy || !enrollName.trim()}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold disabled:opacity-50 shrink-0"
          >
            {enrollBusy ? '...' : 'Đăng ký'}
          </button>
        </div>
        {enrollMessage && <p className="text-[11px] text-slate-400 mt-1.5">{enrollMessage}</p>}
        <p className="text-[11px] text-slate-500 mt-1.5">{persons.length} người đã đăng ký (đều ở trạng thái DRAFT)</p>
      </div>
    </div>
  );
}
