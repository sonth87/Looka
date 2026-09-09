import { createWorker, type Worker } from 'tesseract.js';

/**
 * OCR pipeline for the front of a Vietnamese CCCD (citizen ID) card.
 *
 * Runs entirely in whatever process calls it — the real app calls this from
 * the renderer (Tesseract.js's browser build, using the CDN-hosted
 * worker/core/language files by default); `test/ocr.test.ts` calls the same
 * code from a plain Node process (Tesseract.js's Node build, auto-detected
 * the same way). No Electron- or DOM-specific API is used here beyond what
 * Tesseract.js itself needs, so this file has no camera/window dependency of
 * its own — see this package's `App.tsx` for where the captured frame comes
 * from.
 */

/** Vietnamese CCCD numbers are exactly 12 digits, printed as one contiguous run — see the module doc comment on why this exact shape is the acceptance gate, not a looser "find some digits" heuristic. */
const CITIZEN_ID_PATTERN = /\b\d{12}\b/;

/**
 * Pulls a clean 12-digit token out of raw OCR text. Pure and synchronous —
 * no OCR/image involved — so it's unit-testable with plain string fixtures,
 * independent of Tesseract's own accuracy.
 *
 * This IS the safety gate mentioned in the product brief: a match here is
 * shown to the operator for confirmation, never auto-written. Anything that
 * doesn't produce a single clean `\d{12}` token (stray whitespace inside the
 * run, 11 or 13 digits, no digits at all) returns `null` rather than a
 * best-effort partial guess — a garbled partial is worse than nothing here,
 * since the whole point of the confirm step is comparing a plausible-looking
 * number against the physical card, and a number that's obviously malformed
 * doesn't need a human to catch it, while a well-formed-but-wrong one does.
 */
export function extractCitizenId(ocrText: string): string | null {
  const match = ocrText.match(CITIZEN_ID_PATTERN);
  return match ? match[0] : null;
}

/**
 * Best-effort full name extraction — bonus field only, per the product
 * brief; never blocks the confirm flow the way `extractCitizenId` does.
 * Looks for the line of text following a "Họ và tên" / "Full name" label,
 * which is where Vietnamese CCCD cards print it.
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
  /**
   * Tesseract language(s) to load. Defaults to `'eng+vie'` — Vietnamese for
   * the diacritic name text, English/Latin for everything else (digits are
   * language-independent, but the label text and card boilerplate around
   * them are bilingual on a real CCCD). Tests override this to plain
   * `'eng'` to skip the larger Vietnamese trained-data download and keep
   * test runs fast, since the fixture image under test never contains
   * Vietnamese text.
   */
  langs?: string;
  /**
   * Passed straight through as `createWorker`'s 3rd (options) argument —
   * e.g. `cachePath`/`corePath`/`langPath` overrides. The real app never
   * needs this (Tesseract.js's CDN defaults work fine from the renderer);
   * tests use `cachePath` to point the downloaded trained-data cache at a
   * scratch directory instead of writing into the repo.
   */
  workerOptions?: Record<string, unknown>;
}

export interface CccdOcrResult {
  /** The confirmed-format citizen id, or `null` if neither OCR pass produced a clean 12-digit run — see `extractCitizenId`'s doc comment. */
  citizenId: string | null;
  /** Best-effort name, or `null` if no label line was found. */
  fullName: string | null;
  /** Raw text from the general-purpose pass — kept for diagnostics/debugging, not shown to the operator. */
  rawText: string;
  /** Raw text from the digit-whitelisted pass — same. */
  digitPassText: string;
}

/**
 * Creates a Tesseract worker for repeated reuse across many frames — see
 * `recognizeWithWorker`'s own doc comment for why continuous auto-scan (2026-
 * 09-09, replacing the original single manual-capture-button flow) needs a
 * long-lived worker instead of `recognizeCccdFrame`'s original
 * create-per-call/terminate-per-call shape (kept below, unchanged, for
 * one-shot callers like the test suite).
 */
export async function createCccdWorker(options: RecognizeCccdFrameOptions = {}): Promise<Worker> {
  const langs = options.langs ?? 'eng+vie';
  return createWorker(langs, 1, options.workerOptions);
}

/**
 * The same two-pass general+digit-whitelist strategy as `recognizeCccdFrame`
 * (see that function's doc comment for the reasoning), but against a
 * caller-supplied, already-initialized worker instead of creating and
 * tearing one down per call.
 *
 * `worker.setParameters` mutates shared state on the worker, so this
 * function always restores the whitelist back to "everything" (`''`) before
 * returning — an unrelated later call reusing this same worker (e.g. a
 * one-off `recognizeCccdFrame` call, or a future caller that assumes a fresh
 * worker) must not silently inherit the digit-only restriction this call set.
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

/**
 * One-shot convenience wrapper around `recognizeWithWorker`: creates a
 * worker, runs one frame through it, terminates it. Used by the test suite
 * (each test wants full isolation) — the real app's continuous auto-scan
 * uses `createCccdWorker`/`recognizeWithWorker` directly instead, reusing one
 * worker across many frames (see `App.tsx`), since creating a fresh worker
 * per frame would add a worker-startup's worth of latency to every single
 * poll of a scan loop that runs every ~1.2s.
 */
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
