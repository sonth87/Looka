import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IntegrationOutcome,
  retryable,
  success,
  terminal,
} from '../integration-outcome';

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

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Adapter for the university's own open API
 * (`POST https://openapi.dainam.edu.vn/api/get_list_student_info`) — real
 * student directory data, a different system than the external roster file
 * (`apps/desktop/src/main/cccdRoster.ts`) the kiosk's CCCD scan currently
 * reads. Not wired to any caller yet ("sẽ sử dụng sau") — this is only the
 * call itself, so a future integration can be scoped and reviewed on its
 * own rather than bundled in here.
 *
 * Relocated under `shared/integrations/` (plan §3/§4.5) from
 * `modules/shared/services/` with no other change of substance beyond
 * returning `IntegrationOutcome` instead of throwing — safe to do here with
 * zero callers to break, and this is the template the other three
 * integrations (file-service, python-ai, sso) follow the same shape as.
 *
 * `DAINAM_STUDENT_INFO_API_KEY` is a real, namespace-wide credential — never
 * hardcoded, read once via `ConfigService` (see `shared/config/dainam-student-info.ts`),
 * same posture as `FS_API_KEY`.
 */
@Injectable()
export class DainamStudentInfoClient {
  private readonly logger = new Logger(DainamStudentInfoClient.name);

  constructor(private readonly configService: ConfigService) {}

  async getListStudentInfo(
    params: GetListStudentInfoParams = {},
  ): Promise<IntegrationOutcome<GetListStudentInfoResponse>> {
    const baseUrl = this.configService.get<string>('dainamStudentInfo.baseUrl');
    const apiKey = this.configService.get<string>('dainamStudentInfo.apiKey');
    if (!apiKey) {
      return terminal('DAINAM_STUDENT_INFO_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: globalThis.Response;
    try {
      res = await fetch(
        `${baseUrl!.replace(/\/$/, '')}/api/get_list_student_info`,
        {
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
        },
      );
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not reach the student-info API: ${message}`);
      return retryable(`Could not reach the student-info API: ${message}`);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return terminal(
        `student-info API returned HTTP ${res.status}: ${body.slice(0, 500)}`,
      );
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
      return terminal(
        `student-info API returned a non-JSON body: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { data?: unknown }).data)
    ) {
      return terminal(
        'student-info API returned an unexpected shape (no "data" array)',
      );
    }
    return success(parsed as GetListStudentInfoResponse);
  }
}
