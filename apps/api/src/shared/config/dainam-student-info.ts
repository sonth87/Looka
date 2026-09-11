import { registerAs } from '@nestjs/config';

/**
 * The university's own open API for student directory data
 * (`POST <baseUrl>/api/get_list_student_info`) — see
 * `DainamStudentInfoClient`. Not wired to any caller yet; this only sets up
 * the config the client reads.
 *
 * The key is a real, namespace-wide credential (same posture as
 * `FS_API_KEY` in `file-service.ts`) — it lives only here, read once at
 * startup via `ConfigService`, never echoed back to a client.
 */
export const dainamStudentInfo = registerAs('dainamStudentInfo', () => ({
  baseUrl: process.env.DAINAM_STUDENT_INFO_BASE_URL ?? 'https://openapi.dainam.edu.vn',
  apiKey: process.env.DAINAM_STUDENT_INFO_API_KEY ?? '',
}));
