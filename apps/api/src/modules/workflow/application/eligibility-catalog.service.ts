import { Injectable } from '@nestjs/common';
import { DainamStudentInfoClient } from '@app/shared/integrations/dainam-student/student-directory.adapter';
import { EligibilityApiClientReadModel } from './queries/read-model/eligibility-api-client.read-model';

export interface TestLookupResult {
  success: boolean;
  message: string | null;
  sampleRecord: Record<string, unknown> | null;
}

/**
 * Finally wires `DainamStudentInfoClient` to a real caller —
 * cms-8-screens-api-plan.md §2.2's "điều kiện tiếp nhận" screen needs a
 * way to show a workflow author which external API/field they can pick
 * for `eligibility.api.{clientCode,keyField,requiredFields}`
 * (`GET /v1/eligibility/api-clients`), and a way to try one real lookup so
 * they can see the actual field names before wiring a rule to them
 * (`POST /v1/eligibility/test-lookup`). That adapter's own doc comment
 * says "Not wired to any caller yet" (2026-09-10) — this is that caller,
 * scoped to exactly "let a human see what fields exist", not to actual
 * rule EVALUATION against real students (P3 scope, once
 * `campaign_subjects`/`eligibility_check_logs` exist).
 *
 * Only one client exists today (`DAINAM_STUDENT_INFO`) — the list is a
 * literal array, not a DB catalog: a genuine registry only makes sense
 * once a second integration exists to register alongside it.
 */
@Injectable()
export class EligibilityCatalogService {
  constructor(private readonly dainamClient: DainamStudentInfoClient) {}

  listClients(): EligibilityApiClientReadModel[] {
    return [
      {
        code: 'DAINAM_STUDENT_INFO',
        name: 'API sinh viên Đại Nam (openapi.dainam.edu.vn)',
        fields: [
          'student_id',
          'student_code',
          'full_name',
          'user_code',
          'identity_number',
          'class_name',
          'major_name',
          'faculty_name',
          'course_year',
          'status',
        ],
      },
    ];
  }

  async testLookup(clientCode: string, key: string): Promise<TestLookupResult> {
    if (clientCode !== 'DAINAM_STUDENT_INFO') {
      return {
        success: false,
        message: `Không rõ client "${clientCode}".`,
        sampleRecord: null,
      };
    }

    const outcome = await this.dainamClient.getListStudentInfo({
      studentCode: key,
    });
    // `outcome.kind !== 'Success'` (a literal discriminant check) rather
    // than `!isSuccess(outcome)` — TypeScript narrows a discriminated
    // union reliably on the literal tag but did not narrow through the
    // imported type-predicate function here.
    if (outcome.kind !== 'Success') {
      return { success: false, message: outcome.reason, sampleRecord: null };
    }
    const record = outcome.value.data[0];
    if (!record) {
      return {
        success: true,
        message: 'Tra cứu thành công nhưng không có dữ liệu cho mã này.',
        sampleRecord: null,
      };
    }
    return { success: true, message: null, sampleRecord: record };
  }
}
