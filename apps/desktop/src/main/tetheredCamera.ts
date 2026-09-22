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
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';

const DETECT_TIMEOUT_MS = 10_000;
const LIVEVIEW_TIMEOUT_MS = 5_000;
const CAPTURE_TIMEOUT_MS = 30_000;

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
 */
let cameraQueue: Promise<void> = Promise.resolve();
function withCameraLock<T>(fn: () => Promise<T>): Promise<T> {
  const queued = cameraQueue.then(fn, fn);
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

/** Wrapped in `withCameraLock` — shared by both exported capture functions below, see that helper's own doc comment for why. */
async function captureViaStdout(args: string[], timeoutMs: number): Promise<Buffer> {
  return withCameraLock(async () => {
    const { code, stdout, stderr } = await runGphoto2Binary([...args, '--stdout'], timeoutMs);
    if (code !== 0) {
      throw new Error(stderr.trim() || `gphoto2 thoát với mã lỗi ${code}`);
    }
    return fixWindowsStdoutTextModeCorruption(stdout);
  });
}

/** Plan Bước 3 — real shutter trigger + download. Camera should be configured to save JPEG (not RAW) so this slots straight into the existing card/AI pipeline with no conversion step. */
export async function captureTetheredPhoto(): Promise<Buffer> {
  return captureViaStdout(['--capture-image-and-download'], CAPTURE_TIMEOUT_MS);
}

/**
 * Plan Bước 2 — one live-view frame (JPEG), NOT a video stream. Caller
 * (main-process polling loop, once built) decides the polling interval;
 * the plan's own live-view section documents why gphoto2 has a real,
 * structural fps/latency ceiling here (community-reported <10fps, some
 * reports of multi-second lag) — this function does not try to hide that,
 * it just returns whatever one frame gphoto2 hands back.
 */
export async function getTetheredLiveViewFrame(): Promise<Buffer> {
  return captureViaStdout(['--capture-preview'], LIVEVIEW_TIMEOUT_MS);
}
