import ExcelJS from 'exceljs';
import { PrintItem } from '../entities/print-item.entity';
import { PrintPackageService } from './print-package.service';
import { PrintResultImportService } from './print-result-import.service';

interface ParsedResultRow {
  rowNo: number;
  subjectCode: string | null;
  printStatus: string | null;
  errorReason: string | null;
}

/** Narrow, typed access to the two private methods under test — same reflection-cast convention already used across this module's specs for exercising internals without a full DI setup. */
type PackageServiceInternals = {
  buildResultListWorkbook: (
    items: PrintItem[],
    cohortByCampaignId: Map<string, string | null>,
  ) => Promise<Buffer>;
};
type ImportServiceInternals = {
  parseWorkbook: (buffer: Buffer) => Promise<ParsedResultRow[]>;
};

/**
 * Round-trip check for the 2026-09-25 product decision: `danh-sach-in.xlsx`
 * (built by `PrintPackageService` for "Xuất gói") must use the exact same
 * header names `PrintResultImportService.HEADER_ALIASES` recognizes, so a
 * print shop can fill it in (Tình trạng/Lý do) and upload it straight back
 * through `POST /v1/print/batches/:id/result-imports` with no reformatting.
 * This never touches the DB/transaction side of either service — only the
 * xlsx-build ↔ xlsx-parse contract between them.
 */
describe('danh-sach-in.xlsx round-trip: PrintPackageService build → PrintResultImportService parse', () => {
  it('recognizes Mã SV / Tình trạng / Lý do for a filled-in "Đã in" row and a filled-in "In thất bại" + reason row', async () => {
    const packageService = new PrintPackageService(
      undefined as never,
      undefined as never,
    );
    const importService = new PrintResultImportService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    const items = [
      {
        subjectCode: 'SV001',
        fullName: 'Nguyen Van A',
        className: 'CNTT1',
        faculty: 'CNTT',
        campaignId: 'camp-1',
      },
      {
        subjectCode: 'SV002',
        fullName: 'Nguyen Van B',
        className: 'CNTT1',
        faculty: 'CNTT',
        campaignId: 'camp-1',
      },
    ] as PrintItem[];
    const cohortByCampaignId = new Map<string, string | null>([
      ['camp-1', 'K18'],
    ]);

    const exportBuffer = await (
      packageService as unknown as PackageServiceInternals
    ).buildResultListWorkbook(items, cohortByCampaignId);

    // Simulate the print shop filling in the downloaded file: row 2 (SV001)
    // marked "Đã in", row 3 (SV002) marked "In thất bại" with a reason.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportBuffer as never);
    const sheet = workbook.worksheets[0];
    sheet.getCell('G2').value = 'Đã in';
    sheet.getCell('G3').value = 'In thất bại';
    sheet.getCell('H3').value = 'Kẹt giấy';
    const filledBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const rows = await (
      importService as unknown as ImportServiceInternals
    ).parseWorkbook(filledBuffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      printStatus: 'Đã in',
      errorReason: null,
    });
    expect(rows[1]).toMatchObject({
      subjectCode: 'SV002',
      printStatus: 'In thất bại',
      errorReason: 'Kẹt giấy',
    });
  });

  it("buildTemplate()'s own headers are also recognized (Mã SV / Tình trạng / Lý do, now matching the export)", async () => {
    const importService = new PrintResultImportService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    const templateBuffer = await importService.buildTemplate();
    const rows = await (
      importService as unknown as ImportServiceInternals
    ).parseWorkbook(templateBuffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      printStatus: 'Đã in',
    });
    expect(rows[1]).toMatchObject({
      subjectCode: 'SV002',
      printStatus: 'In thất bại',
      errorReason: 'Kẹt giấy',
    });
  });
});
