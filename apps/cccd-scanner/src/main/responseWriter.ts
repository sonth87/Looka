import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes the confirmed OCR result to the exact file
 * `apps/desktop/src/main/cccdWatcher.ts` polls, in the exact field-name shape
 * `apps/desktop/src/main/cccdScanFile.ts`'s `parseCccdScanFile` prefers
 * (`soCCCD` / `hoTen` — see that file's own doc comment for the full alias
 * list it also accepts, kept here to the canonical pair on purpose).
 *
 * This app and the kiosk's watcher are deliberately decoupled — see this
 * package's own top-level doc comment in App.tsx for why — so this file does
 * NOT import anything from apps/desktop. The shape contract is verified
 * instead by `test/responseWriter.test.ts`, which imports the real
 * `parseCccdScanFile` and round-trips a file written by this module through
 * it.
 */

export const DEFAULT_RESPONSE_FILE_PATH = 'D:\\Work\\camera_server\\response.json';

/**
 * `LOOKA_CCCD_SCAN_PATH` overrides the write target — mirrors
 * `cccdWatcher.ts`'s own read-side override of the exact same env var, so a
 * dev/test run of this tool and a dev/test run of the kiosk can point at the
 * same overridden path without ever touching the real
 * `D:\Work\camera_server\response.json` file. The production default is the
 * fixed path the product brief specifies — never configurable outside this
 * override.
 */
export function responseFilePath(): string {
  return process.env.LOOKA_CCCD_SCAN_PATH?.trim() || DEFAULT_RESPONSE_FILE_PATH;
}

export interface CccdWritePayload {
  /** The operator-confirmed 12-digit citizen id. Written verbatim — validation already happened before confirm (see ocr.ts's extractCitizenId gate). */
  citizenId: string;
  /** Full name, or '' when OCR found none — never blocks the write (see App.tsx's confirm-gate doc comment: only citizenId is safety-gated). */
  fullName: string;
}

/**
 * Writes `{ soCCCD, hoTen }` to `filePath` (defaults to `responseFilePath()`).
 *
 * Writes to a sibling temp file and renames into place rather than writing
 * `filePath` directly — an atomic swap on the same volume, so
 * `cccdWatcher.ts`'s poll (which compares mtime+size between ticks) can never
 * observe a half-written file mid-write.
 */
export function writeCccdResponseFile(payload: CccdWritePayload, filePath: string = responseFilePath()): void {
  const body = {
    soCCCD: payload.citizenId,
    hoTen: payload.fullName,
  };

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `.response.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(body, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}
