import ExcelJS from 'exceljs';
import { CampaignSubjectService } from './campaign-subject.service';

/**
 * `parseWorkbook()`'s header-NAME matching (2026-09-18,
 * docs/plans/roster-import-header-matching-plan-2026-09-17.md) — the real
 * bug this fixes: a real file from a partner faculty ("14.09.26 - Copy.xlsx",
 * shared via SharePoint) has an extra `STT` column, no CCCD/Ngành, and
 * Năm sinh/Lớp/Khoa in a different order than `ROSTER_COLUMNS` — the OLD
 * positional reader would have silently mapped a birth-date column into
 * `citizenId` with no error at all. These tests build real in-memory
 * `.xlsx` buffers (via `exceljs`, the same library the service itself
 * parses with) rather than mocking `parseWorkbook` away, since the method
 * under test IS the parsing logic this time.
 */
function buildService() {
  return new CampaignSubjectService(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

async function buildWorkbookBuffer(
  headerRow: string[],
  dataRows: Array<Array<string | number | Date | null>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roster');
  sheet.addRow(headerRow);
  for (const row of dataRows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function parse(service: CampaignSubjectService, buffer: Buffer) {
  return (
    service as unknown as {
      parseWorkbook: (b: Buffer) => Promise<
        Array<{
          rowNo: number;
          subjectCode: string | null;
          fullName: string | null;
          citizenId: string | null;
          className: string | null;
          faculty: string | null;
          major: string | null;
          dateOfBirth: string | null;
          cardValidUntil: string | null;
          extra: Record<string, unknown> | null;
        }>
      >;
    }
  ).parseWorkbook(buffer);
}

describe('CampaignSubjectService.parseWorkbook — header-name matching (2026-09-18)', () => {
  it('reads the canonical ROSTER_COLUMNS template unchanged (regression)', async () => {
    const buffer = await buildWorkbookBuffer(
      [
        'Mã SV',
        'Họ tên',
        'CCCD',
        'Lớp',
        'Khoa',
        'Ngành',
        'Ngày sinh (yyyy-mm-dd)',
        'Thời hạn thẻ (yyyy-mm-dd)',
      ],
      [
        [
          'SV001',
          'Nguyễn Văn A',
          '012345678',
          'CNTT-K20',
          'CNTT',
          'KTPM',
          '2005-01-01',
          '2029-01-01',
        ],
      ],
    );
    const rows = await parse(buildService(), buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      fullName: 'Nguyễn Văn A',
      citizenId: '012345678',
      className: 'CNTT-K20',
      faculty: 'CNTT',
      major: 'KTPM',
    });
  });

  it('reads the real partner-faculty layout (STT/MSSV/HỌ VÀ TÊN SINH VIÊN/Năm sinh/Lớp/KHOA/Niên khoá) correctly, ignoring STT', async () => {
    const buffer = await buildWorkbookBuffer(
      [
        'STT',
        'MSSV',
        'HỌ VÀ TÊN SINH VIÊN',
        'Năm sinh',
        'Lớp',
        'KHOA',
        'Niên khoá',
      ],
      [
        [
          1,
          '1777020640',
          'HÀ ÁNH THỦY',
          '04/12/2005',
          'TT 18-07',
          'NN và VH Trung Quốc',
          '30-06-2028',
        ],
      ],
    );
    const rows = await parse(buildService(), buffer);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.subjectCode).toBe('1777020640');
    expect(row.fullName).toBe('HÀ ÁNH THỦY');
    expect(row.className).toBe('TT 18-07');
    expect(row.faculty).toBe('NN và VH Trung Quốc');
    // Not silently misassigned into citizenId/major — the old positional bug.
    expect(row.citizenId).toBeNull();
    expect(row.major).toBeNull();
    expect(row.dateOfBirth).not.toBeNull();
    expect(row.cardValidUntil).not.toBeNull();
    // STT must not leak into `extra` — it carries no information.
    expect(row.extra).toBeNull();
  });

  it('rejects a file with no column matching a required field (Mã SV/Họ tên), before reading any row', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Lớp', 'Khoa'],
      [['CNTT-K20', 'CNTT']],
    );
    await expect(parse(buildService(), buffer)).rejects.toThrow(/Mã SV/);
  });

  it('an unrecognized column still falls into `extra`, unchanged from before', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Mã SV', 'Họ tên', 'Ghi chú nội bộ'],
      [['SV002', 'Trần Thị B', 'Diện chính sách']],
    );
    const rows = await parse(buildService(), buffer);
    expect(rows[0].extra).toEqual({ 'Ghi chú nội bộ': 'Diện chính sách' });
  });

  it('parses Vietnamese dd/mm/yyyy and dd-mm-yyyy dates correctly, not as US mm/dd/yyyy (2026-09-18 fix)', async () => {
    const buffer = await buildWorkbookBuffer(
      [
        'Mã SV',
        'Họ tên',
        'Ngày sinh (yyyy-mm-dd)',
        'Thời hạn thẻ (yyyy-mm-dd)',
      ],
      [['SV004', 'Phạm Thị D', '04/12/2005', '30-06-2028']],
    );
    const rows = await parse(buildService(), buffer);
    // 04/12/2005 means 4 Dec 2005 in Vietnamese dd/mm/yyyy — NOT 12 Apr 2005
    // (US mm/dd/yyyy), which is what a bare `new Date(...)` would silently
    // produce.
    expect(rows[0].dateOfBirth).toBe('2005-12-04');
    expect(rows[0].cardValidUntil).toBe('2028-06-30');
  });

  it('column order does not matter — same data, header order reversed', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Khoa', 'Lớp', 'Họ tên', 'Mã SV'],
      [['CNTT', 'CNTT-K20', 'Lê Văn C', 'SV003']],
    );
    const rows = await parse(buildService(), buffer);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV003',
      fullName: 'Lê Văn C',
      className: 'CNTT-K20',
      faculty: 'CNTT',
    });
  });
});
