import * as zlib from 'node:zlib';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
import { PrintPackageService } from './print-package.service';

/**
 * Minimal PKZIP (central-directory) reader — good enough for the fixed-size
 * zips `PrintPackageService.buildPackage` produces via `archiver`, without
 * pulling in a new zip-reading dependency the app itself doesn't need.
 * Handles both STORE (method 0) and DEFLATE (method 8, `archiver`'s
 * default) via Node's own built-in `zlib.inflateRawSync`.
 */
function readZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= 0; i -= 1) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD not found in test zip fixture');
  const entryCount = zipBuf.readUInt16LE(eocdOffset + 10);
  let offset = zipBuf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, Buffer>();
  const CD_SIG = 0x02014b50;
  for (let i = 0; i < entryCount; i += 1) {
    if (zipBuf.readUInt32LE(offset) !== CD_SIG) {
      throw new Error(`bad central directory entry at offset ${offset}`);
    }
    const method = zipBuf.readUInt16LE(offset + 10);
    const compSize = zipBuf.readUInt32LE(offset + 20);
    const nameLen = zipBuf.readUInt16LE(offset + 28);
    const extraLen = zipBuf.readUInt16LE(offset + 30);
    const commentLen = zipBuf.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(offset + 42);
    const name = zipBuf.toString('utf8', offset + 46, offset + 46 + nameLen);

    const lNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const compData = zipBuf.subarray(dataStart, dataStart + compSize);
    const data =
      method === 0 ? Buffer.from(compData) : zlib.inflateRawSync(compData);
    entries.set(name, data);

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

interface FakeEligibilityRow {
  set_id: string;
  status: string;
  current_card_variant_id: string | null;
  fs_file_id: string | null;
  fs_status: string | null;
}

function fakeItemsRepo(
  items: Partial<PrintItem>[],
  eligibilityRows: FakeEligibilityRow[],
  cohortRows: Array<{ id: string; cohort: string | null }>,
) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM campaigns')) return Promise.resolve(cohortRows);
    if (sql.includes('FROM subject_photo_sets'))
      return Promise.resolve(eligibilityRows);
    return Promise.reject(new Error(`unexpected query: ${sql}`));
  });
  return {
    find: jest.fn().mockResolvedValue(items),
    manager: { query },
  };
}

function fakeFileStorage(urlByFileId: Record<string, string>) {
  return {
    issueViewLink: jest.fn((fileId: string) =>
      Promise.resolve({
        url: urlByFileId[fileId] ?? `mock://${fileId}`,
        expiresAt: new Date(),
      }),
    ),
  };
}

function mockFetchByUrl(bodyByUrl: Record<string, Buffer>) {
  return jest.fn((url: string) => {
    const body = bodyByUrl[url];
    if (!body) {
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(Uint8Array.from(body).buffer),
    } as unknown as Response);
  });
}

const BATCH = { id: 'batch-1', code: 'PB-20260925-TEST' } as PrintBatch;

describe('PrintPackageService.buildPackage — 2026-09-25 CENTRALIZED export format change', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('only zips APPROVED sets with a current card variant, names entries {msv}.jpg, converts non-JPEG to real JPEG unchanged in dimensions, disambiguates a duplicate subject_code, and lists only included items in danh-sach-in.xlsx', async () => {
    const items: Partial<PrintItem>[] = [
      {
        id: 'item-a',
        setId: 'set-a',
        subjectCode: 'SV001',
        fullName: 'Nguyen Van A',
        className: 'CNTT1',
        faculty: 'CNTT',
        campaignId: 'camp-1',
      },
      {
        id: 'item-c',
        setId: 'set-c',
        subjectCode: 'SV001', // same subject_code as item-a — must disambiguate
        fullName: 'Nguyen Van C',
        className: 'CNTT2',
        faculty: 'CNTT',
        campaignId: 'camp-1',
      },
      {
        id: 'item-b',
        setId: 'set-b',
        subjectCode: 'SV002',
        fullName: 'Nguyen Van B',
        className: 'CNTT1',
        faculty: 'CNTT',
        campaignId: 'camp-1',
      },
      {
        id: 'item-d',
        setId: 'set-d',
        subjectCode: 'SV004',
        fullName: 'Rejected D',
        campaignId: 'camp-1',
      },
      {
        id: 'item-e',
        setId: 'set-e',
        subjectCode: 'SV005',
        fullName: 'No Variant E',
        campaignId: 'camp-1',
      },
    ];
    const eligibilityRows: FakeEligibilityRow[] = [
      {
        set_id: 'set-a',
        status: 'APPROVED',
        current_card_variant_id: 'var-a',
        fs_file_id: 'file-a',
        fs_status: 'READY',
      },
      {
        set_id: 'set-c',
        status: 'APPROVED',
        current_card_variant_id: 'var-c',
        fs_file_id: 'file-c',
        fs_status: 'READY',
      },
      {
        set_id: 'set-b',
        status: 'APPROVED',
        current_card_variant_id: 'var-b',
        fs_file_id: 'file-b',
        fs_status: 'READY',
      },
      // set-d: photo review REJECTED it after the print item was created —
      // must be excluded even though a current_card_variant_id is still set.
      {
        set_id: 'set-d',
        status: 'REJECTED',
        current_card_variant_id: 'var-d',
        fs_file_id: 'file-d',
        fs_status: 'READY',
      },
      // set-e: APPROVED but never got a current card variant.
      {
        set_id: 'set-e',
        status: 'APPROVED',
        current_card_variant_id: null,
        fs_file_id: null,
        fs_status: null,
      },
    ];
    const cohortRows = [{ id: 'camp-1', cohort: 'K18' }];

    const jpegAlready = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const pngFixture = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    global.fetch = mockFetchByUrl({
      'mock://file-a': jpegAlready,
      'mock://file-c': jpegAlready,
      'mock://file-b': pngFixture,
    }) as never;

    const items_repo = fakeItemsRepo(items, eligibilityRows, cohortRows);
    const fileStorage = fakeFileStorage({});
    const service = new PrintPackageService(
      items_repo as never,
      fileStorage as never,
    );

    const { zip, includedItemIds, failedItemIds } =
      await service.buildPackage(BATCH);

    expect(includedItemIds.sort()).toEqual(
      ['item-a', 'item-b', 'item-c'].sort(),
    );
    expect(failedItemIds.sort()).toEqual(['item-d', 'item-e'].sort());

    const entries = readZipEntries(zip);
    const names = [...entries.keys()].sort();
    expect(names).toEqual(
      ['SV001.jpg', 'SV001_2.jpg', 'SV002.jpg', 'danh-sach-in.xlsx'].sort(),
    );

    // item-a's already-JPEG bytes pass through unchanged (no re-encode).
    expect(entries.get('SV001.jpg')).toEqual(jpegAlready);

    // item-b's PNG must have been converted to a REAL jpeg (magic bytes),
    // not merely relabeled — and must differ from the raw PNG bytes.
    const convertedB = entries.get('SV002.jpg')!;
    expect(convertedB[0]).toBe(0xff);
    expect(convertedB[1]).toBe(0xd8);
    expect(convertedB[2]).toBe(0xff);
    expect(convertedB.equals(pngFixture)).toBe(false);
    // Pixel dimensions preserved through the conversion (no resize).
    const convertedMeta = await sharp(convertedB).metadata();
    expect(convertedMeta.width).toBe(4);
    expect(convertedMeta.height).toBe(4);

    // item-c collided on subject_code with item-a — deterministic suffix.
    expect(entries.get('SV001_2.jpg')).toEqual(jpegAlready);

    // danh-sach-in.xlsx — only the 3 included items, in HEADER_ALIASES-compatible columns.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(entries.get('danh-sach-in.xlsx') as never);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([
      undefined, // exceljs `.values` is 1-indexed, index 0 is empty
      'STT',
      'Mã SV',
      'Họ tên',
      'Lớp',
      'Khoa',
      'Khóa',
      'Tình trạng',
      'Lý do',
    ]);
    expect(sheet.rowCount).toBe(4); // header + 3 included items
    const codes = [2, 3, 4].map((r) => sheet.getRow(r).getCell(2).value);
    expect(codes.sort()).toEqual(['SV001', 'SV001', 'SV002'].sort());
    // Khóa comes from the batched campaigns lookup.
    expect(sheet.getRow(2).getCell(6).value).toBe('K18');
    // Tình trạng/Lý do left blank for the print shop to fill in.
    expect(sheet.getRow(2).getCell(7).value).toBeFalsy();
    expect(sheet.getRow(2).getCell(8).value).toBeFalsy();
    // Dropdown present on the Tình trạng column.
    const dv = sheet.getCell('G2').dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.formulae?.[0]).toContain('Đã in');
    expect(dv?.formulae?.[0]).toContain('In thất bại');
  });

  it('returns an empty-but-valid package (header-only list, no entries) when nothing is eligible', async () => {
    const items: Partial<PrintItem>[] = [
      {
        id: 'item-x',
        setId: 'set-x',
        subjectCode: 'SV009',
        campaignId: 'camp-1',
      },
    ];
    const eligibilityRows: FakeEligibilityRow[] = [
      {
        set_id: 'set-x',
        status: 'PENDING_REVIEW',
        current_card_variant_id: null,
        fs_file_id: null,
        fs_status: null,
      },
    ];
    const items_repo = fakeItemsRepo(items, eligibilityRows, []);
    const service = new PrintPackageService(
      items_repo as never,
      fakeFileStorage({}) as never,
    );

    const { zip, includedItemIds, failedItemIds } =
      await service.buildPackage(BATCH);
    expect(includedItemIds).toEqual([]);
    expect(failedItemIds).toEqual(['item-x']);

    const entries = readZipEntries(zip);
    expect([...entries.keys()]).toEqual(['danh-sach-in.xlsx']);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(entries.get('danh-sach-in.xlsx') as never);
    expect(workbook.worksheets[0].rowCount).toBe(1); // header only
  });
});
