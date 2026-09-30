import ExcelJS from 'exceljs';
import { PrintItem } from '../entities/print-item.entity';
import { PrintPackageService } from './print-package.service';
import { PrintResultImportService } from './print-result-import.service';

interface ParsedResultRow {
  rowNo: number;
  subjectCode: string | null;
  printStatus: string | null;
  errorReason: string | null;
  cardCode: string | null;
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
 * print shop can fill it in (Tình trạng/Mã thẻ/Lý do) and upload it straight back
 * through `POST /v1/print/batches/:id/result-imports` with no reformatting.
 * This never touches the DB/transaction side of either service — only the
 * xlsx-build ↔ xlsx-parse contract between them.
 */
describe('danh-sach-in.xlsx round-trip: PrintPackageService build → PrintResultImportService parse', () => {
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

  function parse(buffer: Buffer): Promise<ParsedResultRow[]> {
    return (importService as unknown as ImportServiceInternals).parseWorkbook(
      buffer,
    );
  }

  /** Builds a real `danh-sach-in.xlsx` for `subjectCodes`, hands back the loaded workbook so a test can play the print shop and fill cells in. */
  async function exportedWorkbook(subjectCodes: string[]) {
    const items = subjectCodes.map((subjectCode) => ({
      subjectCode,
      fullName: `Name ${subjectCode}`,
      className: 'CNTT1',
      faculty: 'CNTT',
      campaignId: 'camp-1',
    })) as PrintItem[];
    const exportBuffer = await (
      packageService as unknown as PackageServiceInternals
    ).buildResultListWorkbook(items, new Map([['camp-1', 'K18']]));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportBuffer as never);
    return workbook;
  }

  async function saved(workbook: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it('recognizes Mã SV / Tình trạng / Mã thẻ / Lý do for a filled-in "Đã in" row (with a card code) and a filled-in "In thất bại" + reason row', async () => {
    const workbook = await exportedWorkbook(['SV001', 'SV002']);

    // Simulate the print shop filling in the downloaded file: row 2 (SV001)
    // marked "Đã in" with a card code, row 3 (SV002) marked "In thất bại"
    // with a reason. Columns: G Tình trạng, H Mã thẻ, I Lý do.
    const sheet = workbook.worksheets[0];
    sheet.getCell('G2').value = 'Đã in';
    sheet.getCell('H2').value = 'TH-000123';
    sheet.getCell('G3').value = 'In thất bại';
    sheet.getCell('I3').value = 'Kẹt giấy';

    const rows = await parse(await saved(workbook));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      printStatus: 'Đã in',
      cardCode: 'TH-000123',
      errorReason: null,
    });
    expect(rows[1]).toMatchObject({
      subjectCode: 'SV002',
      printStatus: 'In thất bại',
      cardCode: null,
      errorReason: 'Kẹt giấy',
    });
  });

  it('a filled-in "Đã in" row WITHOUT a card code still parses (the code is optional — cardCode is null, not an error)', async () => {
    const workbook = await exportedWorkbook(['SV001']);
    workbook.worksheets[0].getCell('G2').value = 'Đã in';

    const rows = await parse(await saved(workbook));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      printStatus: 'Đã in',
      cardCode: null,
    });
  });

  it('a card code typed as TEXT keeps its leading zeros, and is trimmed', async () => {
    const workbook = await exportedWorkbook(['SV001']);
    const sheet = workbook.worksheets[0];
    sheet.getCell('G2').value = 'Đã in';
    // The exported column is Text-formatted, so Excel stores "00123" as text.
    sheet.getCell('H2').value = '  00123  ';

    const rows = await parse(await saved(workbook));

    expect(rows[0].cardCode).toBe('00123');
  });

  it('a card code stored as a NUMBER cell becomes a plain digit string (no scientific notation, no trailing .0)', async () => {
    const workbook = await exportedWorkbook(['SV001', 'SV002', 'SV003']);
    const sheet = workbook.worksheets[0];
    sheet.getCell('G2').value = 'Đã in';
    sheet.getCell('H2').value = 123456;
    sheet.getCell('G3').value = 'Đã in';
    sheet.getCell('H3').value = 1e21; // String(1e21) === "1e+21"
    sheet.getCell('G4').value = 'Đã in';
    sheet.getCell('H4').value = 5.0; // JS has no ".0", but pin that it never appears

    const rows = await parse(await saved(workbook));

    expect(rows.map((r) => r.cardCode)).toEqual([
      '123456',
      '1000000000000000000000',
      '5',
    ]);
  });

  it('a card code in a rich-text cell is read (not silently dropped as empty)', async () => {
    const workbook = await exportedWorkbook(['SV001']);
    const sheet = workbook.worksheets[0];
    sheet.getCell('G2').value = 'Đã in';
    sheet.getCell('H2').value = {
      richText: [
        { text: 'TH-', font: { bold: true } },
        { text: '0042', font: { italic: true } },
      ],
    };

    const rows = await parse(await saved(workbook));

    expect(rows[0].cardCode).toBe('TH-0042');
  });

  it.each([
    'Mã thẻ',
    'Ma the',
    'MÃ THẺ',
    'Số thẻ',
    'so the',
    'Mã số thẻ',
    'MA SO THE',
  ])(
    'header alias %j is recognized as the card-code column (accent/case-insensitive)',
    async (header) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Ket qua in');
      sheet.addRow(['Mã SV', 'Tình trạng', header]);
      sheet.addRow(['SV001', 'Đã in', 'TH0001']);

      const rows = await parse(await saved(workbook));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        subjectCode: 'SV001',
        cardCode: 'TH0001',
      });
    },
  );

  it('a file exported BEFORE the Mã thẻ column existed (Mã SV / Tình trạng / Lý do only) still parses exactly as before', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh sach in');
    sheet.addRow([
      'STT',
      'Mã SV',
      'Họ tên',
      'Lớp',
      'Khoa',
      'Khóa',
      'Tình trạng',
      'Lý do',
    ]);
    sheet.addRow([
      1,
      'SV001',
      'Nguyen Van A',
      'CNTT1',
      'CNTT',
      'K18',
      'Đã in',
      '',
    ]);
    sheet.addRow([
      2,
      'SV002',
      'Nguyen Van B',
      'CNTT1',
      'CNTT',
      'K18',
      'In thất bại',
      'Kẹt giấy',
    ]);

    const rows = await parse(await saved(workbook));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      printStatus: 'Đã in',
      errorReason: null,
      cardCode: null,
    });
    expect(rows[1]).toMatchObject({
      subjectCode: 'SV002',
      printStatus: 'In thất bại',
      errorReason: 'Kẹt giấy',
      cardCode: null,
    });
  });

  it("buildTemplate()'s own headers are also recognized (Mã SV / Tình trạng / Mã thẻ / Lý do, matching the export)", async () => {
    const templateBuffer = await importService.buildTemplate();

    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(templateBuffer as never);
    expect(templateWorkbook.worksheets[0].getRow(1).values).toEqual([
      undefined, // exceljs `.values` is 1-indexed, index 0 is empty
      'Mã SV',
      'Tình trạng',
      'Mã thẻ',
      'Lý do',
    ]);

    const rows = await parse(templateBuffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      subjectCode: 'SV001',
      printStatus: 'Đã in',
      cardCode: 'TH0001',
    });
    expect(rows[1]).toMatchObject({
      subjectCode: 'SV002',
      printStatus: 'In thất bại',
      cardCode: null,
      errorReason: 'Kẹt giấy',
    });
  });
});
