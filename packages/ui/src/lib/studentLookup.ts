import { STUDENT_TEST_DATA } from './studentTestData.js';

/**
 * Student-identity lookup for the kiosk's pre-session "nhập mã sinh viên"
 * step (2026-09-07 product request).
 *
 * 2026-09-18: now calls the REAL, campaign-scoped eligibility check
 * (`faceAPI.lookupCampaignSubject` — an Electron IPC bridge to
 * `apps/desktop/src/main/deviceApi.ts`'s `lookupCampaignSubject`, which
 * calls `GET /v1/campaigns/:id/subjects/lookup?key=` with this kiosk's own
 * device credentials) whenever `campaignId` is supplied AND that bridge
 * exists — i.e. the campaign+login kiosk path
 * (`CccdScanWaitingScreen`'s manual field AND, as of the same day, its
 * bare-QR-scan detection — see that file's own `onStudentCodeScan` doc
 * comment). Field report that surfaced this had been a stub all along:
 * `eligibility_check_logs` (the server's own audit trail for this exact
 * endpoint) had ZERO rows in the entire database despite a real, correctly
 * configured EXTERNAL_API campaign — this function was still matching
 * against the hardcoded `STUDENT_TEST_DATA` fixture below and never once
 * reaching the network.
 *
 * The **simulated** fallback below is now reached only by the ORIGINAL
 * "Phase 1" callers this was built for: the legacy per-device-secret
 * desktop path and `apps/web`'s browser build, neither of which has
 * `campaignId` + a working `faceAPI` bridge at the same time (see
 * `FaceCaptureApp.tsx`'s own render gate between `CccdScanWaitingScreen`
 * and `StudentIdEntryScreen`) — `docs/plans/multi-camera-device-management-
 * discussion.md` §2.3's `GET /v1/identify/lookup` (a DIFFERENT, campaign-
 * agnostic endpoint) is still unbuilt, so those two paths have no real
 * lookup to call at all yet.
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
      /**
       * `user_code` from the external roster (2026-09-10 CCCD-scan feature)
       * — `undefined` for the manual "nhập mã sinh viên" path, same as
       * `identityNumber`. Threaded through to `StudentSubjectInfo`/
       * `sessions.metadata`, same mechanism, purely so it rides along with
       * the rest of the looked-up identity.
       */
      userCode?: string;
    }
  | { status: 'NOT_FOUND'; code: string };

/** `CampaignSubjectLookupResult` as the `faceAPI.lookupCampaignSubject` bridge returns it — duplicated rather than imported, same convention every other `faceAPI` payload type in this package already follows (it cannot import apps/desktop's own types). */
interface CampaignSubjectLookupResult {
  eligible: boolean;
  reason?: string;
  subject?: {
    subjectCode: string;
    fullName: string;
    className?: string | null;
    major?: string | null;
  } | null;
  externalRecord?: Record<string, unknown> | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

/**
 * Maps the real endpoint's `{eligible, subject?, externalRecord?}` onto this
 * module's own FOUND/NOT_FOUND shape. `eligible` (NOT "was any record
 * matched at all") is what actually gates FOUND here: a ROSTER/ROSTER_AND_API
 * match that fails one of the campaign's own `rules[]` still comes back with
 * `subject` populated but `eligible: false` — see `CampaignSubjectLookupDao`'s
 * own doc comment server-side — and must NOT start a capture session.
 *
 * `subject` (roster row) and `externalRecord` (raw external-API record, real
 * field names like `full_name`/`class_name`/`major_name`/`course_year` — see
 * `student-directory.adapter.ts`'s own `DainamStudentInfoRecord`) can both be
 * present at once (ROSTER_AND_API); `subject`'s own structured fields are
 * preferred when both exist, since it is the one this platform's own roster
 * import actually curated.
 */
function mapCampaignSubjectLookup(key: string, result: CampaignSubjectLookupResult): StudentLookupResult {
  if (!result.eligible) return { status: 'NOT_FOUND', code: key };

  const record = result.externalRecord;
  return {
    status: 'FOUND',
    code: result.subject?.subjectCode ?? asString(record?.student_code) ?? key,
    name: result.subject?.fullName ?? asString(record?.full_name) ?? '',
    className: result.subject?.className ?? asString(record?.class_name) ?? '',
    major: result.subject?.major ?? asString(record?.major_name) ?? '',
    academicYear: asString(record?.course_year) ?? '',
  };
}

/**
 * Simulated fallback (Phase 1) — looks the code up in `STUDENT_TEST_DATA`. A
 * code present there resolves FOUND with its real test name; anything else
 * (including a blank code) resolves NOT_FOUND. Case/whitespace-insensitive,
 * since a kiosk operator retyping a code should not fail on that alone. Only
 * reached when there is no real endpoint to call — see this file's own top
 * doc comment for exactly which callers that is.
 */
function lookupStudentSimulated(code: string): StudentLookupResult {
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

/**
 * `campaignId` is `undefined`/`null` for every caller that has no real
 * endpoint to reach yet (see this file's own top doc comment) — passing it
 * is what opts a call into the real network lookup instead of the simulated
 * fixture; there is no separate flag, the presence of a campaign IS the
 * signal, same as `CccdScanWaitingScreen`'s own render gate already treats
 * `campaignId` as.
 */
export async function lookupStudent(code: string, campaignId?: string | null): Promise<StudentLookupResult> {
  const trimmed = code.trim();
  if (!trimmed) return { status: 'NOT_FOUND', code: trimmed };

  const faceAPI = (window as any).faceAPI;
  const realLookup = faceAPI?.lookupCampaignSubject as
    | ((payload: { campaignId: string; key: string }) => Promise<CampaignSubjectLookupResult>)
    | undefined;

  if (campaignId && realLookup) {
    const result = await realLookup({ campaignId, key: trimmed });
    return mapCampaignSubjectLookup(trimmed, result);
  }

  return lookupStudentSimulated(trimmed);
}
