import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { Pagination } from '@app/modules/shared/common/pagination';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  CampaignStudentRosterDao,
  RosterImportResultDao,
  RosterLookupResultDao,
} from '../dao';
import { ListCampaignStudentRosterQueryDto } from '../dto/list-campaign-student-roster-query.dto';
import { UpdateCampaignStudentRosterRowDto } from '../dto/update-campaign-student-roster-row.dto';
import { CampaignStudentRoster } from '../entities/campaign-student-roster.entity';
import { normalizeHeaderCell, parseCsv } from '../utils/csv.util';
import { CampaignService } from './campaign.service';

/** Header aliases a roster CSV column is matched against — see `normalizeHeaderCell` for how a raw header cell becomes one of these tokens. Order within each list doesn't matter; first match wins per column. */
const STUDENT_CODE_HEADERS = ['studentcode', 'masv', 'ma', 'code'];
const STUDENT_NAME_HEADERS = ['studentname', 'hoten', 'hovaten', 'name', 'ten'];
const CITIZEN_ID_HEADERS = ['citizenid', 'cccd', 'socccd', 'idnumber', 'id'];
const CLASS_NAME_HEADERS = ['classname', 'lop'];
const MAJOR_HEADERS = ['major', 'nganh', 'chuyennganh'];
const ACADEMIC_YEAR_HEADERS = ['academicyear', 'namhoc', 'khoahoc'];

interface ColumnMap {
  studentCode: number;
  studentName: number;
  citizenId: number;
  className: number | null;
  major: number | null;
  academicYear: number | null;
}

function findColumn(headerRow: string[], candidates: string[]): number {
  const normalized = headerRow.map(normalizeHeaderCell);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * "Sinh viên dự kiến" — a campaign's expected-student roster
 * (2026-09-09, CCCD-scan capture-identification feature). See
 * `CampaignStudentRoster` entity's own doc comment for what this table is
 * and how the kiosk uses it. A genuine CRUD resource (like
 * `CaptureConfigurationService`, unlike `CaptureAnglePresetService`'s
 * `active`-flag soft delete): a bad import row is fixed by editing/deleting
 * it outright, not by soft-deleting and re-adding.
 */
@Injectable()
export class CampaignStudentRosterService extends CommonService<CampaignStudentRoster> {
  constructor(
    @InjectRepository(CampaignStudentRoster)
    repository: Repository<CampaignStudentRoster>,
    private readonly campaignService: CampaignService,
  ) {
    super(repository);
  }

  async listRoster(
    campaignId: string,
    query: ListCampaignStudentRosterQueryDto,
  ): Promise<Pagination<CampaignStudentRosterDao>> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const q = query.q?.trim();

    const result = await this.paginate(
      { page, limit },
      {
        where: q
          ? [
              { campaignId, studentCode: ILike(`%${q}%`) },
              { campaignId, studentName: ILike(`%${q}%`) },
              { campaignId, citizenId: ILike(`%${q}%`) },
            ]
          : { campaignId },
        order: { createdAt: 'DESC' },
      },
    );

    return new Pagination(toDao(CampaignStudentRosterDao, result.items), result.meta);
  }

  async findRowEntityOrFail(
    campaignId: string,
    rowId: string,
  ): Promise<CampaignStudentRoster> {
    const row = await this.repository.findOne({ where: { id: rowId, campaignId } });
    if (!row) {
      throw new CustomException(
        'Campaign student roster row not found',
        ERROR_CODE.CAMPAIGN_STUDENT_ROSTER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  async updateRow(
    campaignId: string,
    rowId: string,
    dto: UpdateCampaignStudentRosterRowDto,
  ): Promise<CampaignStudentRosterDao> {
    const row = await this.findRowEntityOrFail(campaignId, rowId);

    if (dto.citizenId !== undefined) {
      const citizenId = dto.citizenId.trim();
      const clash = await this.repository.findOne({ where: { campaignId, citizenId } });
      if (clash && clash.id !== rowId) {
        throw new CustomException(
          'Another roster row in this campaign already uses this citizen id',
          ERROR_CODE.CAMPAIGN_STUDENT_ROSTER_CITIZEN_ID_TAKEN,
          HttpStatus.CONFLICT,
        );
      }
      row.citizenId = citizenId;
    }
    if (dto.studentCode !== undefined) row.studentCode = dto.studentCode.trim();
    if (dto.studentName !== undefined) row.studentName = dto.studentName.trim();
    if (dto.className !== undefined) row.className = dto.className.trim() || null;
    if (dto.major !== undefined) row.major = dto.major.trim() || null;
    if (dto.academicYear !== undefined) row.academicYear = dto.academicYear.trim() || null;

    await this.save(row);
    return toDao(CampaignStudentRosterDao, row);
  }

  async deleteRow(campaignId: string, rowId: string): Promise<void> {
    await this.findRowEntityOrFail(campaignId, rowId);
    await this.delete(rowId);
  }

  /** Wipes the whole roster — e.g. an import went to the wrong campaign, or a semester's roster needs replacing wholesale rather than upserted row-by-row. */
  async clearRoster(campaignId: string): Promise<{ removed: number }> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const result = await this.repository.delete({ campaignId });
    return { removed: result.affected ?? 0 };
  }

  /**
   * `GET /v1/campaigns/:id/roster/lookup?citizenId=...` — the kiosk's own
   * call once `cccdWatcher.ts` reports a freshly scanned CCCD number.
   * `found: false` is the normal "no match" outcome, not thrown as a 404 —
   * the kiosk's NOT_FOUND branch (block capture, show the required message
   * on both screens) is driven entirely off this boolean, never off a
   * caught error, so a transient network/API failure and a genuine
   * no-match are never confused with each other on the caller's side (see
   * `FaceCaptureApp.tsx`'s `handleCccdScan`).
   */
  async lookupByCitizenId(
    campaignId: string,
    citizenId: string,
  ): Promise<RosterLookupResultDao> {
    const trimmed = citizenId.trim();
    if (!trimmed) return { found: false };

    const row = await this.repository.findOne({ where: { campaignId, citizenId: trimmed } });
    if (!row) return { found: false };

    return {
      found: true,
      studentCode: row.studentCode,
      studentName: row.studentName,
      className: row.className ?? undefined,
      major: row.major ?? undefined,
      academicYear: row.academicYear ?? undefined,
      citizenId: row.citizenId,
    };
  }

  /**
   * `POST /v1/campaigns/:id/roster/import` (multipart CSV, admin-only) —
   * bulk-populates the roster. Header row required; column order is
   * flexible (matched by name via `normalizeHeaderCell`, so "Mã SV" /
   * "ma_sv" / "studentCode" are all accepted) — `studentCode`/`studentName`/
   * `citizenId` are required columns, `className`/`major`/`academicYear`
   * optional (display-only, see the entity's own doc comment).
   *
   * Upserts by `(campaignId, citizenId)`: re-uploading a corrected CSV (the
   * realistic "fix a typo and re-import" workflow for hundreds of rows)
   * simply updates the existing row for that CCCD rather than duplicating
   * it — the alternative, clearing the whole roster before every import,
   * would silently discard any row fixed individually via
   * `PATCH .../roster/:rowId` in between imports.
   *
   * A single bad row (missing/blank required field) is skipped and reported
   * in `errors`, not a reason to fail the whole batch — an admin pasting a
   * few hundred rows from a spreadsheet should not have to fix every issue
   * before any of it lands.
   */
  async importRoster(campaignId: string, csvText: string): Promise<RosterImportResultDao> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const rows = parseCsv(csvText);
    if (rows.length === 0) {
      return { totalRows: 0, imported: 0, errors: [] };
    }

    const [headerRow, ...dataRows] = rows;
    const columns: ColumnMap = {
      studentCode: findColumn(headerRow, STUDENT_CODE_HEADERS),
      studentName: findColumn(headerRow, STUDENT_NAME_HEADERS),
      citizenId: findColumn(headerRow, CITIZEN_ID_HEADERS),
      className: (() => {
        const idx = findColumn(headerRow, CLASS_NAME_HEADERS);
        return idx === -1 ? null : idx;
      })(),
      major: (() => {
        const idx = findColumn(headerRow, MAJOR_HEADERS);
        return idx === -1 ? null : idx;
      })(),
      academicYear: (() => {
        const idx = findColumn(headerRow, ACADEMIC_YEAR_HEADERS);
        return idx === -1 ? null : idx;
      })(),
    };

    if (columns.studentCode === -1 || columns.studentName === -1 || columns.citizenId === -1) {
      throw new CustomException(
        'CSV header must include studentCode/mã SV, studentName/họ tên, and citizenId/số CCCD columns',
        ERROR_CODE.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
      );
    }

    const errors: RosterImportResultDao['errors'] = [];
    const validRows: Pick<
      CampaignStudentRoster,
      'studentCode' | 'studentName' | 'citizenId' | 'className' | 'major' | 'academicYear'
    >[] = [];
    const seenCitizenIds = new Set<string>();

    dataRows.forEach((cells, dataRowIndex) => {
      const line = dataRowIndex + 2; // +1 for the header row, +1 for 1-based line numbers
      const cell = (idx: number | null) => (idx === null || idx >= cells.length ? '' : (cells[idx] ?? '').trim());

      const studentCode = cell(columns.studentCode);
      const studentName = cell(columns.studentName);
      const citizenId = cell(columns.citizenId);

      if (!studentCode || !studentName || !citizenId) {
        errors.push({ line, reason: 'Thiếu mã SV, tên, hoặc số CCCD' });
        return;
      }
      if (seenCitizenIds.has(citizenId)) {
        errors.push({ line, reason: `Số CCCD ${citizenId} bị lặp lại trong file này` });
        return;
      }
      seenCitizenIds.add(citizenId);

      validRows.push({
        studentCode,
        studentName,
        citizenId,
        className: cell(columns.className) || null,
        major: cell(columns.major) || null,
        academicYear: cell(columns.academicYear) || null,
      });
    });

    if (validRows.length > 0) {
      await this.repository.upsert(
        validRows.map((r) => ({ campaignId, ...r })),
        { conflictPaths: ['campaignId', 'citizenId'] },
      );
    }

    return { totalRows: dataRows.length, imported: validRows.length, errors };
  }
}
