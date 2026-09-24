/**
 * Tethered Canon capture via `gphoto2` (subprocess, not a native addon) —
 * docs/plans/canon-tethered-capture-plan-2026-09-21.md, Bước 1-3. This is
 * the foundational connectivity layer only: detect the camera, pull one
 * live-view frame, trigger a real shutter release and download the file.
 * Wiring a tethered camera into an actual capture SESSION's round logic
 * (`FaceCaptureApp.tsx`/`multiFrame.ts`) is a separate, later phase — see
 * the plan's own "Bước 0 trước, code sâu sau" reasoning: this repo has no
 * real Canon EOS R6 Mark II/III connected to verify against, so this layer
 * is deliberately scoped to what the Camera Setup screen's own test button
 * needs (Bước 0's hands-on verification), not the full session pipeline.
 *
 * `gphoto2 --auto-detect`/`--capture-preview`/`--capture-image-and-download`
 * flag names and `--auto-detect`'s two-column output shape are gphoto2's
 * own documented CLI (http://www.gphoto.org/doc/manual/), not verified
 * against the real R6 Mark II/III here — flagged in the plan's Bước 0 as
 * something to confirm on real hardware, same honesty rule as the rest of
 * that document.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { createBackoff } from './backoff.js';

const DETECT_TIMEOUT_MS = 10_000;
const LIVEVIEW_TIMEOUT_MS = 5_000;
const CAPTURE_TIMEOUT_MS = 30_000;

/**
 * Synthetic device id for the tethered Canon, same string every renderer
 * file already duplicates locally (`FaceCaptureApp.tsx`, `CampaignGate.tsx`,
 * `CameraSetupScreen.tsx`, `CbHelpFrames.tsx` — cross-process/package
 * boundaries make sharing one constant with those impractical). Within
 * `apps/desktop/src/main` there's no such boundary, so this is the one
 * canonical copy for main-process code — `index.ts`/`tetheredCameraWatcher.ts`
 * import it from here instead of adding a fifth duplicate.
 */
export const TETHERED_DEVICE_ID = 'tethered:gphoto2';

/**
 * Resolution order, no env var/PATH edit required for the common case:
 * 1. `GPHOTO2_BIN` override — same `process.env` escape-hatch pattern as
 *    `aiService.ts`'s `AI_SERVICE_BASE_URL`, for pointing at an unusual
 *    location without touching source or PATH.
 * 2. Packaged build: the bundled copy at `resources/gphoto2/gphoto2.exe`
 *    (Bước 6 — `electron-builder.json`'s `extraResources`).
 * 3. Dev mode: `apps/desktop/resources/gphoto2-win/gphoto2.exe` — the SAME
 *    folder Bước 6 packages from (see that folder's own README). Dropping
 *    the real binaries there makes both dev and packaged builds "just
 *    work" from the one place, with nothing to configure.
 * 4. Last resort: bare `gphoto2`, relies on it being on PATH.
 */
function gphoto2BinaryPath(): string {
  const override = process.env.GPHOTO2_BIN?.trim();
  if (override) return override;
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'gphoto2', 'gphoto2.exe');
  }
  // __dirname here is `apps/desktop/dist/main` (tsconfig.electron.json's
  // outDir) — up two levels reaches `apps/desktop`, matching every other
  // dev/packaged dual-path lookup already in this codebase (e.g.
  // `recentStudentsWindow.ts`'s own `path.join(__dirname, '../...')` use).
  const devLocal = path.join(__dirname, '../../resources/gphoto2-win/gphoto2.exe');
  if (existsSync(devLocal)) return devLocal;
  return 'gphoto2';
}

/**
 * Same dev/packaged dual-path resolution as `gphoto2BinaryPath()` above,
 * for the bundled official Zadig (see `resources/zadig-win/README.md` for
 * why it's Zadig and not a self-built `wdi-simple.exe` — Memory Integrity
 * rejects an unsigned driver package, and Zadig's official release carries
 * a real, valid Authenticode signature that doesn't hit that wall).
 */
function zadigBinaryPath(): string | undefined {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'zadig', 'zadig.exe');
    return existsSync(packaged) ? packaged : undefined;
  }
  const devLocal = path.join(__dirname, '../../resources/zadig-win/zadig.exe');
  return existsSync(devLocal) ? devLocal : undefined;
}

/**
 * Launches the bundled Zadig so the WinUSB driver step can be done without
 * leaving the app or finding Zadig online separately — the app folder is
 * meant to be fully self-contained once downloaded (2026-09-22: "chỉ có
 * app desktop được down về thì có thể sử dụng kết nối"). Zadig itself has
 * no command-line/scripting interface (checked its own source — no argv
 * parsing at all), so this can only OPEN the tool, not drive it: the
 * operator still has to tick "Options → List All Devices", pick the right
 * camera interface, and click Install/Replace Driver by hand, same as
 * every other Zadig use in this project so far. `shell.openPath` (not
 * `child_process.spawn`) so Windows' own "open this .exe" handling —
 * including the UAC prompt Zadig triggers when it actually installs — runs
 * exactly as if the operator double-clicked it in Explorer.
 */
export async function openZadig(): Promise<{ ok: boolean; error?: string }> {
  const bin = zadigBinaryPath();
  if (!bin) {
    return { ok: false, error: 'Không tìm thấy zadig.exe đã đóng gói cùng app (resources/zadig-win/)' };
  }
  const err = await shell.openPath(bin);
  return err ? { ok: false, error: err } : { ok: true };
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * libgphoto2 loads its camera-driver plugins (`CAMLIBS`) and I/O
 * transport plugins (`IOLIBS`) from a directory baked in at COMPILE time —
 * pointing at wherever the original MSYS2 build was compiled, not wherever
 * this app's copy of `gphoto2.exe` actually lives. Without overriding
 * these two env vars, a `gphoto2.exe` copied out of MSYS2 (exactly what
 * Bước 6's packaging — and `scripts/setup-gphoto2-windows.ps1` — does)
 * silently finds zero camera drivers: `--auto-detect` reports nothing even
 * with a fully supported camera plugged in. A real trap, not a
 * hypothetical one, so this is handled here rather than left for Bước 0
 * to rediscover the hard way.
 *
 * `setup-gphoto2-windows.ps1` copies MSYS2's `mingw64/lib/libgphoto2/` and
 * `mingw64/lib/libgphoto2_port/` folders (each holding one
 * version-numbered subfolder with the actual plugin DLLs) next to
 * `gphoto2.exe`. This looks for that exact layout and points `CAMLIBS`/
 * `IOLIBS` straight at the version subfolder. Returns `{}` (no override)
 * when that layout isn't found — e.g. a `GPHOTO2_BIN` override pointing at
 * some other, already-configured gphoto2 install is never second-guessed.
 */
function resolvePluginEnv(binPath: string): Record<string, string> {
  const binDir = path.dirname(binPath);
  const env: Record<string, string> = {};

  const findVersionSubdir = (parent: string): string | undefined => {
    if (!existsSync(parent)) return undefined;
    const sub = readdirSync(parent, { withFileTypes: true }).find((e) => e.isDirectory());
    return sub ? path.join(parent, sub.name) : undefined;
  };

  const camlibs = findVersionSubdir(path.join(binDir, 'libgphoto2'));
  if (camlibs) env.CAMLIBS = camlibs;
  const iolibs = findVersionSubdir(path.join(binDir, 'libgphoto2_port'));
  if (iolibs) env.IOLIBS = iolibs;

  return env;
}

/** Spawns `gphoto2` with a hard timeout — a hung/unresponsive camera must never hang the caller forever (kiosk-robustness rule, plan Bước 5). */
function runGphoto2(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const bin = gphoto2BinaryPath();
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, env: { ...process.env, ...resolvePluginEnv(bin) } });
    } catch (err) {
      reject(new Error(`Không khởi động được gphoto2 (${bin}): ${(err as Error).message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`gphoto2 không phản hồi sau ${timeoutMs}ms (${args.join(' ')})`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Không khởi động được gphoto2 (${bin}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

interface BinaryRunResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

/**
 * Same shape as `runGphoto2`, except stdout is collected as raw `Buffer`
 * chunks instead of being decoded as UTF-8 text — required for any command
 * whose stdout IS the actual image bytes (`--stdout`, see
 * `captureViaStdout`'s own doc comment for why this replaced the original
 * `--filename` temp-file approach). Decoding binary JPEG data through
 * `chunk.toString('utf8')` the way `runGphoto2` does for text output would
 * corrupt it — invalid UTF-8 byte sequences get silently replaced.
 */
function runGphoto2Binary(args: string[], timeoutMs: number): Promise<BinaryRunResult> {
  return new Promise((resolve, reject) => {
    const bin = gphoto2BinaryPath();
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, env: { ...process.env, ...resolvePluginEnv(bin) } });
    } catch (err) {
      reject(new Error(`Không khởi động được gphoto2 (${bin}): ${(err as Error).message}`));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`gphoto2 không phản hồi sau ${timeoutMs}ms (${args.join(' ')})`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Không khởi động được gphoto2 (${bin}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr, code });
    });
  });
}

export interface TetheredCameraStatus {
  connected: boolean;
  model?: string;
  error?: string;
}

/**
 * `gphoto2` talks to the camera over a single USB/PTP session — it cannot
 * run two operations against the same physical camera at once. The Camera
 * Setup test panel's live-view polling loop and its "Chụp thử" button both
 * call into this module independently, and real testing (2026-09-21/22)
 * showed exactly what you'd expect when they overlap: the live-view poll
 * in flight and a capture request racing each other, one of them (usually
 * the capture) getting stuck as "Đang chụp..." indefinitely or surfacing a
 * raw `*** Error (-7: 'I/O problem') ***` from gphoto2 itself. This is not
 * just a test-panel annoyance — the eventual real capture-session pipeline
 * WILL have live view showing when the operator presses capture, so this
 * has to be handled correctly, not avoided by "don't do both at once."
 * Every exported entry point below funnels through this queue so gphoto2
 * invocations against the camera are strictly serialized, regardless of
 * which two callers overlap in time. A failure in one queued call must
 * never wedge the queue for callers after it — `cameraQueue` itself always
 * resolves to `undefined`, swallowing the specific call's own
 * resolution/rejection, which is instead forwarded to that call's own
 * caller via `queued`.
 *
 * 2026-09-23 addition — `stopMovieStreamAndWait()` runs before every queued
 * `fn`: the continuous `--capture-movie` live-view stream (see that
 * section's own doc comment further down) is a LONG-RUNNING process that
 * holds the PTP session for as long as it's alive, unlike every other
 * one-shot command here. Without this, `getTetheredLiveViewFrame()` starting
 * that stream would return immediately (the queue would see its own call as
 * "done") while the camera stayed busy in the background, so a `capture` or
 * `detect` queued right after it would race the still-running stream for
 * the same USB/PTP session instead of waiting for it.
 */
let cameraQueue: Promise<void> = Promise.resolve();
function withCameraLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    await stopMovieStreamAndWait();
    return fn();
  };
  const queued = cameraQueue.then(run, run);
  cameraQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

/**
 * `gphoto2 --auto-detect` prints a 2-column table (model, USB port), e.g.:
 * ```
 * Model                          Port
 * ----------------------------------------------------------
 * Canon EOS R6 Mark II           usb:001,004
 * ```
 * Parsed by finding the data row via its `usb:` column rather than by a
 * fixed header line count, so this stays correct even if gphoto2 changes
 * header wording/spacing across versions.
 */
export async function detectTetheredCamera(): Promise<TetheredCameraStatus> {
  return withCameraLock(async () => {
    try {
      const { stdout, stderr, code } = await runGphoto2(['--auto-detect'], DETECT_TIMEOUT_MS);
      if (code !== 0) {
        return { connected: false, error: stderr.trim() || `gphoto2 thoát với mã lỗi ${code}` };
      }
      const dataLine = stdout.split(/\r?\n/).find((line) => /usb:/i.test(line));
      if (!dataLine) {
        return { connected: false, error: 'Không tìm thấy máy ảnh nào đang cắm (gphoto2 --auto-detect rỗng)' };
      }
      const match = /^(.*?)\s+usb:\S*/i.exec(dataLine);
      const model = match?.[1]?.trim();
      return { connected: true, model: model || undefined };
    } catch (err) {
      return { connected: false, error: (err as Error).message };
    }
  });
}

/**
 * Thermal warning (2026-09-23 — "có thể lấy được nhiệt độ cam để cảnh báo
 * lên màn hình khi cam quá tải không?"). Whether the R6 Mark II exposes
 * anything thermal-related over PTP at all — and under what config path,
 * and what a "hot" value looks like — is NOT known and can't be verified
 * without the real camera connected (this project's own established
 * practice: hands-on `gphoto2` verification before building deep logic,
 * same as every other real-hardware quirk documented in this file). Rather
 * than guess a property name and silently do nothing (or worse, always
 * report "not overheating" for a camera that IS), this ships the discovery
 * tool: `--list-config` is a core, guaranteed-supported gphoto2 command for
 * any camera it talks to at all, so `listTetheredCameraConfig()` always
 * works today and lets a human (or a later pass here) find the real
 * property name by eye — likely worth grepping the result for "temp",
 * "heat", or "warn". `getTetheredCameraConfigValue()` then reads one
 * specific path once that name is known. Neither function is itself "the
 * temperature reading" — see `TetheredCameraPanel.tsx`'s config-discovery
 * section for how these surface in the UI.
 */
export async function listTetheredCameraConfig(): Promise<string[]> {
  return withCameraLock(async () => {
    const { stdout, stderr, code } = await runGphoto2(['--list-config'], DETECT_TIMEOUT_MS);
    if (code !== 0) {
      throw new Error(stderr.trim() || `gphoto2 thoát với mã lỗi ${code}`);
    }
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  });
}

/** `gphoto2 --get-config <path>` — `configPath` must be one of the exact strings `listTetheredCameraConfig()` returned. Passed as its own `spawn` argv entry (never shell-interpolated), so an unexpected/malformed path is just a gphoto2 "unknown config" error, not a command-injection risk. */
export async function getTetheredCameraConfigValue(configPath: string): Promise<string> {
  return withCameraLock(async () => {
    const { stdout, stderr, code } = await runGphoto2(['--get-config', configPath], DETECT_TIMEOUT_MS);
    if (code !== 0) {
      throw new Error(stderr.trim() || `gphoto2 thoát với mã lỗi ${code}`);
    }
    return stdout;
  });
}

export interface TetheredThermalWarning {
  /** False when `TETHERED_TEMP_CONFIG_PATH` isn't set — the panel hides the banner entirely rather than showing a perpetual "unknown" state. */
  enabled: boolean;
  warning: boolean;
  /** Raw `getTetheredCameraConfigValue()` text, shown in the banner so the operator can see exactly what tripped it. */
  raw?: string;
  error?: string;
}

/**
 * Polled-on-demand thermal check, parametrized entirely by env vars instead
 * of a hardcoded property name — see this file's "Thermal warning" doc
 * comment above `listTetheredCameraConfig` for why: nobody has confirmed
 * what (if anything) the real R6 Mark II exposes yet. Once
 * `TetheredCameraPanel.tsx`'s config-discovery UI finds the real path,
 * turning this on is just setting `TETHERED_TEMP_CONFIG_PATH` (and
 * optionally `TETHERED_TEMP_WARN_KEYWORDS`, comma-separated, case-
 * insensitive substring match against the fetched value — default covers
 * the obvious English words a RADIO/status property's `Current:` line
 * would plausibly contain) — no further coding needed. Left unset, this
 * stays a no-op (`enabled: false`) and adds zero extra camera load for
 * anyone who hasn't gone through the discovery step.
 */
const TEMP_CONFIG_PATH = process.env.TETHERED_TEMP_CONFIG_PATH?.trim();
const TEMP_WARN_KEYWORDS = (process.env.TETHERED_TEMP_WARN_KEYWORDS ?? 'warning,critical,high,hot,error')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export async function getTetheredThermalWarning(): Promise<TetheredThermalWarning> {
  if (!TEMP_CONFIG_PATH) return { enabled: false, warning: false };
  try {
    const raw = await getTetheredCameraConfigValue(TEMP_CONFIG_PATH);
    const lower = raw.toLowerCase();
    const warning = TEMP_WARN_KEYWORDS.some((kw) => lower.includes(kw));
    return { enabled: true, warning, raw };
  } catch (err) {
    // Fails closed on a read error — don't turn on a scary red banner just
    // because one poll couldn't reach the camera (e.g. mid-capture, USB
    // lock contention); the error is still surfaced so it isn't silently
    // swallowed, just not conflated with an actual thermal warning.
    return { enabled: true, warning: false, error: (err as Error).message };
  }
}

/**
 * Streams the captured/downloaded file straight over gphoto2's own stdout
 * (`--stdout`) instead of round-tripping through a `--filename <path>` temp
 * file — the ORIGINAL approach here, before real hardware was available to
 * test against. Real R6 Mark II testing (2026-09-21) found `--filename`
 * with a Windows absolute path (`D:\...`) actively broken: gphoto2 prefixes
 * its OWN "thumb_" marker onto the full path string rather than just the
 * basename (producing a garbled `thumb_D:\...` "path"), then its internal
 * rename-to-requested-name step fails with "Invalid argument" — silently,
 * with exit code 0, so the wrapper had no way to detect it short of the
 * caller's `fs.readFile` hitting ENOENT. `--stdout` sidesteps the whole
 * path/rename dance. Must be read as a raw `Buffer` (`runGphoto2Binary`,
 * not `runGphoto2`) — decoding as UTF-8 text corrupts binary JPEG bytes.
 *
 * `fixWindowsStdoutTextModeCorruption` — a SECOND, independent real-hardware
 * find (2026-09-21, same day, after the `--stdout` switch above): the
 * gphoto2.exe Windows/MinGW build never puts its own stdout file handle
 * into binary mode, so the C runtime's default TEXT-mode translation
 * silently turns every literal `0x0A` byte in the binary JPEG stream into
 * `0x0D 0x0A` on the way out — a real captured photo (6000×4000, confirmed
 * via `sharp().metadata()`) came back byte-for-byte unopenable (Windows
 * Photos: "format currently unsupported, or the file is corrupted"; sharp:
 * "Corrupt JPEG data: 21 extraneous bytes before marker") until this exact
 * corruption was undone. This is the precise, provable inverse: Windows
 * text-mode translation ONLY ever inserts a `0x0D` immediately before an
 * `0x0A` it is about to write — it never touches a `0x0D` that isn't
 * followed by `0x0A`, and if the original binary genuinely contained a real
 * `0x0D 0x0A` pair, translation would have inserted an EXTRA `0x0D` before
 * it (`0x0D 0x0D 0x0A`), so a single left-to-right "drop one 0x0D right
 * before each 0x0A" pass restores the original bytes exactly either way.
 * Verified empirically: stripping restored a perfectly valid, correctly-
 * sized JPEG with intact real EXIF (Canon EOS R6m2, real capture
 * timestamp). This is a workaround for an upstream gphoto2-on-Windows gap
 * (missing `_setmode(_fileno(stdout), _O_BINARY)` equivalent in its own
 * build), not something fixable from this codebase — applied here instead
 * of patching/recompiling gphoto2 itself.
 */
function fixWindowsStdoutTextModeCorruption(buf: Buffer): Buffer {
  const fixed = Buffer.alloc(buf.length);
  let w = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
      continue; // drop the spurious inserted 0x0D; the 0x0A itself is copied on the next iteration
    }
    fixed[w++] = buf[i];
  }
  return fixed.subarray(0, w);
}

/**
 * `MIN_PLAUSIBLE_JPEG_BYTES` (2026-09-23, found via real-hardware testing
 * while validating the movie-stream change above): gphoto2 can exit `0`
 * with a completely EMPTY stdout — no error, no bytes — observed directly
 * a few times in a row while the camera was still settling from heavy
 * back-to-back test traffic, then succeeded again once it had a moment to
 * rest. Without this check, `captureTetheredPhoto()` would have silently
 * returned a 0-byte "photo" as if it were a real capture — for a real
 * student session, that's not a harmless test hiccup, it's a lost/corrupt
 * photo nobody would notice until review. `captureViaStdout` is now used
 * solely by `captureTetheredPhoto` (live view moved to the movie-stream
 * mechanism above and no longer calls this) — a real full-resolution
 * capture is multiple MB, so 10KB is generously below any legitimate
 * output while still well above a truly empty/garbage response.
 * Intentionally does NOT retry (see `captureTetheredPhoto`'s own doc
 * comment on why auto-retrying a real shutter release is unsafe) — it just
 * surfaces a clear, honest error instead of a silent false success.
 */
const MIN_PLAUSIBLE_JPEG_BYTES = 10_000;

/** Wrapped in `withCameraLock` — shared by both exported capture functions below, see that helper's own doc comment for why. */
async function captureViaStdout(args: string[], timeoutMs: number): Promise<Buffer> {
  return withCameraLock(async () => {
    const { code, stdout, stderr } = await runGphoto2Binary([...args, '--stdout'], timeoutMs);
    if (code !== 0) {
      throw new Error(stderr.trim() || `gphoto2 thoát với mã lỗi ${code}`);
    }
    const fixed = fixWindowsStdoutTextModeCorruption(stdout);
    if (fixed.length < MIN_PLAUSIBLE_JPEG_BYTES) {
      throw new Error(
        `gphoto2 thoát bình thường nhưng không trả về ảnh thật (chỉ ${fixed.length} byte) — máy ảnh có thể chưa sẵn sàng, thử lại.`
      );
    }
    // 2026-09-24 fix (confirmed audit finding): the doc comment on
    // `captureTetheredPhoto` below has always assumed the camera body is set
    // to save JPEG, not RAW — nothing actually enforced that. A RAW/CR3
    // capture is well over `MAX_PHOTO_BYTES` (apps/api's 12 MiB server
    // limit) and is not a real JPEG at all, so downstream re-encoding
    // (preload's `mirrorDataUrlHorizontally`) cannot decode it either and
    // falls back to sending those raw, oversized, mislabeled bytes as-is —
    // a guaranteed permanent upload failure discovered only much later, well
    // after the operator already approved the session. Checking the JPEG
    // SOI marker (`FFD8`) here fails the capture immediately with a clear,
    // actionable error instead.
    if (fixed[0] !== 0xff || fixed[1] !== 0xd8) {
      throw new Error(
        'Ảnh trả về không phải định dạng JPEG (máy ảnh có thể đang lưu ở chế độ RAW) — kiểm tra lại cài đặt chất lượng ảnh trên máy ảnh.'
      );
    }
    return fixed;
  });
}

/** Plan Bước 3 — real shutter trigger + download. Camera should be configured to save JPEG (not RAW) so this slots straight into the existing card/AI pipeline with no conversion step. */
export async function captureTetheredPhoto(): Promise<Buffer> {
  return captureViaStdout(['--capture-image-and-download'], CAPTURE_TIMEOUT_MS);
}

/**
 * Continuous live-view streaming via `gphoto2 --capture-movie --stdout`
 * (2026-09-23 — "tốc độ từ camera sang màn hiển thị vẫn rất lag, tăng tốc
 * độ cho tôi"). The ORIGINAL design below (`captureViaStdout(['--capture-
 * preview'])`) paid a full gphoto2 process spawn + fresh PTP session
 * negotiation for EVERY single frame — measured directly against the real
 * R6 Mark II, that per-frame setup/teardown cost was the actual bottleneck,
 * not the frame capture itself: one continuous `--capture-movie` session
 * delivered 89 frames in 3.5s (~25fps) vs. the old design's realistic
 * 1-3fps. `--capture-movie` (no count/duration argument — confirmed on real
 * hardware to run until killed, "Press Ctrl-C to abort") keeps ONE PTP
 * session open and streams frames continuously through it instead.
 *
 * Same Windows stdout text-mode corruption `fixWindowsStdoutTextModeCorruption`
 * documents for the single-frame path affects this stream too (confirmed on
 * real hardware: a raw extracted frame failed to decode; the exact same fix
 * restored a clean, valid JPEG). Applied per-frame, AFTER splitting on
 * FFD8/FFD9 boundaries — the corruption only INSERTS bytes, never
 * removes/alters the two-byte marker sequences themselves, so boundary-
 * scanning the raw (uncorrected) stream first is safe; confirmed
 * empirically on a real 3.5s capture (89/89 frames found cleanly, zero
 * gap bytes between consecutive frames).
 *
 * The stream is a shared, lazily-started singleton (`movieStream`) — every
 * caller of `getTetheredLiveViewFrame()`, across however many renderer
 * windows are polling it, reads the same background process's latest
 * decoded frame instead of each starting its own. `ensureMovieStream()`'s
 * single-flight guard (`movieStreamStarting`) stops two concurrent callers
 * from racing to spawn two competing gphoto2 processes when nothing is
 * running yet.
 */
const MOVIE_IDLE_STOP_MS = 5_000;
const MOVIE_FRAME_STALE_MS = 4_000;
const MOVIE_BUFFER_MAX_BYTES = 4_000_000;

interface MovieStream {
  child: ChildProcess;
  buffer: Buffer;
  latestFrame: Buffer | null;
  latestFrameAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  error: string | null;
  /**
   * 2026-09-24 fix (confirmed audit finding): set by `stopMovieStreamAndWait`
   * right before it kills this process on purpose (every `withCameraLock`
   * call — i.e. every real capture/detect/config — does this). Without it,
   * the `close` handler's "never produced a real frame" backoff logic could
   * not tell a genuinely absent camera apart from a live-view stream WE just
   * killed to make room for a capture, so a shutter release taken before the
   * stream had delivered its very first frame yet started the same
   * multi-second cooldown as "no camera plugged in" — freezing the preview
   * and starving the new tethered-recording canvas (see
   * `tetheredCanvasStream.ts`) for that whole window even though the camera
   * was working fine.
   */
  intentionalStop: boolean;
}

let movieStream: MovieStream | null = null;
let movieStreamStarting: Promise<MovieStream> | null = null;

/**
 * 2026-09-24 fix (docs/plans/canon-auto-detect-polling-plan-2026-09-24.md
 * Bước 5, real-log finding): before this, a stream that failed to ever
 * deliver a frame (no camera plugged in) got retried on the very next
 * `ensureMovieStream()` call with zero delay — every live-view poll tick
 * (every 60-200ms) spawned a brand new `gphoto2.exe` process, observed
 * directly in a real run's log as 47 back-to-back start/close cycles with
 * no camera connected. `movieStreamRetryAt` gates new spawns behind a
 * growing cooldown; `MOVIE_STREAM_RETRY_BASE_MS`/`MAX_MS` deliberately
 * shorter than the watcher's own 3s/30s (this is the live-view path, which
 * a caller is actively waiting on — the operator should see a fast retry
 * once the camera actually appears, not wait as long as the background
 * connection watcher).
 */
const MOVIE_STREAM_RETRY_BASE_MS = 2_000;
const MOVIE_STREAM_RETRY_MAX_MS = 15_000;
const movieStreamBackoff = createBackoff(MOVIE_STREAM_RETRY_BASE_MS, MOVIE_STREAM_RETRY_MAX_MS);
let movieStreamRetryAt = 0;

/** Scans for one complete JPEG (`FFD8...FFD9`) at the very START of `buf` — returns `[frame, rest]` or `null` if `buf` doesn't begin with a full frame yet (still accumulating, or between frames with no leading garbage — real testing found none). */
function extractLeadingFrame(buf: Buffer): [Buffer, Buffer] | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = 2; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) {
      return [buf.subarray(0, i + 2), buf.subarray(i + 2)];
    }
  }
  return null;
}

function startMovieStream(): MovieStream {
  const bin = gphoto2BinaryPath();
  const child = spawn(bin, ['--capture-movie', '--stdout'], {
    windowsHide: true,
    env: { ...process.env, ...resolvePluginEnv(bin) },
  });
  console.log(`[TetheredCamera] live-view stream starting (pid=${child.pid})`);
  const stream: MovieStream = {
    child,
    buffer: Buffer.alloc(0),
    latestFrame: null,
    latestFrameAt: 0,
    idleTimer: null,
    error: null,
    intentionalStop: false,
  };

  let loggedFirstFrame = false;
  child.stdout?.on('data', (chunk: Buffer) => {
    stream.buffer = stream.buffer.length ? Buffer.concat([stream.buffer, chunk]) : chunk;
    let leading = extractLeadingFrame(stream.buffer);
    while (leading) {
      const [frame, rest] = leading;
      stream.latestFrame = fixWindowsStdoutTextModeCorruption(frame);
      stream.latestFrameAt = Date.now();
      stream.buffer = rest;
      leading = extractLeadingFrame(stream.buffer);
      if (!loggedFirstFrame) {
        loggedFirstFrame = true;
        movieStreamBackoff.reset();
        console.log(`[TetheredCamera] live-view stream delivering frames (first frame ${stream.latestFrame.length} bytes)`);
      }
    }
    // Guard against an unbounded buffer if the stream ever stops looking
    // like tightly-packed JPEGs (not seen in real testing, but cheap to
    // bound) — drop it and let the next chunk resync from its own start.
    if (stream.buffer.length > MOVIE_BUFFER_MAX_BYTES) stream.buffer = Buffer.alloc(0);
  });
  child.stderr?.on('data', () => {
    // gphoto2 writes its own progress text here ("Capturing preview frames
    // as movie to 'stdout'...") — not an error by itself; a real failure is
    // detected via the 'error' event or the caller's own staleness check on
    // `latestFrameAt`, not by treating any stderr output as fatal.
  });
  child.on('error', (err) => {
    stream.error = err.message;
    console.error(`[TetheredCamera] live-view stream error (pid=${child.pid}): ${err.message}`);
  });
  child.on('close', (code) => {
    if (movieStream === stream) movieStream = null;
    if (!loggedFirstFrame && !stream.intentionalStop) {
      // Never produced a real frame — almost certainly "no camera plugged
      // in" rather than a genuine mid-session disconnect, so back off
      // before letting the next `ensureMovieStream()` spawn another one.
      // Skipped for a stream WE killed on purpose (`intentionalStop`,
      // 2026-09-24 fix, confirmed audit finding) — e.g. a shutter release
      // that landed before the very first live-view frame decoded; that is
      // not evidence of a missing camera and must not start this cooldown.
      movieStreamRetryAt = Date.now() + movieStreamBackoff.next();
    }
    console.log(`[TetheredCamera] live-view stream closed (pid=${child.pid}, code=${code})`);
  });

  movieStream = stream;
  return stream;
}

/**
 * Single-flight lazy start — see this section's own top doc comment for why.
 *
 * 2026-09-24 fix (confirmed audit finding): this used to start the stream
 * unconditionally the instant `movieStream` was `null`, with no regard for
 * whether a one-shot `gphoto2` call (`detect`/`capture`/`config`, all queued
 * via `withCameraLock`) was still in flight — `withCameraLock` stops the
 * movie stream and sets `movieStream = null` BEFORE running its own call,
 * which is exactly the window `getTetheredLiveViewFrame()`'s live-view
 * pollers (every 60-200ms) kept landing in: a second `gphoto2
 * --capture-movie` process would spawn and fight a real multi-second
 * `--capture-image-and-download` for the same USB/PTP session — the overlap
 * this file's own doc comment above records as producing a stuck capture or
 * a raw `-7 I/O problem` on real hardware. Routing the actual start through
 * `cameraQueue` waits for whatever one-shot call is currently queued to
 * finish first, closing that window; `withCameraLock` already stops
 * whatever movie stream this then starts before its own NEXT queued call
 * runs, so ordering the other direction was already safe.
 */
function ensureMovieStream(): Promise<MovieStream> {
  if (movieStream) return Promise.resolve(movieStream);
  if (movieStreamStarting) return movieStreamStarting;
  if (Date.now() < movieStreamRetryAt) {
    const waitSec = Math.ceil((movieStreamRetryAt - Date.now()) / 1000);
    return Promise.reject(new Error(`Máy ảnh chưa sẵn sàng — thử lại sau ${waitSec}s`));
  }
  movieStreamStarting = cameraQueue.then(() => {
    // 2026-09-24 fix (confirmed audit finding): cleanup used to run only on
    // the successful-start path (right after `startMovieStream()`), never in
    // a `finally` — if `startMovieStream()` (or anything above it, e.g.
    // `gphoto2BinaryPath()`/`resolvePluginEnv()`) ever threw synchronously,
    // the rejected promise stayed cached in `movieStreamStarting` forever:
    // `ensureMovieStream()`'s own `if (movieStreamStarting) return
    // movieStreamStarting;` would then hand every future live-view caller
    // (preview poll, CB Help poll, the tethered recording canvas) that same
    // stale rejection until the app restarted. `finally` clears it on every
    // path, including the early `if (movieStream)` return.
    try {
      if (movieStream) return movieStream;
      return startMovieStream();
    } finally {
      movieStreamStarting = null;
    }
  });
  return movieStreamStarting;
}

/** Kills the movie stream (if running) and waits for the process to actually exit before resolving — `withCameraLock` depends on this to guarantee the camera's PTP session is truly free before any one-shot command (detect/capture/config) runs. Killing a child process on Windows is always an abrupt `TerminateProcess`, not a graceful signal (a Node/Windows platform limitation, not something fixable here) — same abrupt-kill approach `runGphoto2`'s own timeout handler already uses elsewhere in this file. */
function stopMovieStreamAndWait(): Promise<void> {
  const stream = movieStream;
  if (!stream) return Promise.resolve();
  if (stream.idleTimer) clearTimeout(stream.idleTimer);
  // 2026-09-24 fix (confirmed audit finding) — see `MovieStream.
  // intentionalStop`'s own doc comment: this kill is deliberate, not a sign
  // the camera disappeared.
  stream.intentionalStop = true;
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.child.once('close', done);
    stream.child.kill();
    // Safety net — don't let a caller wait forever if 'close' never fires.
    setTimeout(done, 2000);
  }).then(() => {
    if (movieStream === stream) movieStream = null;
  });
}

function scheduleMovieIdleStop(): void {
  if (!movieStream) return;
  if (movieStream.idleTimer) clearTimeout(movieStream.idleTimer);
  movieStream.idleTimer = setTimeout(() => {
    void stopMovieStreamAndWait();
  }, MOVIE_IDLE_STOP_MS);
}

/**
 * Plan Bước 2 — one live-view frame (JPEG), NOT a video stream. Backed by
 * the continuous `movieStream` above: starts it lazily on first call, then
 * just returns whatever frame it most recently decoded — no per-call
 * subprocess spawn anymore, so this is now near-instant once the stream is
 * up. `MOVIE_IDLE_STOP_MS` after the last call, the stream stops itself so
 * the camera doesn't stay locked in movie mode with nobody actually
 * watching.
 */
export async function getTetheredLiveViewFrame(): Promise<Buffer> {
  const stream = await ensureMovieStream();
  scheduleMovieIdleStop();
  const deadline = Date.now() + LIVEVIEW_TIMEOUT_MS;
  while (!stream.latestFrame) {
    if (stream.error) throw new Error(stream.error);
    if (movieStream !== stream) throw new Error('Luồng live view đã dừng — thử lại');
    if (Date.now() >= deadline) {
      throw new Error(`gphoto2 --capture-movie không trả khung hình nào sau ${LIVEVIEW_TIMEOUT_MS}ms`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (Date.now() - stream.latestFrameAt > MOVIE_FRAME_STALE_MS) {
    throw new Error('Khung hình live view đã cũ — luồng có thể bị treo, thử lại');
  }
  return stream.latestFrame;
}
