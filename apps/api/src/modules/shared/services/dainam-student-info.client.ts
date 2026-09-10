import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Every field is a filter — an empty string / 0 means "no filter on this
 * field", matching the real API's own sample request (which sends `""`/`0`
 * for every field except a real `course_year`). All optional here too, for
 * the same reason: a caller that only wants to filter by course year should
 * not have to also decide what "no filter" looks like for the other three.
 */
export interface GetListStudentInfoParams {
  studentCode?: string;
  facultyId?: number;
  trainingSystemId?: number;
  courseYear?: number;
}

/**
 * One record as the real API actually returns it (2026-09-10, confirmed
 * live against a real course_year query) — the same person this platform
 * already knows from the external roster file (`cccdRoster.ts`'s
 * `RosterRecord`): `user_code`/`identity_number`/`student_code`/
 * `class_name`/`major_name`/`course_year` all match exactly. Fields beyond
 * what any current caller needs are kept as `unknown` rather than typed out
 * one by one, since nothing here reads them yet.
 */
export interface DainamStudentInfoRecord {
  student_id: string;
  student_code: string;
  full_name: string;
  user_code: string;
  identity_number: string;
  class_name: string | null;
  major_name: string | null;
  faculty_name: string | null;
  course_year: number | null;
  status: string | null;
  [key: string]: unknown;
}

export interface GetListStudentInfoResponse {
  success: boolean;
  data: DainamStudentInfoRecord[];
}

/** Thrown for any failure calling the student-info API — unreachable, non-2xx, timeout, or a body that isn't valid JSON. */
export class DainamStudentInfoError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DainamStudentInfoError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Client for the university's own open API
 * (`POST https://openapi.dainam.edu.vn/api/get_list_student_info`) — real
 * student directory data, a different system than the external roster file
 * (`apps/desktop/src/main/cccdRoster.ts`) the kiosk's CCCD scan currently
 * reads. Not wired to any caller yet ("sẽ sử dụng sau") — this is only the
 * call itself, so a future integration can be scoped and reviewed on its
 * own rather than bundled in here.
 *
 * `DAINAM_STUDENT_INFO_API_KEY` is a real, namespace-wide credential — never
 * hardcoded, read once via `ConfigService` (see `config/dainam-student-info.ts`),
 * same posture as `FS_API_KEY`.
 */
@Injectable()
export class DainamStudentInfoClient {
  private readonly logger = new Logger(DainamStudentInfoClient.name);

  constructor(private readonly configService: ConfigService) {}

  async getListStudentInfo(params: GetListStudentInfoParams = {}): Promise<GetListStudentInfoResponse> {
    const baseUrl = this.configService.get<string>('dainamStudentInfo.baseUrl');
    const apiKey = this.configService.get<string>('dainamStudentInfo.apiKey');
    if (!apiKey) {
      throw new DainamStudentInfoError('DAINAM_STUDENT_INFO_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: globalThis.Response;
    try {
      res = await fetch(`${baseUrl!.replace(/\/$/, '')}/api/get_list_student_info`, {
        method: 'POST',
        headers: {
          accept: 'text/plain',
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          student_code: params.studentCode ?? '',
          faculty_id: params.facultyId ?? 0,
          // Field name kept exactly as the real API expects it (a typo in
          // the source system, "traning" not "training") — not "fixed" here,
          // since this must match what the server actually validates.
          traning_system_id: params.trainingSystemId ?? 0,
          course_year: params.courseYear ?? 0,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      this.logger.warn(`Could not reach the student-info API: ${(error as Error).message}`);
      throw new DainamStudentInfoError('Could not reach the student-info API', error);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DainamStudentInfoError(`student-info API returned HTTP ${res.status}: ${body.slice(0, 500)}`);
    }

    // The API's own `accept: text/plain` header is what its sample request
    // sends, but the body is actually JSON (confirmed live, 2026-09-10) —
    // `{ success: boolean, data: [...] }`, parsed here so a caller gets real
    // records, not a string it has to parse itself.
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new DainamStudentInfoError('student-info API returned a non-JSON body', error);
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { data?: unknown }).data)) {
      throw new DainamStudentInfoError('student-info API returned an unexpected shape (no "data" array)');
    }
    return parsed as GetListStudentInfoResponse;
  }
}
