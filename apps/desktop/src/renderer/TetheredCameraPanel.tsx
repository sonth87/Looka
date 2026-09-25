import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card } from '@face/ui';

interface TetheredCameraStatus {
  connected: boolean;
  model?: string;
  error?: string;
}

/**
 * Live-view polling tuning (2026-09-22 — "khá giật... đảm bảo không làm
 * nóng máy", raised again same day — "tăng lượng request ảnh... tránh làm
 * nóng máy"). Originally each frame was a real `gphoto2 --capture-preview`
 * subprocess spawn + fresh PTP session round trip — inherently variable
 * latency (community-reported <10fps, sometimes multi-second), which WAS
 * the real source of the jitter; no polling-interval tweak here could
 * change that ceiling.
 *
 * 2026-09-23 ("tốc độ từ camera sang màn hiển thị vẫn rất lag" → switched to
 * a continuous `gphoto2 --capture-movie` stream in `tetheredCamera.ts`) —
 * that ceiling is gone. Measured directly against the real R6 Mark II: the
 * background stream delivers a genuinely NEW frame on every single poll at
 * a 250ms pace (confirmed via byte-for-byte frame comparison, not just "no
 * error"), meaning `getTetheredLiveViewFrame()` itself is no longer the
 * bottleneck — this app-side pause is.
 *
 * Pushed down to 60ms same day, then reverted back to 200ms on 2026-09-24
 * ("giật các khung hình khác khi kết nối camera Canon" — the REAL webcams'
 * own preview/CV work started stuttering once Canon was connected and this
 * polled that fast). Root cause: every poll still crosses an Electron IPC
 * round trip and base64-encodes a ~150KB JPEG on the SAME renderer JS
 * thread the real webcams' video rendering and face-detection CV pipeline
 * also run on — during an active session with Canon + real webcams all
 * live at once, 60ms of that work every tick was frequent enough to
 * measurably compete for that thread's time. 200ms was the last value
 * confirmed NOT to cause this (real-hardware tested after the original
 * 1000ms→200ms step, with no contention complaints at the time) — trading
 * back some of the extra smoothness headroom for not starving the other
 * cameras sharing the same thread. The underlying movie-stream fix (no
 * more per-frame gphoto2 spawn) is unaffected by this value either way;
 * only the artificial pause on top of it changed.
 *
 * The poll loop below is self-paced (`await` the request, THEN
 * `setTimeout(poll, delay)`), never overlapping two in-flight requests —
 * the two guards below are what actually prevent hammering a struggling
 * camera, not this base pause:
 *  - back off on repeated failures instead of hammering a struggling
 *    camera at the same fixed rate (`BASE_INTERVAL_MS` doubling up to
 *    `MAX_INTERVAL_MS`, reset to base on the next success);
 *  - refuse to run forever — `MAX_CONTINUOUS_MS` auto-stops live view after
 *    a bounded stretch so an operator who forgets to turn it off doesn't
 *    leave the camera re-negotiating USB and generating preview JPEGs for
 *    an entire kiosk shift.
 *
 * 2026-09-24 later same day (real-hardware field report, this specific
 * kiosk's other camera angles still visibly stuttering once the Canon
 * connected): raised to 350ms as a first guess, believing this same
 * IPC/decode-on-one-thread contention was still the cause.
 *
 * 2026-09-25 (real-hardware retest, "lượng request ảnh... lag, không còn
 * mượt" — the 350ms step made THIS panel's own preview noticeably choppier,
 * which is exactly what slowing a ~3fps poll down further would do):
 * reverted to 200ms. The 2026-09-24 diagnosis above was wrong — a dedicated
 * `/audit` pass found the real cause of the OTHER cameras' flicker was
 * `CameraSetupScreen.tsx`'s `RoleCard` unconditionally reassigning
 * `<video>.srcObject` on every render (any assignment, even to the same
 * `MediaStream`, restarts the browser's media load algorithm) — nothing to
 * do with this poll's rate at all. That reassignment is now guarded
 * (`if (el.srcObject !== wantStream)`), so this interval no longer needs to
 * compensate for a symptom it was never actually causing. 200ms is the
 * value real-hardware testing already confirmed doesn't reintroduce genuine
 * IPC/decode thread contention (see the 2026-09-24 note above it replaced) —
 * going back to it restores the smoother preview without reopening that
 * separate, unrelated risk. Still worth this kiosk's own eyes on both
 * screens after this change, same as every prior step in this history.
 *
 * 2026-09-25 later same day (real-hardware retest, "vẫn giật" — confirmed
 * via the [TEMP-FPS] diagnostic that the underlying gphoto2 movie stream
 * itself was sustaining a clean, stable ~30fps for 40+ seconds once an
 * unrelated camera-connection-state issue was resolved by power-cycling the
 * camera): 200ms only ever pulls a fresh frame 5 times/second from a source
 * that's actually delivering ~30 — most of what the camera sends is thrown
 * away unread, which is a real, separate reason for visible choppiness on
 * top of whatever thread-contention risk this value is tuned against.
 * Raised to 100ms (10fps) as a middle ground: still half the 200ms
 * confirmed-safe value's IPC/decode load per second the CPU-contention
 * concern above is about (100ms ≈ 10 polls/sec vs 200ms's 5/sec, both far
 * short of the 60ms/~16.7fps step that measurably caused contention before),
 * while noticeably smoother than 5fps. Not itself hardware-confirmed at this
 * exact value yet — same "verify on this kiosk's own eyes" caveat as every
 * other step in this history.
 *
 * 2026-09-25 even later same day ("có thể mượt hơn chút nữa không?"): nudged
 * to 70ms (~14fps) — still a real margin above the 60ms/~16.7fps step that
 * was the one CONFIRMED-bad value in this whole history (measured real
 * webcam stutter on this exact screen, which shows multiple real webcam
 * tiles alongside this one).
 *
 * 2026-09-25, explicit user request ("đưa xuống 40-50ms"): lowered to 45ms —
 * BELOW the 60ms value this file's own history confirmed causes real webcam
 * stutter on this screen. Applied as asked, but this crosses a known-risky
 * line on purpose, not a value anyone has verified safe yet; watch the OTHER
 * (non-Canon) camera tiles on THIS screen specifically for stutter, and if
 * it reappears, that is this exact regression coming back. Separately: this
 * interval does NOT affect how much the physical camera itself heats up —
 * the camera streams continuously at its own native rate regardless of how
 * often this code reads a frame from it; reading faster just consumes more
 * of what it is already producing, it does not make the sensor/EVF pipeline
 * work harder. Camera temperature is a real, separate concern this value
 * cannot address — see `getTetheredThermalWarning`/`TETHERED_TEMP_CONFIG_PATH`
 * for the feature actually built for that.
 */
const BASE_INTERVAL_MS = 45;
const MAX_INTERVAL_MS = 8000;
const MAX_CONTINUOUS_MS = 10 * 60_000; // 10 minutes

export function TetheredCameraPanel({
  tetheredStatus,
  tetheredChecking,
  onCheckConnection,
  zadigOpenError,
  onOpenZadig,
  onFrameUpdate,
}: {
  tetheredStatus: TetheredCameraStatus | null;
  tetheredChecking: boolean;
  onCheckConnection: () => void;
  zadigOpenError: string | null;
  onOpenZadig: () => void;
  /**
   * 2026-09-22 real-hardware feedback: CAM 01's role card (CameraSetupScreen)
   * used to show only a static "go check the panel below" placeholder for a
   * tethered camera, with no actual preview — reported back as "vẫn không
   * thể hiển thị được lên cam 01". This panel is the only place that
   * actually polls `getTetheredLiveViewFrame`, so the role card can't get a
   * frame on its own without either running a second, competing poll loop
   * (doubling gphoto2/USB load) or reusing this one's result — this callback
   * bubbles the latest frame (and `null` on stop) up so the parent can feed
   * it to the role card instead, with live view still controlled by the one
   * "Xem live view" toggle here.
   */
  onFrameUpdate?: (dataUrl: string | null) => void;
}) {
  const [tetheredCapturing, setTetheredCapturing] = useState(false);
  const [tetheredCaptureResult, setTetheredCaptureResult] = useState<{
    dataUrl?: string;
    savedPath?: string;
    error?: string;
  } | null>(null);

  const [tetheredLiveViewOn, setTetheredLiveViewOn] = useState(false);
  const [tetheredLiveViewFrame, setTetheredLiveViewFrame] = useState<string | null>(null);
  /**
   * 2026-09-23 ("tôi muốn mô phỏng luồng thật giống khi tôi gắn canon eos")
   * — the bundled simulated fixture is one static JPEG, so the `<img>` tag
   * alone can't prove a poll actually landed vs. just re-showing the same
   * old frame. This is real proof: it ticks on every successful poll
   * (simulated OR real), independent of whether the photo bytes changed.
   */
  const [tetheredLiveViewFrameCount, setTetheredLiveViewFrameCount] = useState(0);
  const [tetheredLiveViewFrameAt, setTetheredLiveViewFrameAt] = useState<number | null>(null);
  const [tetheredLiveViewError, setTetheredLiveViewError] = useState<string | null>(null);
  const [tetheredLiveViewAutoStopped, setTetheredLiveViewAutoStopped] = useState(false);
  const tetheredLiveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive-failure counter (backoff) and the wall-clock moment live
  // view was turned on (idle auto-stop) — both plain refs since neither
  // needs to trigger a render on its own, only the frame/error state does.
  const consecutiveFailuresRef = useRef(0);
  const startedAtRef = useRef(0);

  // Mirrors `tetheredLiveViewOn` but readable without a stale closure from
  // inside the auto-start effect below (see that effect's own doc comment
  // for why it can't just depend on the state value directly).
  const tetheredLiveViewOnRef = useRef(false);

  /**
   * 2026-09-24 fix (audit) — bumped every time a loop is started, stopped, or
   * the component unmounts, so an in-flight `getTetheredLiveViewFrame()`
   * call that resolves AFTER that point can tell it no longer belongs to the
   * current loop. Without this, a poll already in flight when
   * `stopLiveView()` ran (the common case: a request is pending for most of
   * each cycle) still reported its frame via `onFrameUpdate`/
   * `setTetheredLiveViewFrame` — overwriting the `null` `stopLiveView()` had
   * just pushed — and unconditionally rescheduled itself with
   * `setTimeout(poll, delay)`, so the loop never actually stopped. Starting
   * live view again then ran a SECOND, independent loop alongside the
   * orphaned one, doubling the poll rate. The unmount cleanup below had the
   * same gap: it only ever cleared the pending timer, never an in-flight
   * request.
   */
  const tetheredLiveViewGenRef = useRef(0);

  const stopLiveView = () => {
    tetheredLiveViewOnRef.current = false;
    tetheredLiveViewGenRef.current += 1;
    setTetheredLiveViewOn(false);
    if (tetheredLiveViewTimerRef.current) clearTimeout(tetheredLiveViewTimerRef.current);
    tetheredLiveViewTimerRef.current = null;
    onFrameUpdate?.(null);
  };

  const startLiveView = () => {
    tetheredLiveViewOnRef.current = true;
    setTetheredLiveViewOn(true);
    setTetheredLiveViewAutoStopped(false);
    setTetheredLiveViewError(null);
    setTetheredLiveViewFrameCount(0);
    setTetheredLiveViewFrameAt(null);
    consecutiveFailuresRef.current = 0;
    startedAtRef.current = Date.now();
    const gen = ++tetheredLiveViewGenRef.current;

    const poll = async () => {
      if (Date.now() - startedAtRef.current >= MAX_CONTINUOUS_MS) {
        setTetheredLiveViewAutoStopped(true);
        stopLiveView();
        return;
      }
      try {
        const result = await (window as any).faceAPI?.getTetheredLiveViewFrame?.();
        // The loop may have been stopped (button, unmount, or a newer
        // `startLiveView()` call) while that request was in flight — bail
        // out before touching any state or scheduling another poll.
        if (gen !== tetheredLiveViewGenRef.current) return;
        if (result?.ok) {
          setTetheredLiveViewFrame(result.dataUrl);
          setTetheredLiveViewFrameCount((n) => n + 1);
          setTetheredLiveViewFrameAt(Date.now());
          setTetheredLiveViewError(null);
          consecutiveFailuresRef.current = 0;
          onFrameUpdate?.(result.dataUrl);
        } else {
          setTetheredLiveViewError(result?.error ?? 'Không gọi được faceAPI.getTetheredLiveViewFrame');
          consecutiveFailuresRef.current += 1;
        }
      } catch (err) {
        if (gen !== tetheredLiveViewGenRef.current) return;
        setTetheredLiveViewError((err as Error).message);
        consecutiveFailuresRef.current += 1;
      }
      const delay = Math.min(BASE_INTERVAL_MS * 2 ** consecutiveFailuresRef.current, MAX_INTERVAL_MS);
      tetheredLiveViewTimerRef.current = setTimeout(poll, delay);
    };
    void poll();
  };

  const toggleTetheredLiveView = () => {
    if (tetheredLiveViewOn) {
      stopLiveView();
      return;
    }
    startLiveView();
  };

  /**
   * Auto-start (2026-09-23 — "phải bấm xem live mới hiển thị được? có cách
   * nào mặc định không?"): starts the same poll loop as the "Xem live view"
   * button automatically the instant the camera is confirmed connected,
   * mirroring the auto-connect change in CameraSetupScreen.tsx — no manual
   * click needed for the normal case. The button stays as a manual on/off
   * toggle (e.g. to deliberately pause it), and `MAX_CONTINUOUS_MS` still
   * auto-stops it after 10 minutes either way, so a setup window left open
   * unattended doesn't poll forever just because this made it start easier.
   *
   * Deliberately depends on `tetheredStatus?.connected` alone, reading
   * `tetheredLiveViewOnRef` (not `tetheredLiveViewOn` in the deps array) to
   * decide whether to start — if the state value itself were a dependency,
   * `stopLiveView()` flipping it to `false` would immediately re-trigger
   * this effect and restart the poll, making the manual "Tắt live view"
   * button unable to actually turn anything off while still connected.
   */
  useEffect(() => {
    if (tetheredStatus?.connected && !tetheredLiveViewOnRef.current) {
      startLiveView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tetheredStatus?.connected]);

  useEffect(() => {
    return () => {
      // 2026-09-24 fix (audit): also invalidate the generation token (see
      // `tetheredLiveViewGenRef`'s own doc comment) — clearing only the
      // pending timer left an in-flight poll free to resolve after unmount,
      // report a frame, and reschedule itself forever.
      tetheredLiveViewOnRef.current = false;
      tetheredLiveViewGenRef.current += 1;
      if (tetheredLiveViewTimerRef.current) clearTimeout(tetheredLiveViewTimerRef.current);
    };
  }, []);

  /**
   * Thermal warning (2026-09-23 — "có thể lấy được nhiệt độ cam để cảnh báo
   * lên màn hình khi cam quá tải không?"). `getTetheredThermalWarning()`
   * itself is a no-op (`enabled: false`) until `TETHERED_TEMP_CONFIG_PATH`
   * is set — see the config-discovery section below and that function's own
   * doc comment in `tetheredCamera.ts`. Polled independently of the
   * live-view toggle (a 60s cadence is cheap enough to just always run
   * while connected, unlike the live-view frame rate).
   *
   * Battery level (2026-09-25 — "có thể hiển thị phần trăm pin của máy ảnh
   * lên giao diện để dễ theo dõi không?") is read in the SAME tick as
   * thermal, not a second independent `setInterval` — each read is its own
   * `gphoto2 --get-config` call that stops and restarts the live-view movie
   * stream (`withCameraLock`, see `tetheredCamera.ts`), a disruption
   * already flagged once this session for the thermal poll alone; a
   * separate battery timer running on its own cadence would double that
   * same cost independently of this fix, for no real benefit since both are
   * "cheap enough at low frequency" the same way.
   */
  const [thermalWarning, setThermalWarning] = useState<{
    enabled: boolean;
    warning: boolean;
    raw?: string;
    error?: string;
  } | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<{
    enabled: boolean;
    percent?: number;
    raw?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!tetheredStatus?.connected) {
      setThermalWarning(null);
      setBatteryLevel(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const HEALTH_POLL_MS = 60_000;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await (window as any).faceAPI?.getTetheredThermalWarning?.();
        if (!cancelled) setThermalWarning(result ?? null);
      } catch {
        // Best-effort only — a failed thermal check must never block or
        // affect anything else on this screen.
      }
      if (cancelled) return;
      try {
        const result = await (window as any).faceAPI?.getTetheredBatteryLevel?.();
        if (!cancelled) setBatteryLevel(result ?? null);
      } catch {
        // Same best-effort tolerance as thermal above.
      }
      if (!cancelled) timer = setTimeout(poll, HEALTH_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tetheredStatus?.connected]);

  /**
   * Config discovery (2026-09-23) — nobody has confirmed what, if anything,
   * the real R6 Mark II exposes for thermal status, so this lists whatever
   * `gphoto2 --list-config` actually returns and lets the operator click
   * through to a value, instead of this app guessing a property name ahead
   * of real hardware. See `tetheredCamera.ts`'s doc comment above
   * `listTetheredCameraConfig` for the full reasoning.
   */
  const [configOpen, setConfigOpen] = useState(false);
  const [configPaths, setConfigPaths] = useState<string[] | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configFilter, setConfigFilter] = useState('temp');
  const [selectedConfigPath, setSelectedConfigPath] = useState<string | null>(null);
  const [selectedConfigValue, setSelectedConfigValue] = useState<string | null>(null);
  const [selectedConfigError, setSelectedConfigError] = useState<string | null>(null);
  const [selectedConfigLoading, setSelectedConfigLoading] = useState(false);
  /** Write-side counterpart, 2026-09-25 ("setup manual focus camera") — see `setTetheredCameraConfigValue`'s own doc comment for why this reuses the same discovery flow instead of a guessed value. */
  const [newConfigValue, setNewConfigValue] = useState('');
  const [applyConfigLoading, setApplyConfigLoading] = useState(false);
  const [applyConfigError, setApplyConfigError] = useState<string | null>(null);
  const [applyConfigSuccess, setApplyConfigSuccess] = useState(false);

  const loadConfigList = async () => {
    setConfigLoading(true);
    setConfigError(null);
    setConfigPaths(null);
    try {
      const result = await (window as any).faceAPI?.listTetheredCameraConfig?.();
      if (result?.ok) setConfigPaths(result.paths);
      else setConfigError(result?.error ?? 'Không gọi được faceAPI.listTetheredCameraConfig');
    } catch (err) {
      setConfigError((err as Error).message);
    } finally {
      setConfigLoading(false);
    }
  };

  const loadConfigValue = async (configPath: string) => {
    setSelectedConfigPath(configPath);
    setSelectedConfigLoading(true);
    setSelectedConfigError(null);
    setSelectedConfigValue(null);
    setNewConfigValue('');
    setApplyConfigError(null);
    setApplyConfigSuccess(false);
    try {
      const result = await (window as any).faceAPI?.getTetheredCameraConfigValue?.(configPath);
      if (result?.ok) setSelectedConfigValue(result.value);
      else setSelectedConfigError(result?.error ?? 'Không gọi được faceAPI.getTetheredCameraConfigValue');
    } catch (err) {
      setSelectedConfigError((err as Error).message);
    } finally {
      setSelectedConfigLoading(false);
    }
  };

  const submitConfigValue = async () => {
    if (!selectedConfigPath || !newConfigValue.trim()) return;
    setApplyConfigLoading(true);
    setApplyConfigError(null);
    setApplyConfigSuccess(false);
    try {
      const result = await (window as any).faceAPI?.setTetheredCameraConfigValue?.(
        selectedConfigPath,
        newConfigValue.trim()
      );
      if (result?.ok) {
        // Re-reads the real value back from the camera rather than trusting
        // what was typed — some properties silently clamp/round an
        // out-of-range value instead of erroring, so the displayed "Current"
        // line must reflect what the camera actually applied. Done BEFORE
        // flagging success below: `loadConfigValue` itself resets
        // `applyConfigSuccess`/`newConfigValue` (it doubles as the "just
        // selected a fresh path" reset), so setting success first would be
        // wiped out the instant this refresh runs.
        await loadConfigValue(selectedConfigPath);
        setApplyConfigSuccess(true);
      } else {
        setApplyConfigError(result?.error ?? 'Không gọi được faceAPI.setTetheredCameraConfigValue');
      }
    } catch (err) {
      setApplyConfigError((err as Error).message);
    } finally {
      setApplyConfigLoading(false);
    }
  };

  const filteredConfigPaths =
    configPaths?.filter(
      (p) => configFilter.trim() === '' || p.toLowerCase().includes(configFilter.trim().toLowerCase())
    ) ?? null;

  /** Bước 0/3 — "Chụp thử" button: real shutter trigger + download, shown inline, NOT saved anywhere (pure connectivity test, no session/outbox involved). */
  const captureTetheredTest = async () => {
    setTetheredCapturing(true);
    setTetheredCaptureResult(null);
    try {
      // `saveDebugCopy: true` (2026-09-24 fix, confirmed audit finding): only
      // this test button opts into the main process's Desktop debug-copy
      // write — a real session capture (`FaceCaptureApp.tsx`) omits it, so
      // it no longer leaves a copy of every student's photo on the Desktop.
      const result = await (window as any).faceAPI?.captureTetheredPhoto?.({ saveDebugCopy: true });
      if (result?.ok) setTetheredCaptureResult({ dataUrl: result.dataUrl, savedPath: result.savedPath });
      else setTetheredCaptureResult({ error: result?.error ?? 'Không gọi được faceAPI.captureTetheredPhoto' });
    } catch (err) {
      setTetheredCaptureResult({ error: (err as Error).message });
    } finally {
      setTetheredCapturing(false);
    }
  };

  /**
   * 2026-09-23 ("mục này để lên đầu và khi nào cam không hiển thị thì mới
   * cho action không thì để dropdown") — now that connect + live view both
   * auto-start (see the two doc comments above), the manual action row
   * (Kiểm tra kết nối / Chụp thử / Tắt live view / Cài driver WinUSB) is
   * only actually needed for TROUBLESHOOTING: the happy path just shows the
   * badge + live frame with no button clutter. `hasProblem` FORCES the
   * section open — a manual collapse can never hide a real, current error —
   * `manuallyOpened` only ever ADDS visibility on top of that, e.g. to
   * press "Chụp thử" on demand even though everything already looks fine.
   */
  const hasProblem =
    !tetheredStatus?.connected ||
    !!tetheredStatus?.error ||
    !!tetheredLiveViewError ||
    !!tetheredCaptureResult?.error ||
    !!zadigOpenError;
  const [manuallyOpened, setManuallyOpened] = useState(false);
  const actionsOpen = hasProblem || manuallyOpened;

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold tracking-wide text-kiosk-text-muted mb-3">
        MÁY ẢNH QUA DÂY (GPHOTO2)
      </h2>
      <Card className="p-4 space-y-3">
        {tetheredStatus && (
          <Badge variant={tetheredStatus.connected ? 'success' : 'warning'}>
            {tetheredStatus.connected ? `Đã kết nối${tetheredStatus.model ? ` — ${tetheredStatus.model}` : ''}` : 'Chưa kết nối'}
          </Badge>
        )}

        {/* Battery level (2026-09-25) — only shown once TETHERED_BATTERY_CONFIG_PATH is set and a real reading comes back; see the poll effect's own doc comment for why this stays hidden rather than guessing. `percent` may be absent even when `enabled` if the camera reports an enum (e.g. "High"/"Low") instead of a number — the raw text still shows in that case so it's not just silently blank. */}
        {batteryLevel?.enabled && (batteryLevel.percent !== undefined || batteryLevel.raw) && (
          <Badge variant={batteryLevel.percent !== undefined && batteryLevel.percent <= 20 ? 'warning' : 'neutral'}>
            Pin: {batteryLevel.percent !== undefined ? `${batteryLevel.percent}%` : batteryLevel.raw}
          </Badge>
        )}

        {thermalWarning?.enabled && thermalWarning.warning && (
          <div className="p-3 rounded-xl bg-kiosk-danger/10 border border-kiosk-danger/30 text-kiosk-danger text-sm">
            ⚠️ Máy ảnh có thể đang quá nhiệt — giá trị cấu hình đọc được: {thermalWarning.raw?.trim() || '(?)'}
          </div>
        )}
        {thermalWarning?.enabled && !thermalWarning.warning && thermalWarning.error && (
          <p className="text-xs text-kiosk-text-muted">
            Không đọc được cảnh báo nhiệt độ (TETHERED_TEMP_CONFIG_PATH có thể sai đường dẫn): {thermalWarning.error}
          </p>
        )}

        <button
          type="button"
          onClick={() => setManuallyOpened((v) => !v)}
          className="text-xs text-kiosk-text-muted hover:text-kiosk-text"
        >
          {actionsOpen ? '▾' : '▸'} Thao tác thủ công (kiểm tra kết nối / chụp thử / live view)
        </button>
        {actionsOpen && (
          <div className="space-y-3">
            <p className="text-xs text-kiosk-text-muted">
              Bảng kiểm tra thủ công cho Bước 0 của kế hoạch tethered-capture — không lưu gì vào phiên chụp thật, chỉ
              để xác nhận gphoto2 nói chuyện được với máy ảnh trước khi gán nó cho một vai trò ở trên.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={onCheckConnection} disabled={tetheredChecking}>
                {tetheredChecking ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void captureTetheredTest()}
                disabled={tetheredCapturing || !tetheredStatus?.connected}
              >
                {tetheredCapturing ? 'Đang chụp...' : 'Chụp thử'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleTetheredLiveView}
                disabled={!tetheredStatus?.connected && !tetheredLiveViewOn}
              >
                {tetheredLiveViewOn ? 'Tắt live view' : 'Xem live view'}
              </Button>
              {tetheredStatus && !tetheredStatus.connected && (
                <Button type="button" variant="outline" size="sm" onClick={onOpenZadig}>
                  Cài driver WinUSB (mở Zadig)
                </Button>
              )}
            </div>

            {tetheredStatus && !tetheredStatus.connected && tetheredStatus.error && (
              <p className="text-xs text-kiosk-danger">{tetheredStatus.error}</p>
            )}
            {tetheredStatus && !tetheredStatus.connected && (
              <p className="text-xs text-kiosk-text-muted">
                Chưa nhận máy? Bấm "Cài driver WinUSB" ở trên — trong Zadig, bật <strong>Options → List All Devices</strong>
                , chọn đúng camera (có thể cần cài cho cả 2 interface nếu máy hiện ra 2 dòng), driver đích để{' '}
                <strong>WinUSB</strong>, rồi bấm Install/Replace Driver. Sau đó bấm lại "Kiểm tra kết nối".
              </p>
            )}
            {zadigOpenError && <p className="text-xs text-kiosk-danger">Mở Zadig lỗi: {zadigOpenError}</p>}

            {tetheredCaptureResult?.error && <p className="text-xs text-kiosk-danger">Chụp thử lỗi: {tetheredCaptureResult.error}</p>}
            {tetheredLiveViewError && <p className="text-xs text-kiosk-danger">Live view lỗi: {tetheredLiveViewError}</p>}
            {tetheredLiveViewAutoStopped && (
              <p className="text-xs text-kiosk-text-muted">
                Đã tự tắt live view sau {Math.round(MAX_CONTINUOUS_MS / 60_000)} phút để tránh camera phải hoạt động liên
                tục quá lâu — bấm "Xem live view" lại nếu cần tiếp tục.
              </p>
            )}
          </div>
        )}

        {(tetheredCaptureResult?.dataUrl || tetheredLiveViewFrame) && (
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {tetheredCaptureResult?.dataUrl && (
              <div>
                <p className="text-xs text-kiosk-text-muted mb-1">Ảnh chụp thử</p>
                <img src={tetheredCaptureResult.dataUrl} alt="Ảnh chụp thử từ máy ảnh qua dây" className="w-full rounded-lg border border-kiosk-border" />
                {tetheredCaptureResult.savedPath && (
                  <p className="text-xs text-kiosk-text-muted mt-1 break-all">Đã lưu: {tetheredCaptureResult.savedPath}</p>
                )}
              </div>
            )}
            {tetheredLiveViewFrame && (
              <div>
                <p className="text-xs text-kiosk-text-muted mb-1">
                  Live view (khung mới nhất)
                  {tetheredLiveViewFrameAt && (
                    <>
                      {' — khung #'}
                      {tetheredLiveViewFrameCount}
                      {', cập nhật lúc '}
                      {new Date(tetheredLiveViewFrameAt).toLocaleTimeString('vi-VN')}
                    </>
                  )}
                </p>
                {/* 2026-09-25 ("chưa được làm nét... khá mờ") — gphoto2's live-view frame is the camera's own EVF/preview resolution, well below full sensor resolution; this is a hardware/protocol ceiling (see tetheredCanvasStream.ts's own doc comment for the same limit), not something CSS can truly fix. `contrast` is a purely cosmetic perceived-sharpness boost — it adds no real detail, just makes existing edges read a bit crisper to the eye. */}
                <img
                  src={tetheredLiveViewFrame}
                  alt="Khung live view từ máy ảnh qua dây"
                  className="w-full rounded-lg border border-kiosk-border"
                  style={{ filter: 'contrast(1.15)' }}
                />
              </div>
            )}
          </div>
        )}

        <div className="border-t border-kiosk-border pt-3 mt-1">
          <button
            type="button"
            onClick={() => setConfigOpen((v) => !v)}
            className="text-xs text-kiosk-text-muted hover:text-kiosk-text"
          >
            {configOpen ? '▾' : '▸'} Chẩn đoán cấu hình máy ảnh (tìm mục nhiệt độ)
          </button>
          {configOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-kiosk-text-muted">
                Chưa xác nhận máy ảnh có mục nhiệt độ hay không. Bấm "Liệt kê cấu hình" để xem toàn bộ danh sách
                gphoto2 cung cấp, lọc theo từ khoá bên dưới để tìm nhanh, rồi bấm vào một dòng để xem giá trị hiện
                tại của nó.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadConfigList()}
                  disabled={configLoading || !tetheredStatus?.connected}
                >
                  {configLoading ? 'Đang liệt kê...' : 'Liệt kê cấu hình'}
                </Button>
                <input
                  type="text"
                  value={configFilter}
                  onChange={(e) => setConfigFilter(e.target.value)}
                  placeholder="Lọc theo từ khoá (vd: temp, heat)"
                  className="text-xs bg-kiosk-bg border border-kiosk-border rounded-lg px-2 py-1 text-kiosk-text"
                />
              </div>
              {configError && <p className="text-xs text-kiosk-danger">{configError}</p>}
              {filteredConfigPaths && (
                <div className="max-h-40 overflow-y-auto border border-kiosk-border rounded-lg divide-y divide-kiosk-border">
                  {filteredConfigPaths.length === 0 && (
                    <p className="text-xs text-kiosk-text-muted p-2">Không có dòng nào khớp từ khoá lọc.</p>
                  )}
                  {filteredConfigPaths.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void loadConfigValue(p)}
                      className={`block w-full text-left text-xs px-2 py-1 hover:bg-kiosk-bg ${
                        selectedConfigPath === p ? 'bg-kiosk-bg font-semibold' : ''
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
              {selectedConfigPath && (
                <div className="text-xs bg-kiosk-bg border border-kiosk-border rounded-lg p-2">
                  <p className="text-kiosk-text-muted mb-1 break-all">{selectedConfigPath}</p>
                  {selectedConfigLoading && <p>Đang đọc...</p>}
                  {selectedConfigError && <p className="text-kiosk-danger">{selectedConfigError}</p>}
                  {selectedConfigValue && <pre className="whitespace-pre-wrap break-all">{selectedConfigValue}</pre>}
                  {/*
                    Write side (2026-09-25, "setup manual focus camera") —
                    only shown once a real value/Choices list has loaded, so
                    whatever gets typed here is copied from what the camera
                    itself just advertised, not guessed.
                  */}
                  {selectedConfigValue && (
                    <div className="mt-2 pt-2 border-t border-kiosk-border flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={newConfigValue}
                        onChange={(e) => {
                          setNewConfigValue(e.target.value);
                          setApplyConfigSuccess(false);
                        }}
                        placeholder="Giá trị mới (copy từ Choices ở trên)"
                        className="text-xs bg-kiosk-bg border border-kiosk-border rounded-lg px-2 py-1 text-kiosk-text flex-1 min-w-[160px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void submitConfigValue()}
                        disabled={applyConfigLoading || !newConfigValue.trim()}
                      >
                        {applyConfigLoading ? 'Đang đặt...' : 'Đặt giá trị'}
                      </Button>
                      {applyConfigError && <p className="text-kiosk-danger w-full">{applyConfigError}</p>}
                      {applyConfigSuccess && (
                        <Badge variant="success" className="w-full justify-center">
                          Đã đặt thành công — giá trị hiện tại đã cập nhật ở trên
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-kiosk-text-muted">
                Tìm được mục đúng? Báo lại đường dẫn (vd. <code>/main/status/tempstatus</code>) và giá trị khi máy
                nóng để bật cảnh báo tự động — chỉ cần set biến môi trường{' '}
                <code>TETHERED_TEMP_CONFIG_PATH</code>, không cần code thêm.
              </p>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
