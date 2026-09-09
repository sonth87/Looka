/**
 * Pure parsing + lookup for the external student roster file — 2026-09-09
 * architecture correction. Extracted the same way `activationFile.ts` is: no
 * Electron import, so it can run under plain `node --test`. See
 * `cccdRosterWatcher.ts`'s own doc comment for the polling/cache wrapper
 * around this.
 *
 * Replaces the earlier (same-day) `cccdScanFile.ts`/`cccdWatcher.ts` pair,
 * which was built on a wrong assumption: that
 * `D:\Work\camera_server\response.json` is a per-scan file some other
 * producer WRITES each time a card is read (`{ soCCCD, hoTen }`-shaped). The
 * user corrected this with the real file's actual contents: it is a full
 * student roster — a JSON ARRAY of student records, refreshed wholesale by
 * an external system this app does not control and must only ever READ. A
 * scanned citizen id is matched against `identity_number` anywhere in that
 * array — there is no campaign-scoping; a match found anywhere proceeds to
 * capture regardless of which campaign the kiosk currently has open (an
 * earlier, campaign-scoped `campaign_student_roster` Postgres mechanism was
 * built the same day and has since been removed entirely — see this repo's
 * own migration history).
 *
 * Every field below except `identityNumber` is display-only/best-effort:
 * the real roster has many more fields than are listed here (faculty,
 * gender, date of birth, province, ...) — this only carries the handful
 * `FaceCaptureApp.tsx` actually maps into `StudentLookupResult`/
 * `StudentSubjectInfo`.
 */
export interface RosterRecord {
  /** The CCCD number — the only field ever matched against a scan. Always a non-empty, trimmed string on anything this parser returns; records missing it are dropped, never surfaced with an empty/placeholder value. */
  identityNumber: string;
  /** `student_code` — what the rest of this platform already treats as a person's identity for a captured session (`sessions.subject_code`). `null` if the roster row had none. */
  studentCode: string | null;
  /** `full_name`. */
  fullName: string | null;
  /** `class_name`. */
  className: string | null;
  /** `major_name`. */
  majorName: string | null;
  /** `course_year`, if present — the closest thing the real roster has to an "academic year", but not the same thing; kept as a plain string (whatever the source wrote), never reformatted or guessed at. `null` if absent. */
  courseYear: string | null;
}

const DEFAULT_ROSTER_PATH = 'D:\\Work\\camera_server\\response.json';

/** `LOOKA_CCCD_SCAN_PATH` override — same env var and convention the earlier `cccdWatcher.ts` already used, kept unchanged so existing dev/test setups pointing at a scratch file keep working. */
export function rosterFilePath(): string {
  return process.env.LOOKA_CCCD_SCAN_PATH?.trim() || DEFAULT_ROSTER_PATH;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * One roster element -> `RosterRecord`, or `null` if it has no usable
 * `identity_number` — dropped rather than surfacing with an empty match key,
 * per this module's own doc comment. Every other field is best-effort:
 * missing/wrong-typed just becomes `null`, never a reason to drop the whole
 * record (a row with a real CCCD but a blank name is still a real, matchable
 * row).
 */
function parseRecord(el: unknown): RosterRecord | null {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
  const obj = el as Record<string, unknown>;

  const identityNumber = stringOrNull(obj.identity_number);
  if (!identityNumber) return null;

  return {
    identityNumber,
    studentCode: stringOrNull(obj.student_code),
    fullName: stringOrNull(obj.full_name),
    className: stringOrNull(obj.class_name),
    majorName: stringOrNull(obj.major_name),
    courseYear: stringOrNull(obj.course_year),
  };
}

/**
 * Returns `null` for anything that isn't a *usable* roster snapshot — an
 * empty file, a JSON parse failure, or a JSON value that isn't an array.
 * `cccdRosterWatcher.ts` treats `null` as "keep whatever the cache already
 * has" — the external writer refreshing this file wholesale (rewriting the
 * whole array, not appending) means a poll can genuinely observe a
 * half-written file mid-swap; that must never wipe out an otherwise-good
 * cached roster just because one tick's read raced the write.
 *
 * An array that DOES parse, but whose elements are individually missing
 * `identity_number` or otherwise malformed, is still a successful parse —
 * those elements are simply skipped (see `parseRecord`) rather than failing
 * the whole file, since a roster of a few thousand rows realistically will
 * have some incomplete ones.
 */
export function parseRosterFile(raw: string): RosterRecord[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const records: RosterRecord[] = [];
  for (const el of parsed) {
    const record = parseRecord(el);
    if (record) records.push(record);
  }
  return records;
}

/** Exact string match (trimmed) against `identityNumber` — the whole roster, no campaign scoping. `null` for a blank input or no match. */
export function findByIdentityNumber(records: RosterRecord[], identityNumber: string): RosterRecord | null {
  const trimmed = identityNumber.trim();
  if (!trimmed) return null;
  return records.find((r) => r.identityNumber === trimmed) ?? null;
}
