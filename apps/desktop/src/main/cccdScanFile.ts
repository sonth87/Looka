/**
 * Pure parsing for the external CCCD (Vietnamese citizen ID card, "căn cước
 * công dân") scanner's output file — see `cccdWatcher.ts`'s own doc comment
 * for the polling/IPC wrapper around this. Extracted the same way
 * `activationFile.ts` is: no Electron import, so it can run under plain
 * `node --test`.
 *
 * **`response.json`'s shape is not confirmed against any real scanner
 * integration yet** (2026-09-09 product request: "quét CCCD thay cho nhập
 * mã SV" — the scanning hardware/software already exists and is operated by
 * someone else; this app only reads whatever it writes). This is a
 * best-effort, defensive parse against a *guessed* shape for a standard
 * Vietnamese CCCD chip read. The canonical field names this parser prefers
 * are `soCCCD` (citizen id number) and `hoTen` (full name) — every other
 * accepted name below is a fallback alias, in case the real integration uses
 * a different convention. **Confirm the exact field names against the real
 * scanner software before relying on this in production** and prune/rename
 * the alias lists here once known — nothing outside this file needs to
 * change to do that.
 */

export interface ParsedCccdScan {
  /**
   * The CCCD number — the only field actually used to match against a
   * campaign roster (`GET /v1/campaigns/:id/roster/lookup`). Typically 12
   * digits, but not validated as such here — the roster lookup does an
   * exact string match against whatever this parser extracted, and being
   * stricter here would only risk rejecting a real scan over a format
   * assumption that turns out wrong.
   */
  citizenId: string;
  /** Full name — display-only (the "waiting for scan" screen, the CB Help greeting), never used for matching. Empty string if the scan file had no recognizable name field. */
  fullName: string;
  /** Date of birth, exactly as the scanner wrote it (no reformatting/validation) — display-only bonus, `null` if absent. */
  dateOfBirth: string | null;
}

const CITIZEN_ID_FIELDS = ['soCCCD', 'so_cccd', 'idNumber', 'id_number', 'cccd', 'id'];
const FULL_NAME_FIELDS = ['hoTen', 'ho_ten', 'hoVaTen', 'fullName', 'full_name', 'name'];
const DOB_FIELDS = ['ngaySinh', 'ngay_sinh', 'dateOfBirth', 'date_of_birth', 'dob', 'birthDate'];

function firstStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Returns `null` for anything that isn't a *usable* scan — an empty file, a
 * JSON parse failure, a JSON value that isn't a plain object, or one with no
 * recognizable citizen-id field. `cccdWatcher.ts` treats `null` as "no scan
 * yet," never as a NOT_FOUND roster-match failure — a scanner mid-write, a
 * template/placeholder file, or a stray malformed byte must not flash the
 * "không có trong dữ liệu" error at the operator before real data lands. A
 * NOT_FOUND result only ever comes from a *successfully parsed* citizen id
 * that the roster lookup then fails to match — see `FaceCaptureApp.tsx`'s
 * `handleCccdScan`.
 */
export function parseCccdScanFile(raw: string): ParsedCccdScan | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const citizenId = firstStringField(obj, CITIZEN_ID_FIELDS);
  if (!citizenId) return null;

  const fullName = firstStringField(obj, FULL_NAME_FIELDS) ?? '';
  const dateOfBirth = firstStringField(obj, DOB_FIELDS);

  return { citizenId, fullName, dateOfBirth };
}
