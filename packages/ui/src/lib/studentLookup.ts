import { STUDENT_TEST_DATA } from './studentTestData.js';

/**
 * Student-identity lookup for the kiosk's pre-session "nhập mã sinh viên"
 * step (2026-09-07 product request). Phase 1 only — this is a **simulated**
 * lookup with no external call: there is no student directory anywhere in
 * this system yet, and the real lookup
 * (`docs/plans/multi-camera-device-management-discussion.md` §2.3,
 * `GET /v1/identify/lookup`) is explicitly blocked on a protocol the
 * external Admin system hasn't published. Every caller goes through
 * `lookupStudent()` so that swapping this function's body for the real HTTP
 * call later — once §2.3 is unblocked, or once ID-card scanning replaces
 * manual entry — never requires touching `FaceCaptureApp.tsx`'s call sites.
 */

export type StudentLookupResult =
  | {
      status: 'FOUND';
      code: string;
      name: string;
      className: string;
      major: string;
      academicYear: string;
      /**
       * The CCCD number this match was found by (2026-09-09 CCCD-scan
       * feature) — `undefined` for the manual "nhập mã sinh viên" path,
       * which has no citizen id at all. Threaded through to
       * `StudentSubjectInfo`/`sessions.metadata` (see
       * `FaceCaptureApp.tsx`'s `handleLookupResult`) purely so the CMS can
       * later search/filter a session by the CCCD number it was captured
       * under — never used for matching itself, that already happened.
       */
      identityNumber?: string;
    }
  | { status: 'NOT_FOUND'; code: string };

/**
 * Phase 1 (simulated): looks the code up in `STUDENT_TEST_DATA` — a code
 * present there resolves FOUND with its real test name; anything else
 * (including a blank code) resolves NOT_FOUND, so both branches of the
 * "nhập mã sinh viên" flow are exercisable against realistic-looking data
 * before any real directory exists. Case/whitespace-insensitive, since a
 * kiosk operator retyping a code should not fail on that alone.
 *
 * Phase 2: replace this body with `GET /v1/identify/lookup?code=...` per
 * §2.3 (and delete `studentTestData.ts`) — keep the same signature and the
 * same two-branch result shape so `StudentIdEntryScreen`/`FaceCaptureApp.tsx`
 * need no changes.
 */
export async function lookupStudent(code: string): Promise<StudentLookupResult> {
  const trimmed = code.trim();
  const match = STUDENT_TEST_DATA.find((s) => s.code.toLowerCase() === trimmed.toLowerCase());
  if (!trimmed || !match) {
    return { status: 'NOT_FOUND', code: trimmed };
  }
  return {
    status: 'FOUND',
    code: match.code,
    name: match.name,
    className: match.className,
    major: match.major,
    academicYear: match.academicYear,
  };
}
