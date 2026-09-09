import { useCallback, useEffect, useRef, useState } from 'react';
import { recognizeCccdFrame } from './ocr.js';

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
 * Flow: pick the phone's bridged camera (Iriun/DroidCam/etc. — it just shows
 * up as a normal Windows camera device) -> live preview -> capture a frame
 * -> OCR it -> operator confirms the recognized 12-digit number on screen
 * (never auto-written — see the product brief's own safety rationale: a
 * misread digit that still happens to form a well-formed 12-digit number
 * could silently mismatch the wrong card to the wrong session) -> write
 * response.json -> back to live preview for the next student.
 */

type Phase = 'preview' | 'recognizing' | 'confirm' | 'no-match' | 'writing' | 'write-error' | 'success';

interface Candidate {
  citizenId: string;
  fullName: string | null;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('preview');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');

    setPhase('recognizing');
    try {
      const result = await recognizeCccdFrame(dataUrl);
      if (result.citizenId) {
        setCandidate({ citizenId: result.citizenId, fullName: result.fullName });
        setPhase('confirm');
      } else {
        setPhase('no-match');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('no-match');
    }
  }, []);

  const handleRetake = useCallback(() => {
    setCandidate(null);
    setErrorMessage(null);
    setPhase('preview');
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!candidate) return;
    setPhase('writing');
    try {
      const result = await window.cccdScannerAPI.writeScan({
        citizenId: candidate.citizenId,
        fullName: candidate.fullName ?? '',
      });
      if (result.ok) {
        setPhase('success');
        setTimeout(() => {
          setCandidate(null);
          setPhase('preview');
        }, 2000);
      } else {
        setErrorMessage(result.error ?? 'Ghi file thất bại');
        setPhase('write-error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('write-error');
    }
  }, [candidate]);

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Quét CCCD (mặt trước)</h1>

      <div style={styles.row}>
        <label style={styles.label} htmlFor="camera-select">
          Camera:
        </label>
        <select
          id="camera-select"
          style={styles.select}
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
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

      <div style={styles.previewWrap}>
        <video ref={videoRef} autoPlay muted playsInline style={styles.video} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {phase === 'preview' && (
        <button style={styles.primaryButton} onClick={() => void handleCapture()} disabled={!selectedDeviceId}>
          Chụp
        </button>
      )}

      {phase === 'recognizing' && <div style={styles.status}>Đang nhận dạng...</div>}

      {phase === 'confirm' && candidate && (
        <div style={styles.confirmBox}>
          <div style={styles.confirmLine}>
            Số CCCD nhận dạng được: <strong>{candidate.citizenId}</strong>
          </div>
          {candidate.fullName && (
            <div style={styles.confirmLine}>
              Họ và tên: <strong>{candidate.fullName}</strong>
            </div>
          )}
          <div style={styles.buttonRow}>
            <button style={styles.primaryButton} onClick={() => void handleConfirm()}>
              Xác nhận
            </button>
            <button style={styles.secondaryButton} onClick={handleRetake}>
              Chụp lại
            </button>
          </div>
        </div>
      )}

      {phase === 'no-match' && (
        <div style={styles.confirmBox}>
          <div style={styles.errorBanner}>
            Không đọc được số CCCD, thử lại{errorMessage ? ` (${errorMessage})` : ''}
          </div>
          <button style={styles.primaryButton} onClick={handleRetake}>
            Thử lại
          </button>
        </div>
      )}

      {phase === 'writing' && <div style={styles.status}>Đang lưu...</div>}

      {phase === 'write-error' && (
        <div style={styles.confirmBox}>
          <div style={styles.errorBanner}>Lỗi khi lưu: {errorMessage}</div>
          <div style={styles.buttonRow}>
            <button style={styles.primaryButton} onClick={() => void handleConfirm()}>
              Thử lưu lại
            </button>
            <button style={styles.secondaryButton} onClick={handleRetake}>
              Chụp lại
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
