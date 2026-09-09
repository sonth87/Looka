import { useCallback, useEffect, useRef, useState } from 'react';
import type { Worker } from 'tesseract.js';
import { createCccdWorker, recognizeWithWorker } from './ocr.js';

/**
 * Standalone CCCD (Vietnamese citizen ID card) front-side OCR scanner —
 * 2026-09-09 product request, built as its own Electron app rather than
 * folded into apps/desktop.
 *
 * Why standalone: apps/desktop/src/main/cccdWatcher.ts already treats the
 * CCCD scanner as a fully decoupled external producer of
 * `D:\Work\camera_server\response.json` — it was built with zero knowledge
 * of how that file gets written, and this app is exactly (and only) that
 * external producer. The kiosk also already juggles up to 3 simultaneous
 * camera streams for the real capture workflow; a 4th ad-hoc camera device
 * here, in the same process, risks resource/permission contention with
 * that already-tested code for no benefit — this tool runs on the same
 * machine but as a separate process, opened only when an operator is
 * actively scanning a card.
 *
 * Flow (2026-09-09, second pass — fully hands-free): pick the phone's
 * bridged camera (Iriun/DroidCam/Camo/etc. — it just shows up as a normal
 * Windows camera device) -> live preview -> the app continuously OCRs
 * incoming frames on its own, no capture button. A 12-digit citizen id is
 * only trusted once the SAME number is read on `STABILITY_COUNT` consecutive
 * polls in a row — a single garbled frame can't trigger a write on its own,
 * since Tesseract's per-frame accuracy on a hand-held card varies with
 * focus/lighting/angle. Once stable, the number is shown on screen for
 * `STABLE_DISPLAY_MS` (an operator glance-check, not a blocking gate — the
 * product decision here was "auto-confirm after a stable read", not "always
 * require a tap") before `response.json` is written automatically, then the
 * loop resumes for the next student.
 */

type Phase = 'initializing' | 'scanning' | 'stable-detected' | 'writing' | 'write-error' | 'success';

interface Candidate {
  citizenId: string;
  fullName: string | null;
}

/**
 * Consecutive identical reads required before a number is trusted enough to
 * auto-write. 2 is a deliberate floor, not just "as low as possible": one
 * lucky/unlucky single-frame read is not enough evidence on its own, but
 * requiring many more would make the operator hold the card still for
 * noticeably longer with no meaningful safety gain — a coincidental identical
 * misread twice in a row, for the same physical card, is already very
 * unlikely given `extractCitizenId`'s clean-12-digit-token gate.
 */
const STABILITY_COUNT = 2;

/** How long a stable read stays visible before auto-writing — long enough for an operator glance, short enough to not slow down a queue of students. */
const STABLE_DISPLAY_MS = 1200;

/** How long the success banner stays up before the loop resumes scanning for the next student. */
const SUCCESS_DISPLAY_MS = 1800;

/** How long to wait between OCR polls once a frame has been processed — OCR itself takes a few hundred ms to ~1s, this just prevents back-to-back polls with zero breathing room. */
const POLL_GAP_MS = 300;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);

  const [phase, setPhase] = useState<Phase>('initializing');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastAttemptText, setLastAttemptText] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Enumerate cameras once on mount. `enumerateDevices()` only returns real
  // device labels once a getUserMedia permission has already been granted —
  // otherwise every entry's `label` is an empty string, which would leave
  // the operator unable to tell the phone's bridged camera apart from
  // anything else Windows lists. So this requests a throwaway generic
  // stream first purely to unlock labels, then immediately stops it.
  useEffect(() => {
    let cancelled = false;

    async function loadDevices() {
      try {
        const bootstrapStream = await navigator.mediaDevices.getUserMedia({ video: true });
        bootstrapStream.getTracks().forEach((track) => track.stop());

        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const cams = all.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        if (cams.length > 0) setSelectedDeviceId((current) => current || cams[0].deviceId);
      } catch (err) {
        if (!cancelled) setCameraError(describeCameraError(err));
      }
    }

    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)start the live preview whenever the selected device changes.
  useEffect(() => {
    if (!selectedDeviceId) return;
    let cancelled = false;

    async function startPreview() {
      stopStream();
      setCameraError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedDeviceId } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        if (!cancelled) setCameraError(describeCameraError(err));
      }
    }

    void startPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, stopStream]);

  useEffect(() => stopStream, [stopStream]);

  // One long-lived Tesseract worker for the life of this window — see
  // `ocr.ts`'s own doc comment on why continuous polling needs this instead
  // of `recognizeCccdFrame`'s original create-per-call shape.
  useEffect(() => {
    let cancelled = false;
    void createCccdWorker().then((worker) => {
      if (cancelled) {
        void worker.terminate();
        return;
      }
      workerRef.current = worker;
      setWorkerReady(true);
    });
    return () => {
      cancelled = true;
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) void worker.terminate();
    };
  }, []);

  // The continuous auto-scan loop itself. Runs whenever the camera and
  // worker are both ready and nothing else (a stable detection being
  // displayed, a write in flight, the success banner) currently owns the
  // screen — `phase === 'scanning'` is the single gate for "the loop should
  // be polling right now", so pausing it during those other phases is just
  // a matter of not being in 'scanning'.
  useEffect(() => {
    if (phase !== 'scanning') return;
    if (!workerReady || !selectedDeviceId || cameraError) return;

    let cancelled = false;
    let streak = 0;
    let streakCitizenId: string | null = null;
    let streakFullName: string | null = null;

    async function pollOnce() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const worker = workerRef.current;
      if (!video || !canvas || !worker || video.videoWidth === 0) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');

      let result;
      try {
        result = await recognizeWithWorker(worker, dataUrl);
      } catch (err) {
        // A one-off OCR failure (e.g. a mid-frame camera hiccup) must not
        // kill the loop — just skip this poll and try again next tick.
        if (!cancelled) setLastAttemptText(err instanceof Error ? err.message : String(err));
        return;
      }
      if (cancelled) return;

      if (!result.citizenId) {
        streak = 0;
        streakCitizenId = null;
        streakFullName = null;
        setLastAttemptText('Chưa đọc được số CCCD rõ ràng...');
        return;
      }

      if (result.citizenId === streakCitizenId) {
        streak += 1;
      } else {
        streak = 1;
        streakCitizenId = result.citizenId;
      }
      streakFullName = result.fullName ?? streakFullName;
      setLastAttemptText(`Đang đọc: ${result.citizenId} (${streak}/${STABILITY_COUNT})`);

      if (streak >= STABILITY_COUNT) {
        setCandidate({ citizenId: streakCitizenId, fullName: streakFullName });
        setPhase('stable-detected');
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    async function loop() {
      while (!cancelled) {
        await pollOnce();
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, POLL_GAP_MS);
        });
      }
    }
    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, workerReady, selectedDeviceId, cameraError]);

  // Kick off scanning once the camera + worker are both ready. Also the
  // reset path after a write error / success / a fresh device pick.
  useEffect(() => {
    if (workerReady && selectedDeviceId && !cameraError && phase === 'initializing') {
      setPhase('scanning');
    }
  }, [workerReady, selectedDeviceId, cameraError, phase]);

  // Stable read detected -> show it briefly -> auto-write. Purely a timer,
  // no operator action required (2026-09-09 product decision: auto-confirm
  // after a stable read, with the number shown for a glance rather than a
  // blocking confirm click).
  useEffect(() => {
    if (phase !== 'stable-detected' || !candidate) return;
    const timer = setTimeout(() => {
      void writeCandidate(candidate);
    }, STABLE_DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, candidate]);

  const writeCandidate = useCallback(async (toWrite: Candidate) => {
    setPhase('writing');
    try {
      const result = await window.cccdScannerAPI.writeScan({
        citizenId: toWrite.citizenId,
        fullName: toWrite.fullName ?? '',
      });
      if (result.ok) {
        setPhase('success');
        setTimeout(() => {
          setCandidate(null);
          setErrorMessage(null);
          setLastAttemptText(null);
          setPhase('scanning');
        }, SUCCESS_DISPLAY_MS);
      } else {
        setErrorMessage(result.error ?? 'Ghi file thất bại');
        setPhase('write-error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('write-error');
    }
  }, []);

  const handleRetryWrite = useCallback(() => {
    if (candidate) void writeCandidate(candidate);
  }, [candidate, writeCandidate]);

  const handleSkipAndRescan = useCallback(() => {
    setCandidate(null);
    setErrorMessage(null);
    setLastAttemptText(null);
    setPhase('scanning');
  }, []);

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Quét CCCD (mặt trước) — tự động</h1>

      <div style={styles.row}>
        <label style={styles.label} htmlFor="camera-select">
          Camera:
        </label>
        <select
          id="camera-select"
          style={styles.select}
          value={selectedDeviceId}
          onChange={(e) => {
            setSelectedDeviceId(e.target.value);
            handleSkipAndRescan();
          }}
        >
          {devices.length === 0 && <option value="">Không tìm thấy camera</option>}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
      </div>

      {cameraError && <div style={styles.errorBanner}>{cameraError}</div>}
      {!workerReady && !cameraError && <div style={styles.status}>Đang khởi tạo bộ nhận dạng...</div>}

      <div style={styles.previewWrap}>
        <video ref={videoRef} autoPlay muted playsInline style={styles.video} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {phase === 'scanning' && workerReady && (
        <div style={styles.status}>
          {lastAttemptText ?? 'Đang quét — đưa mặt trước CCCD vào khung hình...'}
        </div>
      )}

      {phase === 'stable-detected' && candidate && (
        <div style={styles.confirmBox}>
          <div style={styles.confirmLine}>
            Số CCCD nhận dạng được: <strong>{candidate.citizenId}</strong>
          </div>
          {candidate.fullName && (
            <div style={styles.confirmLine}>
              Họ và tên: <strong>{candidate.fullName}</strong>
            </div>
          )}
          <div style={styles.status}>Đang lưu tự động...</div>
        </div>
      )}

      {phase === 'writing' && <div style={styles.status}>Đang lưu...</div>}

      {phase === 'write-error' && (
        <div style={styles.confirmBox}>
          <div style={styles.errorBanner}>Lỗi khi lưu: {errorMessage}</div>
          <div style={styles.buttonRow}>
            <button style={styles.primaryButton} onClick={handleRetryWrite}>
              Thử lưu lại
            </button>
            <button style={styles.secondaryButton} onClick={handleSkipAndRescan}>
              Bỏ qua, quét lại
            </button>
          </div>
        </div>
      )}

      {phase === 'success' && candidate && (
        <div style={styles.successBanner}>
          Đã lưu thành công — {candidate.citizenId}
          {candidate.fullName ? ` (${candidate.fullName})` : ''}
        </div>
      )}
    </div>
  );
}

function describeCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Không có quyền truy cập camera.';
    if (err.name === 'NotFoundError') return 'Không tìm thấy thiết bị camera nào.';
    if (err.name === 'NotReadableError') return 'Camera đang được ứng dụng khác sử dụng.';
    return `Lỗi camera: ${err.name}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    padding: 24,
    maxWidth: 720,
    margin: '0 auto',
    color: '#1a1a1a',
  },
  title: { fontSize: 20, fontWeight: 600, marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  label: { fontWeight: 500 },
  select: { flex: 1, padding: 8, fontSize: 14 },
  previewWrap: {
    background: '#111',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
    aspectRatio: '4 / 3',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: { width: '100%', height: '100%', objectFit: 'contain' },
  primaryButton: {
    padding: '10px 20px',
    fontSize: 16,
    fontWeight: 600,
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '10px 20px',
    fontSize: 16,
    background: '#e5e7eb',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  status: { fontSize: 16, fontStyle: 'italic', color: '#444' },
  confirmBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    background: '#f3f4f6',
    borderRadius: 8,
  },
  confirmLine: { fontSize: 16 },
  buttonRow: { display: 'flex', gap: 12 },
  errorBanner: {
    padding: 12,
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: 6,
    marginBottom: 12,
  },
  successBanner: {
    padding: 16,
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
  },
};
