import { createWorker, type Worker } from 'tesseract.js';

/**
 * OCR pipeline for the front of a Vietnamese CCCD (citizen ID) card.
 *
 * 2026-09-09 — moved here (from the standalone `apps/cccd-scanner` app,
 * which keeps its own unmodified copy) so the kiosk's own capture screen
 * (`CccdScanWaitingScreen.tsx`) can embed a scanning corner directly instead
 * of requiring a separate app window ("cccd scanner sẽ là góc nhỏ bên phải
 * rồi nên không cần mở 1 tab nữa" — the operator's own framing). Runs
 * entirely in whatever process calls it — the renderer here (Tesseract.js's
 * browser build, using the CDN-hosted worker/core/language files by
 * default). No Electron- or DOM-specific API beyond what Tesseract.js
 * itself needs, so this file has no camera/window dependency of its own —
 * see `CccdScanWaitingScreen.tsx` for where the captured frame comes from
 * and where the confirmed result gets written.
 */

/** Vietnamese CCCD numbers are exactly 12 digits, printed as one contiguous run — see the module doc comment on why this exact shape is the acceptance gate, not a looser "find some digits" heuristic. */
const CITIZEN_ID_PATTERN = /\b\d{12}\b/;

/**
 * Pulls a clean 12-digit token out of raw OCR text. Pure and synchronous —
 * no OCR/image involved — so it's unit-testable with plain string fixtures,
 * independent of Tesseract's own accuracy.
 *
 * This IS the safety gate: a garbled partial (stray whitespace inside the
 * run, 11 or 13 digits, no digits at all) returns `null` rather than a
 * best-effort partial guess — matching the kiosk's own "only a stable,
 * clean read counts" stability gate in `CccdScanWaitingScreen.tsx`.
 */
export function extractCitizenId(ocrText: string): string | null {
  const match = ocrText.match(CITIZEN_ID_PATTERN);
  return match ? match[0] : null;
}

/**
 * Best-effort full name extraction — bonus field only; never blocks the
 * accept flow the way `extractCitizenId` does. Looks for the line of text
 * following a "Họ và tên" / "Full name" label, which is where Vietnamese
 * CCCD cards print it.
 *
 * Line-based rather than a single regex over the whole text: a real card
 * prints the bilingual label as "Họ và tên / Full name:" on its own line,
 * with the actual name on the NEXT line — a regex that just skips one
 * separator and grabs the rest of the line would instead capture the
 * trailing "/ Full name:" half of the label itself as if it were the name.
 */
const FULL_NAME_LABEL_PATTERN = /h[oọ]\s*(?:và|va)?\s*t[eê]n|full\s*name/i;

export function extractFullName(ocrText: string): string | null {
  const lines = ocrText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (!FULL_NAME_LABEL_PATTERN.test(lines[i])) continue;

    // Same-line form ("Full name: NGUYEN THI B") — only trust text after the
    // last ':' when it isn't itself just the other half of a bilingual label
    // (the "/ Full name:" case above).
    const afterColon = lines[i].split(':').slice(1).join(':').trim();
    if (afterColon && !FULL_NAME_LABEL_PATTERN.test(afterColon)) {
      return normalizeName(afterColon);
    }

    // Otherwise, the next non-empty line is the name.
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (candidate) return normalizeName(candidate);
    }
    return null;
  }

  return null;
}

function normalizeName(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s{2,}/g, ' ');
  return cleaned.length > 0 ? cleaned : null;
}

export interface RecognizeCccdFrameOptions {
  /** Tesseract language(s) to load. Defaults to `'eng+vie'` — Vietnamese for the diacritic name text, English/Latin for the digit-heavy id line and bilingual card boilerplate. */
  langs?: string;
  /** Passed straight through as `createWorker`'s 3rd (options) argument. */
  workerOptions?: Record<string, unknown>;
}

export interface CccdOcrResult {
  /** The confirmed-format citizen id, or `null` if neither OCR pass produced a clean 12-digit run — see `extractCitizenId`'s doc comment. */
  citizenId: string | null;
  /** Best-effort name, or `null` if no label line was found. */
  fullName: string | null;
  /** Raw text from the general-purpose pass — kept for diagnostics, not shown to the operator. */
  rawText: string;
  /** Raw text from the digit-whitelisted pass — same. */
  digitPassText: string;
}

/** Creates a Tesseract worker for repeated reuse across many frames — a continuous scan loop must not pay a worker-startup cost on every single poll. */
export async function createCccdWorker(options: RecognizeCccdFrameOptions = {}): Promise<Worker> {
  const langs = options.langs ?? 'eng+vie';
  return createWorker(langs, 1, options.workerOptions);
}

/**
 * Two-pass strategy against a caller-supplied, already-initialized worker:
 * a general pass (bonus name extraction + fallback digit source) and a
 * digit-whitelisted pass (removes the general pass's dictionary bias for
 * exactly the field that matters most). The digit-whitelisted pass's result
 * is preferred when it found a clean 12-digit run.
 *
 * `worker.setParameters` mutates shared state on the worker, so this always
 * restores the whitelist back to "everything" before returning.
 */
export async function recognizeWithWorker(worker: Worker, image: string | Buffer): Promise<CccdOcrResult> {
  const { data: generalData } = await worker.recognize(image);
  const rawText = generalData.text;

  await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
  const { data: digitData } = await worker.recognize(image);
  const digitPassText = digitData.text;
  await worker.setParameters({ tessedit_char_whitelist: '' });

  const digitCandidate = extractCitizenId(digitPassText);
  const generalCandidate = extractCitizenId(rawText);

  return {
    citizenId: digitCandidate ?? generalCandidate,
    fullName: extractFullName(rawText),
    rawText,
    digitPassText,
  };
}

/** One-shot convenience wrapper: creates a worker, runs one frame through it, terminates it. Not used by the continuous scan loop (which reuses one worker — see `createCccdWorker`), kept for isolated single-frame callers (tests). */
export async function recognizeCccdFrame(
  image: string | Buffer,
  options: RecognizeCccdFrameOptions = {}
): Promise<CccdOcrResult> {
  const worker = await createCccdWorker(options);
  try {
    return await recognizeWithWorker(worker, image);
  } finally {
    await worker.terminate();
  }
}
