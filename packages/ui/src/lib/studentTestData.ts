/**
 * Test data backing `lookupStudent()`'s Phase 1 simulation (see
 * `studentLookup.ts`'s own doc comment) — there is no real student
 * directory anywhere in this system yet, so this stands in for one during
 * development/testing. A code in this list resolves FOUND with the given
 * details; anything else resolves NOT_FOUND, so both branches of the
 * "nhập mã sinh viên" flow are exercisable without a real backend.
 *
 * Delete this file in Phase 2, once `lookupStudent()` calls the real
 * `GET /v1/identify/lookup` (docs/plans/multi-camera-device-management-discussion.md
 * §2.3) instead of reading from here — that response shape isn't known yet,
 * so field names here (`className`/`major`/`academicYear`) are a reasonable
 * guess, not a contract to preserve.
 */
export interface TestStudent {
  code: string;
  name: string;
  /** Lớp. */
  className: string;
  /** Chuyên ngành. */
  major: string;
  /** Năm học, e.g. "2025-2026". */
  academicYear: string;
}

export const STUDENT_TEST_DATA: TestStudent[] = [
  { code: 'SV001', name: 'Nguyễn Văn An', className: 'CNTT01', major: 'Công nghệ thông tin', academicYear: '2025-2026' },
  { code: 'SV002', name: 'Trần Thị Bình', className: 'CNTT01', major: 'Công nghệ thông tin', academicYear: '2025-2026' },
  { code: 'SV003', name: 'Lê Hoàng Cường', className: 'KTPM02', major: 'Kỹ thuật phần mềm', academicYear: '2025-2026' },
  { code: 'SV004', name: 'Phạm Thị Dung', className: 'KTPM02', major: 'Kỹ thuật phần mềm', academicYear: '2025-2026' },
  { code: 'SV005', name: 'Hoàng Văn Em', className: 'ATTT01', major: 'An toàn thông tin', academicYear: '2024-2025' },
  { code: 'SV006', name: 'Đỗ Thị Giang', className: 'ATTT01', major: 'An toàn thông tin', academicYear: '2024-2025' },
  { code: 'SV007', name: 'Vũ Minh Hải', className: 'KHMT03', major: 'Khoa học máy tính', academicYear: '2024-2025' },
  { code: 'SV008', name: 'Bùi Thị Kim', className: 'KHMT03', major: 'Khoa học máy tính', academicYear: '2024-2025' },
  { code: 'SV009', name: 'Ngô Văn Long', className: 'HTTT01', major: 'Hệ thống thông tin', academicYear: '2023-2024' },
  { code: 'SV010', name: 'Đặng Thị Mai', className: 'HTTT01', major: 'Hệ thống thông tin', academicYear: '2023-2024' },
];
