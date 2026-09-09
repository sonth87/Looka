import { useEffect, useRef, useState } from 'react';
import type { Worker } from 'tesseract.js';
import { createCccdWorker, recognizeWithWorker } from '../../lib/cccdOcr.js';

/**
 * Pre-session "quét thẻ CCCD" overlay (2026-09-09) — the kiosk's full
 * replacement for `StudentIdEntryScreen`'s manual "nhập mã sinh viên" form,
 * per the product decision that CCCD scanning replaces manual entry
 * outright rather than the two coexisting (see `FaceCaptureApp.tsx`'s own
 * doc comment on `handleCccdScan` for why `StudentIdEntryScreen` itself is
 * kept, unmodified, for the non-kiosk/legacy path that has no scanner
 * attached — `apps/web`).
 *
 * No form here: there is nothing for the operator to submit manually — the
 * scanning corner below (`ScanMonitorCorner`) does its own continuous OCR
 * and, once it gets a stable read, asks the kiosk's main process whether
 * that citizen id matches anyone in the external student roster (see
 * `onScanResult`'s own doc comment). 2026-09-09 architecture correction:
 * this used to write the OCR result to `response.json` (on the wrong
 * assumption that file was a per-scan write target the main process's
 * `cccdWatcher.ts` then read back) — it is now a read-only lookup, with no
 * file write of any kind from this app.
 *
 * The wrapper below is `pointer-events-none` (only the two islands inside
 * it — the status card and the scan-monitor corner — are
 * `pointer-events-auto`) — clicks elsewhere fall through to whatever the
 * underlying capture view renders, INCLUDING its "Bắt đầu"/"Màn hình mở
 * rộng"/"Cài đặt camera" controls. That's deliberate, not an oversight
 * (2026-09-09, reverted from a brief attempt at blocking the whole
 * overlay): the toolbar controls must stay reachable at any time regardless
 * of identification state (operator/admin controls, not student-facing),
 * and "Bắt đầu" starting a session before a student is identified is
 * prevented at the function level instead — see `handleStartWorkflow`'s own
 * `fromIdentification` doc comment in `FaceCaptureApp.tsx` — so blocking
 * clicks here was never actually necessary for that, and blocking the
 * toolbar along with it was collateral damage worth avoiding.
 */
export interface CccdScanWaitingScreenProps {
  /** True while a scanned CCCD is being looked up against the roster, or during the post-FOUND greeting wait — same "form stays disabled" meaning `StudentIdEntryScreen.submitting` already has. */
  submitting: boolean;
  /** Set by the caller on a NOT_FOUND roster match (or a lookup failure); cleared on the next scan attempt. */
  error: string | null;
  /** Forwarded straight through to `ScanMonitorCorner` — see that component's own `onScanResult` doc comment. */
  onScanResult: (result: CccdRosterLookupResult) => void;
}

export function CccdScanWaitingScreen({ submitting, error, onScanResult }: CccdScanWaitingScreenProps) {
  return (
    <div className="absolute inset-0 z-[150] flex flex-col items-center justify-end pb-16 px-8 text-center pointer-events-none">
      <ScanMonitorCorner paused={submitting} onScanResult={onScanResult} />
      <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-950/70 backdrop-blur-md px-6 py-6 shadow-2xl">
        <span className="text-4xl">🪪</span>
        <h2 className="text-xl font-semibold">Quét thẻ căn cước công dân</h2>
        <p className="text-sm text-slate-300">
          {submitting ? 'Đang kiểm tra thông tin...' : 'Vui lòng đưa thẻ CCCD vào đầu đọc để bắt đầu phiên chụp.'}
        </p>
        {submitting && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500" />
          </div>
        )}
        {error && (
          <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const SCAN_MONITOR_DEVICE_ID_KEY = 'looka.cccdScanMonitor.deviceId';

/** Same floor as `apps/cccd-scanner`'s own scan loop — see that app's `App.tsx` doc comment for why 2 (not 1, not more) is the right number. */
const STABILITY_COUNT = 2;
/** How long a stable read stays visible before the roster lookup fires — an operator glance-check, not a blocking gate. */
const STABLE_DISPLAY_MS = 1200;
/** How long the found/not-found flash stays up before the corner resumes scanning for the next student. */
const SUCCESS_DISPLAY_MS = 1800;
/** Gap between OCR polls once a frame finishes processing. */
const POLL_GAP_MS = 300;

type ScanPhase = 'idle' | 'initializing' | 'scanning' | 'stable' | 'checking' | 'check-error' | 'found' | 'not-found';

/** One roster record's display-relevant fields — mirrors `apps/desktop/src/main/cccdRoster.ts`'s `RosterRecord` (the duplicate-the-IPC-payload-shape convention every `faceAPI` caller in this package already follows, since this package cannot import apps/desktop's own types). */
export interface CccdRosterLookupRecord {
  identityNumber: string;
  studentCode: string | null;
  fullName: string | null;
  className: string | null;
  majorName: string | null;
  courseYear: string | null;
}

/**
 * `faceAPI.lookupCccdByIdentityNumber`'s result, handed straight up to
 * `FaceCaptureApp.tsx` via `onScanResult` — `found: false` is a normal,
 * expected outcome (the scanned citizen id simply isn't anywhere in the
 * roster), never an error. The corner's own job stops here: it does not
 * decide what a match or a non-match MEANS (greeting, session start, the
 * "không có trong dữ liệu" message) — that stays in `FaceCaptureApp.tsx`,
 * same as it already owns that decision for the manual "nhập mã sinh viên"
 * path.
 */
export type CccdRosterLookupResult = { found: true; record: CccdRosterLookupRecord } | { found: false };

/**
 * Bottom-right "watch what the CCCD scan sees" corner — 2026-09-09, folding
 * the standalone `apps/cccd-scanner` app's own continuous-scan flow directly
 * into the kiosk ("cccd scanner sẽ là góc nhỏ bên phải rồi nên không cần mở
 * 1 tab nữa" — the operator's own framing). Same architecture as that app's
 * `App.tsx`: a long-lived Tesseract worker, a poll loop that captures a
 * frame from the live `<video>`, runs the two-pass OCR, and only acts once
 * the SAME 12-digit number has been read `STABILITY_COUNT` times in a row —
 * see `cccdOcr.ts`'s `extractCitizenId` doc comment for why a single frame
 * is never trusted alone. Entirely independent of the kiosk's own
 * capture-camera streams (a different physical device — the phone bridged
 * via Camo/Iriun/DroidCam — and a separate `getUserMedia` call).
 *
 * Once stable, this asks the main process's in-memory roster cache whether
 * the number matches anyone (`faceAPI.lookupCccdByIdentityNumber` —
 * 2026-09-09 architecture correction, replacing a `writeCccdScanResult`
 * file-write call this same day) and reports the result up via
 * `onScanResult` — this component owns "get a stable number, ask if it
 * matches, report back" only, the same "camera + OCR only" scope it already
 * had; it never touches greeting/session-start/error-message logic itself.
 *
 * `paused` (true while the parent's own handling of a previous result —
 * greeting, session start — is still in flight, i.e. `submitting`) stops
 * the scan loop without tearing down the camera stream or the OCR worker —
 * resuming is then just "start polling again", not "reopen everything from
 * scratch", so the corner doesn't visibly flicker/reset between one
 * student's scan and the next.
 */
function ScanMonitorCorner({
  paused,
  onScanResult,
}: {
  paused: boolean;
  onScanResult: (result: CccdRosterLookupResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);

  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [stableResult, setStableResult] = useState<{ citizenId: string; fullName: string | null } | null>(null);

  // Enumerate once, restoring the operator's last pick if it's still a
  // connected device — labels only populate post-permission.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        if (cancelled) return;
        const cams = all.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        const saved = localStorage.getItem(SCAN_MONITOR_DEVICE_ID_KEY);
        if (saved && cams.some((d) => d.deviceId === saved)) {
          setSelectedDeviceId(saved);
        }
      })
      .catch(() => {
        /* no camera permission granted anywhere yet — picker just stays empty until the operator opens it and grants one via the browser's own prompt */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Opens/closes the camera stream as the operator's device pick changes.
  useEffect(() => {
    if (!selectedDeviceId) return;
    let cancelled = false;
    setCameraError(null);
    setPhase('initializing');

    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: selectedDeviceId } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        navigator.mediaDevices.enumerateDevices().then((all) => {
          if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setCameraError(err instanceof Error ? err.message : String(err));
          setPhase('idle');
        }
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [selectedDeviceId]);

  // One long-lived Tesseract worker for the life of this corner — see
  // `cccdOcr.ts`'s own doc comment on why continuous polling needs this
  // instead of a create-per-frame worker.
  useEffect(() => {
    if (!selectedDeviceId) return;
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
      setWorkerReady(false);
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) void worker.terminate();
    };
  }, [selectedDeviceId]);

  // Kick off scanning once camera + worker are both ready, and whenever an
  // in-flight roster lookup (`paused`) finishes.
  useEffect(() => {
    if (!paused && workerReady && selectedDeviceId && !cameraError && (phase === 'initializing' || phase === 'idle')) {
      setPhase('scanning');
    }
    if (paused && phase === 'scanning') setPhase('initializing'); // parked, not torn down — see this component's own doc comment
  }, [paused, workerReady, selectedDeviceId, cameraError, phase]);

  // The continuous poll loop itself.
  useEffect(() => {
    if (phase !== 'scanning') return;
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
      } catch {
        return; // a one-off OCR hiccup — skip this poll, try again next tick
      }
      if (cancelled) return;

      if (!result.citizenId) {
        streak = 0;
        streakCitizenId = null;
        streakFullName = null;
        setStatusText('Đang tìm số CCCD...');
        return;
      }

      if (result.citizenId === streakCitizenId) {
        streak += 1;
      } else {
        streak = 1;
        streakCitizenId = result.citizenId;
      }
      streakFullName = result.fullName ?? streakFullName;
      setStatusText(`Đang đọc: ${result.citizenId} (${streak}/${STABILITY_COUNT})`);

      if (streak >= STABILITY_COUNT) {
        setStableResult({ citizenId: streakCitizenId, fullName: streakFullName });
        setPhase('stable');
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
  }, [phase]);

  // Stable read -> brief glance window -> roster lookup. Same "auto-confirm
  // after a stable read, shown briefly for a glance, not a blocking tap"
  // product decision as `apps/cccd-scanner` itself already made — only the
  // step after the glance window changed (a lookup, not a file write).
  useEffect(() => {
    if (phase !== 'stable' || !stableResult) return;
    const citizenId = stableResult.citizenId;
    const timer = setTimeout(() => {
      setPhase('checking');
      const faceAPI = (window as any).faceAPI;
      const lookup = faceAPI?.lookupCccdByIdentityNumber;
      if (!lookup) {
        // Web build, or no bridge — nothing to check against here; go back
        // to scanning rather than getting stuck. This component is only
        // ever mounted on the kiosk build in practice (see
        // `FaceCaptureApp.tsx`'s own render gate), so this is defensive,
        // not an expected path.
        setPhase('scanning');
        return;
      }
      lookup({ identityNumber: citizenId })
        .then((result: CccdRosterLookupResult) => {
          onScanResult(result);
          setPhase(result.found ? 'found' : 'not-found');
          setTimeout(() => {
            setStableResult(null);
            setStatusText(null);
            setPhase('scanning');
          }, SUCCESS_DISPLAY_MS);
        })
        .catch((err: unknown) => {
          setStatusText(err instanceof Error ? err.message : String(err));
          setPhase('check-error');
        });
    }, STABLE_DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stableResult]);

  function retryAfterCheckError() {
    setStableResult(null);
    setStatusText(null);
    setPhase('scanning');
  }

  function choose(deviceId: string) {
    setSelectedDeviceId(deviceId);
    setPickerOpen(false);
    setStableResult(null);
    setStatusText(null);
    if (deviceId) localStorage.setItem(SCAN_MONITOR_DEVICE_ID_KEY, deviceId);
    else localStorage.removeItem(SCAN_MONITOR_DEVICE_ID_KEY);
  }

  return (
    <div className="pointer-events-auto absolute bottom-6 right-6 flex flex-col items-end gap-1.5">
      {pickerOpen && (
        <div className="w-56 rounded-xl border border-slate-700/60 bg-slate-950/90 backdrop-blur-md p-2 shadow-xl">
          <p className="px-1 pb-1 text-[11px] font-medium text-slate-400">Camera quét CCCD</p>
          <button
            type="button"
            onClick={() => choose('')}
            className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${
              !selectedDeviceId ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Tắt
          </button>
          {devices.map((d, i) => (
            <button
              key={d.deviceId}
              type="button"
              onClick={() => choose(d.deviceId)}
              className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${
                selectedDeviceId === d.deviceId ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {d.label || `Camera ${i + 1}`}
            </button>
          ))}
          {devices.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-500">Không tìm thấy camera nào.</p>}
        </div>
      )}

      <div className="relative w-44 aspect-video overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950/90 shadow-xl">
        {selectedDeviceId && !cameraError ? (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center">
            <span className="text-lg">📷</span>
            <span className="text-[10px] text-slate-500">
              {cameraError ? 'Không mở được camera' : 'Chưa chọn camera quét'}
            </span>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />

        {phase === 'stable' && stableResult && (
          <div className="absolute inset-x-0 bottom-0 bg-sky-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white">
            {stableResult.citizenId}
          </div>
        )}
        {phase === 'checking' && (
          <div className="absolute inset-x-0 bottom-0 bg-slate-900/90 px-2 py-1 text-center text-[10px] text-slate-200">
            Đang kiểm tra...
          </div>
        )}
        {phase === 'found' && (
          <div className="absolute inset-x-0 bottom-0 bg-emerald-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white">
            Đã tìm thấy ✓
          </div>
        )}
        {phase === 'not-found' && (
          <div className="absolute inset-x-0 bottom-0 bg-amber-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white">
            Không có trong danh sách
          </div>
        )}
        {phase === 'check-error' && (
          <button
            type="button"
            onClick={retryAfterCheckError}
            className="absolute inset-x-0 bottom-0 bg-rose-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white"
          >
            Lỗi kiểm tra — chạm để quét lại
          </button>
        )}
        {phase === 'scanning' && !stableResult && (
          <div className="absolute inset-x-0 bottom-0 truncate bg-slate-950/80 px-2 py-1 text-center text-[10px] text-slate-300">
            {statusText ?? 'Đang quét...'}
          </div>
        )}

        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="absolute top-1 right-1 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
        >
          Chọn cam
        </button>
      </div>
    </div>
  );
}
