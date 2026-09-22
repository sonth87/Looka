import { Repository } from 'typeorm';
import { inflateRawSync } from 'node:zlib';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { SessionService } from '@app/modules/capture/services/session.service';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';
import { Campaign } from '../entities/campaign.entity';
import { Device } from '../entities/device.entity';
import { CampaignService } from './campaign.service';

/**
 * Unit test for `CampaignService.exportApprovedPhotos` (Phase F.4,
 * docs/plans/card-photo-export-and-filters-plan-2026-09-17.md) — everything
 * is a plain fake object (repository/dataSource/fileStorage), same
 * "fake typed as a plain shape" convention
 * `campaign-eligibility-credential.util.spec.ts` already uses, rather than a
 * `Test.createTestingModule` + real Postgres (like
 * `device-management-persistence.spec.ts`) — no `TEST_DATABASE_URL` is
 * required to run this. `global.fetch` is stubbed instead of hitting
 * file-storage/network for real.
 *
 * A minimal ZIP central-directory reader is included at the bottom purely
 * to assert on the produced buffer's contents — no new dependency added.
 */

interface ZipEntry {
  fileName: string;
  data: Buffer;
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD not found — not a valid zip');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x02014b50) {
      throw new Error(`bad central directory entry signature at ${offset}`);
    }
    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraFieldLength = buf.readUInt16LE(offset + 30);
    const fileCommentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.toString(
      'utf8',
      offset + 46,
      offset + 46 + fileNameLength,
    );

    const lhSig = buf.readUInt32LE(localHeaderOffset);
    if (lhSig !== 0x04034b50) {
      throw new Error(
        `bad local file header signature at ${localHeaderOffset}`,
      );
    }
    const lhFileNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraFieldLength = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + lhFileNameLength + lhExtraFieldLength;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);
    const data =
      compressionMethod === 0
        ? Buffer.from(compressedData)
        : inflateRawSync(compressedData);

    entries.push({ fileName, data });
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

describe('CampaignService.exportApprovedPhotos', () => {
  const CAMPAIGN = { id: 'campaign-1', code: 'CMP-TEST01' } as Campaign;

  const ROSTER_ROWS = [
    {
      subject_code: 'SV001',
      full_name: 'Nguyen Van A',
      citizen_id: '001234567890',
      class_name: 'CNTT1',
      faculty: 'CNTT',
      major: 'Khoa hoc may tinh',
      status: 'VALID',
    },
    {
      subject_code: 'SV002',
      full_name: 'Tran Thi B',
      citizen_id: '001234567891',
      class_name: 'CNTT1',
      faculty: 'CNTT',
      major: 'Khoa hoc may tinh',
      status: 'VALID',
    },
    // Deliberately not APPROVED/not even capturable — the roster CSV must
    // still include it (it's the campaign's full roster, not a photo list).
    {
      subject_code: 'SV003',
      full_name: 'Le Van C',
      citizen_id: null,
      class_name: 'CNTT2',
      faculty: 'CNTT',
      major: null,
      status: 'ERROR',
    },
  ];

  const APPROVED_ROWS = [
    {
      subject_code: 'SV001',
      full_name: 'Nguyen Van A',
      class_name: 'CNTT1',
      faculty: 'CNTT',
      approved_at: new Date('2026-09-17T08:00:00.000Z'),
      fs_file_id: 'fs-file-sv001',
    },
    {
      subject_code: 'SV002',
      full_name: 'Tran Thi B',
      class_name: 'CNTT1',
      faculty: 'CNTT',
      approved_at: new Date('2026-09-17T09:00:00.000Z'),
      fs_file_id: 'fs-file-sv002',
    },
  ];

  const PHOTO_BYTES: Record<string, Buffer> = {
    'fs-file-sv001': Buffer.from('fake-jpeg-bytes-sv001'),
    'fs-file-sv002': Buffer.from('fake-jpeg-bytes-sv002'),
  };

  function buildService() {
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(CAMPAIGN),
    } as unknown as Repository<Campaign>;
    const deviceRepository = {} as unknown as Repository<Device>;
    const dataSource = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM campaign_subjects')) {
          return Promise.resolve(ROSTER_ROWS);
        }
        if (sql.includes('FROM subject_photo_sets')) {
          return Promise.resolve(APPROVED_ROWS);
        }
        throw new Error(`unexpected query in test: ${sql}`);
      }),
    };
    const sessionService = {} as unknown as SessionService;
    const workflowCatalog = {} as unknown as WorkflowCatalogReadRepository;
    const fileStorage = {
      issueViewLink: jest.fn((fileId: string) =>
        Promise.resolve({ url: `https://fs.local/${fileId}` }),
      ),
    } as unknown as FileStorageService;

    const service = new CampaignService(
      repository,
      deviceRepository,
      dataSource as never,
      sessionService,
      workflowCatalog,
      fileStorage,
      {
        withLock: jest.fn(async (_name: string, fn: () => Promise<void>) => {
          await fn();
          return true;
        }),
      } as never,
    );
    return { service, dataSource, fileStorage };
  }

  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn((url: string) => {
      const fileId = url.split('/').pop() as string;
      const bytes = PHOTO_BYTES[fileId];
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
          ),
      } as unknown as Response);
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('zips a full roster CSV (every row, any status) + an approved-only photos CSV + one {subjectCode}.jpg per approved set', async () => {
    const { service } = buildService();

    const { zip, filename } = await service.exportApprovedPhotos('campaign-1');

    expect(filename).toBe('campaign-CMP-TEST01-approved-photos.zip');

    const entries = readZipEntries(zip);
    const byName = new Map(entries.map((e) => [e.fileName, e]));

    // --- roster CSV: every row, regardless of status ---
    const rosterCsv = byName.get('danh-sach-sinh-vien.csv');
    expect(rosterCsv).toBeDefined();
    const rosterLines = rosterCsv!.data.toString('utf8').split('\n');
    expect(rosterLines[0]).toBe(
      'subjectCode,fullName,citizenId,className,faculty,major,status',
    );
    expect(rosterLines).toHaveLength(4); // header + 3 rows
    expect(
      rosterLines.some((l) => l.includes('SV001') && l.endsWith('VALID')),
    ).toBe(true);
    expect(
      rosterLines.some((l) => l.includes('SV002') && l.endsWith('VALID')),
    ).toBe(true);
    // SV003 (status=ERROR, never approved/photographed) still shows up —
    // this is the roster list, not a photo list.
    expect(
      rosterLines.some((l) => l.includes('SV003') && l.endsWith('ERROR')),
    ).toBe(true);

    // --- approved-photos CSV: only APPROVED sets ---
    const approvedCsv = byName.get('danh-sach-anh-da-duyet.csv');
    expect(approvedCsv).toBeDefined();
    const approvedLines = approvedCsv!.data.toString('utf8').split('\n');
    expect(approvedLines[0]).toBe(
      'subjectCode,fullName,className,faculty,approvedAt,fileName',
    );
    expect(approvedLines).toHaveLength(3); // header + 2 approved rows only
    expect(approvedLines.some((l) => l.includes('"SV001.jpg"'))).toBe(true);
    expect(approvedLines.some((l) => l.includes('"SV002.jpg"'))).toBe(true);
    // SV003 never appears in the approved list at all.
    expect(approvedLines.some((l) => l.includes('SV003'))).toBe(false);

    // --- one {subjectCode}.jpg per approved set, correct bytes ---
    const sv001Jpg = byName.get('SV001.jpg');
    const sv002Jpg = byName.get('SV002.jpg');
    expect(sv001Jpg).toBeDefined();
    expect(sv002Jpg).toBeDefined();
    expect(sv001Jpg!.data.equals(PHOTO_BYTES['fs-file-sv001'])).toBe(true);
    expect(sv002Jpg!.data.equals(PHOTO_BYTES['fs-file-sv002'])).toBe(true);
    // No jpg for SV003 — it was never approved.
    expect(byName.has('SV003.jpg')).toBe(false);

    // Exactly 4 entries total: 2 CSVs + 2 jpgs.
    expect(entries).toHaveLength(4);
  });

  it('skips (but does not fail) an approved set whose file download fails, and still lists it in the CSV', async () => {
    const { service, fileStorage } = buildService();
    (fileStorage.issueViewLink as jest.Mock).mockImplementation(
      (fileId: string) =>
        fileId === 'fs-file-sv002'
          ? Promise.reject(new Error('file-service unreachable'))
          : Promise.resolve({ url: `https://fs.local/${fileId}` }),
    );

    const { zip } = await service.exportApprovedPhotos('campaign-1');
    const entries = readZipEntries(zip);
    const byName = new Map(entries.map((e) => [e.fileName, e]));

    expect(byName.has('SV001.jpg')).toBe(true);
    expect(byName.has('SV002.jpg')).toBe(false);
    const approvedCsv = byName.get('danh-sach-anh-da-duyet.csv')!;
    // The CSV row still lists SV002 with its expected filename even though
    // the actual bytes could not be fetched — the CSV always reflects
    // "who is APPROVED", independent of a transient file-storage failure.
    expect(approvedCsv.data.toString('utf8')).toContain('"SV002.jpg"');
  });
});
