/**
 * Builds a `MediaStream` from the tethered Canon's live-view feed so it can
 * be recorded with the SAME `MediaRecorder`-based pipeline every webcam
 * channel already uses (FaceCaptureApp.tsx's multi-channel recording
 * effect) — 2026-09-24, "record for Canon" feature.
 *
 * gphoto2 has no native "record to file" mode (see `tetheredCamera.ts`'s own
 * doc comments — `--capture-movie` only ever feeds this app's live-view
 * preview, one JPEG at a time, nothing is muxed into a video container). So
 * this is deliberately NOT real camera-sensor video: it is the exact same
 * JPEG live-view frames the preview thumbnail already shows, redrawn onto an
 * offscreen `<canvas>` on a timer and captured as a stream via the standard
 * `canvas.captureStream()` API — the same mechanism any "record this canvas"
 * feature uses, applied here to a feed of still images instead of an
 * animation/game loop.
 *
 * Deliberately NOT verified against real hardware — there was no Canon
 * connected in this environment when this was written, matching every other
 * "Bước 0" honesty note already in `tetheredCamera.ts`. The mechanism itself
 * is sound and spec-compliant, but the actual fps/quality/CPU cost on a real
 * kiosk has not been measured — needs a real capture session to confirm
 * before relying on this in production. `pollIntervalMs`/`frameRate` below
 * are a reasonable starting guess, not a measured value.
 *
 * Frame rate is capped low on purpose: each frame is a full IPC round-trip
 * (`getTetheredLiveViewFrame`, see `tetheredCamera.ts`) plus a JPEG decode
 * via `Image.onload`. Pushing this faster than the underlying live-view
 * stream can actually deliver new frames would just waste CPU/IPC redrawing
 * a stale frame. The result is real video, but a choppier one than a native
 * webcam feed — there is no way around that with gphoto2 as the only channel
 * to the camera (community reports and this project's own plan doc both
 * note gphoto2's live-view path is structurally capped well under a real
 * webcam's frame rate).
 */

export interface TetheredCanvasStreamOptions {
  /** How often to pull a fresh frame and redraw the canvas. Default 150ms (~6.7fps) — see this file's own header comment for why not faster. */
  pollIntervalMs?: number;
  /** `canvas.captureStream(frameRate)` — kept close to `pollIntervalMs`'s own rate; no point capturing faster than frames actually change. */
  frameRate?: number;
  /** Fallback canvas size used only until the first real frame loads and reports its own natural dimensions — not a guess meant to stick. */
  fallbackWidth?: number;
  fallbackHeight?: number;
}

export interface TetheredCanvasStreamHandle {
  /** Feed this into `new MediaRecorder(stream)` exactly like a real `getUserMedia` stream. */
  stream: MediaStream;
  /** Stops the poll loop and every track on `stream`. Idempotent. */
  stop: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_FRAME_RATE = 6;
const DEFAULT_FALLBACK_WIDTH = 1280;
const DEFAULT_FALLBACK_HEIGHT = 720;

/**
 * `getFrameDataUrl` is whatever the caller's own IPC bridge exposes for a
 * single tethered frame (`faceAPI.getTetheredLiveViewFrame()` in
 * FaceCaptureApp.tsx) — kept generic here so this module has no dependency
 * on the Electron preload surface and stays unit-testable with a plain fake
 * function, the same "gate logic separated from the effect" split
 * `recordingGate.ts`/`recordingLiveness.ts` already use.
 *
 * Throws synchronously if a 2D canvas context can't be obtained, so a caller
 * building this inside the same `try`/`catch` a real `getUserMedia` call
 * already sits in (see the multi-channel recording effect) treats the two
 * failure modes identically — a canvas that silently never draws would
 * otherwise still emit a steady stream of blank frames, which the recorder's
 * own liveness monitor cannot tell apart from a genuinely working feed
 * (bytes keep flowing either way).
 */
/** Bound on how long channel creation waits for the FIRST real frame before giving up — see the 2026-09-24 fix note below. */
const FIRST_FRAME_TIMEOUT_MS = 8000;

export async function createTetheredCanvasStream(
  getFrameDataUrl: () => Promise<string>,
  options: TetheredCanvasStreamOptions = {}
): Promise<TetheredCanvasStreamHandle> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const frameRate = options.frameRate ?? DEFAULT_FRAME_RATE;

  const canvas = document.createElement('canvas');
  canvas.width = options.fallbackWidth ?? DEFAULT_FALLBACK_WIDTH;
  canvas.height = options.fallbackHeight ?? DEFAULT_FALLBACK_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Không tạo được canvas 2D để ghi hình từ Canon (tethered)');
  }

  let stopped = false;
  // Guards against a slow frame (IPC round-trip + JPEG decode together
  // taking longer than `pollIntervalMs`) overlapping with the next tick's
  // own draw — the same single-flight instinct `ensureMovieStream()` already
  // uses on the main-process side of this feature, just here for the
  // renderer's own poll loop.
  let drawing = false;
  /**
   * 2026-09-24 fix (confirmed audit finding — recorder-restart corruption):
   * the last successfully-decoded frame, redrawn on every interval tick
   * regardless of whether `tick()`'s own fetch is still pending or just
   * failed (see `redrawLastGood` below). `ctx.drawImage` is what actually
   * makes Chromium's `canvas.captureStream()` emit a new frame — a canvas
   * left untouched for longer than `MediaRecorder`'s liveness window
   * produces a real gap in the recorded bytes, not just a frozen-looking
   * picture, and every tethered still capture (`withCameraLock` in
   * `tetheredCamera.ts`) tears down and respawns Canon live view for
   * several seconds, which is exactly long enough to hit that gap. The
   * recording-liveness monitor (`recordingLiveness.ts`, consumed from
   * FaceCaptureApp.tsx) then restarts the `MediaRecorder` mid-session,
   * which produces a corrupted file (two concatenated WebM streams). Simply
   * redrawing the same still frame keeps the encoder fed through that gap
   * instead.
   */
  let lastGoodImage: HTMLImageElement | null = null;

  const redrawLastGood = (): void => {
    if (stopped || !lastGoodImage) return;
    ctx.drawImage(lastGoodImage, 0, 0, canvas.width, canvas.height);
  };

  const tick = async (): Promise<void> => {
    if (stopped || drawing) return;
    drawing = true;
    try {
      const dataUrl = await getFrameDataUrl();
      if (stopped) return;
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Không giải mã được khung hình live view'));
        img.src = dataUrl;
      });
      if (stopped) return;
      // Resized only once real dimensions are known — the fallback size
      // above is a placeholder, not a guess meant to stick.
      if (
        img.naturalWidth &&
        img.naturalHeight &&
        (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight)
      ) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      lastGoodImage = img;
    } catch {
      // A single missed/undecodable frame is not fatal — same tolerance the
      // live-view preview poll (`useTetheredPreview` in FaceCaptureApp.tsx)
      // already has for a transiently-busy camera. `redrawLastGood()` below
      // keeps the canvas (and so the recorder) fed with the last good frame
      // in the meantime; the next tick just tries fetching a fresh one again.
      //
      // Known gap, not fixed here: a Canon that disconnects or jams for good
      // mid-recording still just produces a FROZEN video, not a stalled/
      // no-data one, once at least one frame was ever drawn — detecting that
      // properly would need a consecutive-failure counter here that feeds
      // back into the caller's own `recordingFailed` state, left out of this
      // pass since it can't be tuned without a real camera to fail against
      // on purpose.
    } finally {
      drawing = false;
    }
  };

  // 2026-09-24 fix (confirmed audit finding): this function used to be
  // synchronous and always returned a handle immediately, no matter what
  // `getFrameDataUrl()` did — `tick()`'s own errors are caught and swallowed
  // internally (see its `catch` above) so they never reached this function's
  // caller. The caller's own doc comment claimed a disconnected/busy Canon
  // "fails this channel ... into this same `catch`", which was never
  // actually true: a dead Canon silently produced a channel that recorded a
  // blank canvas and got queued for upload like a real video. Awaiting the
  // very first frame here, with a bounded timeout, makes that claim true —
  // channel creation now genuinely fails (this function rejects) when the
  // Canon cannot deliver a first frame in time, so the caller's existing
  // per-channel `catch` marks it failed instead of recording nothing.
  const firstFrameOk = await Promise.race([
    tick().then(() => lastGoodImage !== null),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FIRST_FRAME_TIMEOUT_MS)),
  ]);
  if (!firstFrameOk) {
    // Nothing has been started yet at this point (no interval, no
    // `captureStream()`) — marking `stopped` is enough to make a `tick()`
    // that is still in flight (the timeout branch above won the race) a
    // no-op once it does resolve, instead of resurrecting this canvas.
    stopped = true;
    throw new Error('Không lấy được khung hình đầu tiên từ Canon (tethered) để bắt đầu ghi hình');
  }

  const stream = canvas.captureStream(frameRate);
  const intervalId = setInterval(() => {
    // Unconditional redraw first — keeps the encoder fed every tick even
    // while `tick()`'s own fetch below is still pending (e.g. mid-capture-
    // lock) or about to fail; `tick()` then overwrites it with a genuinely
    // fresh frame once/if one actually arrives.
    redrawLastGood();
    void tick();
  }, pollIntervalMs);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(intervalId);
    stream.getTracks().forEach((t) => t.stop());
  };

  return { stream, stop };
}
