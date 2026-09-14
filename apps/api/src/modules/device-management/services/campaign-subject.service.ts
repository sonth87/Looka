import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { DainamStudentInfoClient } from '@app/shared/integrations/dainam-student/student-directory.adapter';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DataSource, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  CampaignSubjectDao,
  CampaignSubjectImportDao,
  CampaignSubjectLookupDao,
} from '../dao';
import { ListCampaignSubjectsQueryDto } from '../dto/list-campaign-subjects-query.dto';
import { CampaignSubjectImport } from '../entities/campaign-subject-import.entity';
import {
  CampaignSubject,
  CampaignSubjectStatus,
} from '../entities/campaign-subject.entity';
import {
  EligibilityCheckLog,
  EligibilityMode,
  EligibilitySource,
} from '../entities/eligibility-check-log.entity';
import { evaluateEligibilityRules } from '../util/eligibility-rule.evaluator';
import { CampaignService } from './campaign.service';
import { CampaignSnapshotService } from '@app/modules/stats/services/campaign-snapshot.service';

interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/** Column order for both the template download and the parsed upload — kept in one place so the two never drift apart. */
const ROSTER_COLUMNS = [
  { key: 'subjectCode', header: 'Mã SV', required: true },
  { key: 'fullName', header: 'Họ tên', required: true },
  { key: 'citizenId', header: 'CCCD', required: false },
  { key: 'className', header: 'Lớp', required: false },
  { key: 'faculty', header: 'Khoa', required: false },
  { key: 'major', header: 'Ngành', required: false },
  { key: 'dateOfBirth', header: 'Ngày sinh (yyyy-mm-dd)', required: false },
  {
    key: 'cardValidUntil',
    header: 'Thời hạn thẻ (yyyy-mm-dd)',
    required: false,
  },
] as const;

interface ParsedRow {
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
}

/**
 * Roster import — cms-8-screens-api-plan.md §2.2/§2.3, D-Q3 (recreates the
 * roster dropped 2026-09-08). `importRoster` parses and validates
 * synchronously — see `CampaignSubjectImport`'s own doc comment for why this
 * is not a durable outbox+worker job.
 */
@Injectable()
export class CampaignSubjectService extends CommonService<CampaignSubject> {
  private readonly logger = new Logger(CampaignSubjectService.name);

  constructor(
    @InjectRepository(CampaignSubject)
    repository: Repository<CampaignSubject>,
    @InjectRepository(CampaignSubjectImport)
    private readonly importRepository: Repository<CampaignSubjectImport>,
    @InjectRepository(EligibilityCheckLog)
    private readonly eligibilityLogRepository: Repository<EligibilityCheckLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly campaignService: CampaignService,
    private readonly fileStorage: FileStorageService,
    private readonly snapshotService: CampaignSnapshotService,
    private readonly workflowCatalog: WorkflowCatalogReadRepository,
    private readonly dainamClient: DainamStudentInfoClient,
  ) {
    super(repository);
  }

  async importRoster(
    campaignId: string,
    file: UploadedMulterFile,
    uploadedByUserId: string | null,
  ): Promise<CampaignSubjectImportDao> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const importRow = await this.importRepository.save(
      this.importRepository.create({
        campaignId,
        fileName: file.originalname,
        uploadedByUserId,
        status: 'PROCESSING',
      }),
    );

    let rows: ParsedRow[];
    try {
      rows = await this.parseWorkbook(file.buffer);
    } catch (error) {
      const failureReason = (error as Error).message;
      await this.importRepository.update(importRow.id, {
        status: 'FAILED',
        failureReason,
      });
      throw new CustomException(
        `Không đọc được file Excel: ${failureReason}`,
        ERROR_CODE.CAMPAIGN_SUBJECT_IMPORT_FILE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Existing VALID subject codes already on this campaign (from a prior
    // import) — a code repeated here is DUPLICATE, not a hard DB conflict
    // (see `campaign_subjects`'s own doc comment on the partial unique index).
    const existingCodes = new Set(
      (
        await this.repository.find({
          where: { campaignId, status: 'VALID' },
          select: { subjectCode: true },
        })
      ).map((r) => r.subjectCode),
    );
    const seenInFile = new Set<string>();

    const subjectRows: Partial<CampaignSubject>[] = [];
    let validCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      const base = {
        campaignId,
        importId: importRow.id,
        rowNo: row.rowNo,
        subjectCode: row.subjectCode ?? '',
        fullName: row.fullName ?? '',
        citizenId: row.citizenId,
        className: row.className,
        faculty: row.faculty,
        major: row.major,
        dateOfBirth: row.dateOfBirth,
        cardValidUntil: row.cardValidUntil,
        extra: row.extra,
      };

      let status: CampaignSubjectStatus;
      let errorMessage: string | null = null;
      if (!row.subjectCode || !row.fullName) {
        status = 'ERROR';
        errorMessage = 'Thiếu mã SV hoặc họ tên';
      } else if (
        seenInFile.has(row.subjectCode) ||
        existingCodes.has(row.subjectCode)
      ) {
        status = 'DUPLICATE';
        errorMessage = `Mã SV "${row.subjectCode}" đã có trong đợt này`;
      } else {
        status = 'VALID';
        seenInFile.add(row.subjectCode);
      }

      if (status === 'VALID') validCount++;
      else errorCount++;

      subjectRows.push({ ...base, status, errorMessage });
    }

    if (subjectRows.length > 0) {
      // `extra`'s `Record<string, unknown> | null` shape doesn't structurally
      // match `QueryDeepPartialEntity`'s jsonb expectations (it wants
      // `() => string` as an alternative arm) — a plain data cast, not a
      // real type hazard: every field here comes from `ParsedRow`, never a
      // caller-supplied query fragment.
      await this.repository.insert(
        subjectRows as QueryDeepPartialEntity<CampaignSubject>[],
      );
    }

    let errorReportFsFileId: string | null = null;
    const errorRows = subjectRows.filter((r) => r.status !== 'VALID');
    if (errorRows.length > 0) {
      try {
        const buffer = await this.buildErrorReport(errorRows);
        const result = await this.fileStorage.uploadRaw({
          virtualPath: `campaigns/${campaignId}/subject-imports/${importRow.id}-errors.xlsx`,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: new Uint8Array(buffer),
          idempotencyKey: randomUUID(),
          // 'public' not 'private': see photo-review.service.ts's
          // uploadMetadataBestEffort for the full reasoning — owner-based
          // ACL always denies non-owner reads, and Looka never sends
          // X-Owner-User-Id, so a private file here is unreadable via
          // issueViewLink.
          visibility: 'public',
        });
        errorReportFsFileId = result.fileId;
      } catch (error) {
        // Best-effort — the import itself already succeeded (rows are
        // saved); a failed error-report upload only means the CMS can't
        // download a formatted error file, not that the import is lost.
        this.logger.warn(
          `error-report upload failed for import ${importRow.id}: ${(error as Error).message}`,
        );
      }
    }

    let fsFileId: string | null = null;
    try {
      const result = await this.fileStorage.uploadRaw({
        virtualPath: `campaigns/${campaignId}/subject-imports/${importRow.id}-${file.originalname}`,
        mimeType: file.mimetype,
        data: new Uint8Array(file.buffer),
        idempotencyKey: randomUUID(),
        // 'public' not 'private' — same reasoning as the error-report
        // upload just above.
        visibility: 'public',
      });
      fsFileId = result.fileId;
    } catch (error) {
      this.logger.warn(
        `original-file upload failed for import ${importRow.id}: ${(error as Error).message}`,
      );
    }

    await this.importRepository.update(importRow.id, {
      status: 'DONE',
      totalRows: rows.length,
      validRows: validCount,
      errorRows: errorCount,
      errorReportFsFileId,
      fsFileId,
    });

    // Best-effort — cms-8-screens-api-plan.md §2.9/P4: refreshes
    // `stats_campaign_snapshot.rosterValid`/`notCaptured` for this campaign
    // right away rather than waiting up to 5 minutes for the next
    // `SnapshotRefreshWorker` tick.
    await this.snapshotService
      .refresh([campaignId])
      .catch((err) =>
        this.logger.warn(
          `snapshot refresh after import failed: ${(err as Error).message}`,
        ),
      );

    return this.toImportDao({
      ...importRow,
      status: 'DONE',
      totalRows: rows.length,
      validRows: validCount,
      errorRows: errorCount,
      errorReportFsFileId,
      fsFileId,
    });
  }

  async listImports(campaignId: string): Promise<CampaignSubjectImportDao[]> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const rows = await this.importRepository.find({
      where: { campaignId },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((r) => this.toImportDao(r)));
  }

  async getImport(
    campaignId: string,
    importId: string,
  ): Promise<CampaignSubjectImportDao> {
    return this.toImportDao(
      await this.findImportEntityOrFail(campaignId, importId),
    );
  }

  /** Refused (409) if any session already references a subject this import created — "chỉ khi chưa phiên nào khớp" (§2.3). */
  async deleteImport(campaignId: string, importId: string): Promise<void> {
    await this.findImportEntityOrFail(campaignId, importId);

    const [{ count }] = await this.dataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
         FROM sessions s
         JOIN campaign_subjects cs
           ON cs.campaign_id = s.campaign_id AND cs.subject_code = s.subject_code
        WHERE cs.import_id = $1`,
      [importId],
    );
    if (count > 0) {
      throw new CustomException(
        `Cannot delete import: ${count} session(s) already matched a subject from it`,
        ERROR_CODE.CAMPAIGN_SUBJECT_IMPORT_IN_USE,
        HttpStatus.CONFLICT,
      );
    }

    // `campaign_subjects` rows cascade-delete via the FK — see that entity's own doc comment.
    await this.importRepository.delete(importId);
  }

  async listSubjects(
    campaignId: string,
    query: ListCampaignSubjectsQueryDto,
  ): Promise<Pagination<CampaignSubjectDao>> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const qb = this.repository
      .createQueryBuilder('cs')
      .where('cs.campaign_id = :campaignId', { campaignId });
    if (query.status)
      qb.andWhere('cs.status = :status', { status: query.status });
    if (query.q) {
      qb.andWhere('(cs.subject_code ILIKE :q OR cs.full_name ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    qb.orderBy('cs.row_no', 'ASC');

    const result = await this.paginateQueryBuilder(qb, { page, limit });
    return new Pagination(toDao(CampaignSubjectDao, result.items), result.meta);
  }

  /**
   * `GET /v1/campaigns/:id/subjects/lookup?key=` (§2.3's kiosk note) — `key`
   * matches `subjectCode` OR `citizenId` exactly against `VALID` roster
   * rows, for `ROSTER`/`ROSTER_AND_API` modes. Follows the campaign's
   * pinned workflow's `eligibility.mode` (default `ROSTER` when no
   * workflow is pinned — the exact behavior every campaign had before this
   * mode-awareness existed, so an unpinned campaign's kiosk flow is
   * unchanged):
   * - `NONE`: eligible unconditionally, no roster/API call at all.
   * - `ROSTER` (previously the ONLY mode this method understood — it never
   *   actually read `eligibility.mode`, despite this DAO's own OLD doc
   *   comment claiming otherwise; fixed here): unchanged from before.
   * - `EXTERNAL_API`/`ROSTER_AND_API`: calls the real, confirmed-live
   *   `DainamStudentInfoClient` (`ROSTER_AND_API` first requires a roster
   *   hit, same as `ROSTER` mode, THEN also calls the API) and evaluates
   *   `eligibility.rules[]` (`evaluateEligibilityRules`, `expr-eval`)
   *   against the API record's own field names (`course_year`,
   *   `class_name`, `status`, …) plus the roster row's fields, if any.
   *   **Known constraint of the real external API**: it can only be
   *   filtered by `student_code`, not `identity_number`/CCCD — a `key`
   *   that is actually a CCCD scan will legitimately come back "not
   *   found" against the API in these two modes, the same as it would for
   *   a real student not in that system; this is the external system's
   *   own filtering capability, not a gap in this client.
   *
   * Every call writes one `eligibility_check_logs` row (best-effort — a log
   * write failure never blocks the actual answer), plan §2.3's audit trail.
   */
  async lookupSubject(
    campaignId: string,
    key: string,
  ): Promise<CampaignSubjectLookupDao> {
    const campaign =
      await this.campaignService.findCampaignEntityOrFail(campaignId);
    const eligibility = campaign.workflowVersionId
      ? (await this.workflowCatalog.getVersionRef(campaign.workflowVersionId))
          ?.config.eligibility
      : undefined;
    const mode: EligibilityMode = eligibility?.mode ?? 'ROSTER';

    if (mode === 'NONE') {
      return this.recordLookup(campaignId, key, mode, 'NONE', {
        eligible: true,
      });
    }

    const rosterSubject = await this.repository.findOne({
      where: [
        { campaignId, subjectCode: key, status: 'VALID' },
        { campaignId, citizenId: key, status: 'VALID' },
      ],
    });

    if (mode === 'ROSTER') {
      return rosterSubject
        ? this.recordLookup(campaignId, key, mode, 'ROSTER', {
            eligible: true,
            subject: rosterSubject,
          })
        : this.recordLookup(campaignId, key, mode, 'ROSTER', {
            eligible: false,
            reason: 'Không tìm thấy trong danh sách đợt này',
          });
    }

    // EXTERNAL_API or ROSTER_AND_API from here.
    if (mode === 'ROSTER_AND_API' && !rosterSubject) {
      return this.recordLookup(campaignId, key, mode, 'ROSTER', {
        eligible: false,
        reason: 'Không có trong danh sách roster của đợt này',
      });
    }

    const outcome = await this.dainamClient.getListStudentInfo({
      studentCode: key,
    });
    if (outcome.kind !== 'Success') {
      return this.recordLookup(campaignId, key, mode, 'EXTERNAL_API', {
        eligible: false,
        reason: `Không tra được từ hệ thống sinh viên ngoài: ${outcome.reason}`,
        subject: rosterSubject,
      });
    }
    const apiRecord = outcome.value.data[0];
    if (!apiRecord) {
      return this.recordLookup(campaignId, key, mode, 'EXTERNAL_API', {
        eligible: false,
        reason: 'Không tìm thấy trong hệ thống sinh viên ngoài',
        subject: rosterSubject,
      });
    }

    const context: Record<string, unknown> = rosterSubject
      ? {
          subjectCode: rosterSubject.subjectCode,
          fullName: rosterSubject.fullName,
          citizenId: rosterSubject.citizenId,
          className: rosterSubject.className,
          faculty: rosterSubject.faculty,
          major: rosterSubject.major,
          ...apiRecord,
        }
      : { ...apiRecord };
    const evaluation = evaluateEligibilityRules(
      eligibility?.rules ?? [],
      context,
    );
    return this.recordLookup(campaignId, key, mode, 'EXTERNAL_API', {
      eligible: evaluation.eligible,
      reason: evaluation.reason,
      subject: rosterSubject,
      externalRecord: apiRecord,
      context,
    });
  }

  private async recordLookup(
    campaignId: string,
    key: string,
    mode: EligibilityMode,
    source: EligibilitySource,
    result: {
      eligible: boolean;
      reason?: string;
      subject?: CampaignSubject | null;
      externalRecord?: Record<string, unknown> | null;
      context?: Record<string, unknown>;
    },
  ): Promise<CampaignSubjectLookupDao> {
    await this.eligibilityLogRepository
      .save(
        this.eligibilityLogRepository.create({
          campaignId,
          key,
          mode,
          source,
          eligible: result.eligible,
          reason: result.reason ?? null,
          context: result.context ?? null,
          checkedAt: new Date(),
        }),
      )
      .catch((error) =>
        this.logger.warn(
          `eligibility_check_logs write failed: ${(error as Error).message}`,
        ),
      );

    const dao = new CampaignSubjectLookupDao();
    dao.eligible = result.eligible;
    if (result.reason) dao.reason = result.reason;
    dao.subject = result.subject
      ? toDao(CampaignSubjectDao, result.subject)
      : null;
    dao.externalRecord = result.externalRecord ?? null;
    return dao;
  }

  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Roster');
    sheet.addRow(ROSTER_COLUMNS.map((c) => c.header));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async findImportEntityOrFail(
    campaignId: string,
    importId: string,
  ): Promise<CampaignSubjectImport> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const row = await this.importRepository.findOne({
      where: { id: importId, campaignId },
    });
    if (!row) {
      throw new CustomException(
        'Campaign subject import not found',
        ERROR_CODE.CAMPAIGN_SUBJECT_IMPORT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private async toImportDao(
    row: CampaignSubjectImport,
  ): Promise<CampaignSubjectImportDao> {
    const dao = toDao(CampaignSubjectImportDao, row);
    if (row.errorReportFsFileId) {
      try {
        const link = await this.fileStorage.issueViewLink(
          row.errorReportFsFileId,
          row.uploadedByUserId ?? 'system',
        );
        dao.errorReportUrl = link.url;
      } catch {
        dao.errorReportUrl = null;
      }
    }
    return dao;
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
    const workbook = new ExcelJS.Workbook();
    // `exceljs` resolves its own `Buffer` ambient type against a different
    // (older, non-generic) `@types/node` copy than this app's — same
    // runtime type, incompatible nominal types. Casting through the
    // function's own inferred parameter type (rather than the bare
    // `Buffer` name, which would just re-resolve to THIS file's — wrong —
    // copy) sidesteps the version skew without an `any`.
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('File không có sheet nào');

    const headerRow = sheet.getRow(1);
    const extraHeaders: Array<{ col: number; header: string }> = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber > ROSTER_COLUMNS.length) {
        const text = this.cellToString(cell.value);
        if (text) extraHeaders.push({ col: colNumber, header: text });
      }
    });

    const rows: ParsedRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const excelRow = sheet.getRow(r);
      if (excelRow.cellCount === 0) continue;

      const get = (col: number) =>
        this.cellToString(excelRow.getCell(col).value);
      const subjectCode = get(1);
      const fullName = get(2);
      // A fully blank row (no cell has any content) is skipped, not counted as an error row.
      if (
        !subjectCode &&
        !fullName &&
        !get(3) &&
        !get(4) &&
        !get(5) &&
        !get(6)
      ) {
        continue;
      }

      const extra: Record<string, unknown> = {};
      for (const h of extraHeaders) {
        const value = this.cellToString(excelRow.getCell(h.col).value);
        if (value) extra[h.header] = value;
      }

      rows.push({
        rowNo: r,
        subjectCode: subjectCode || null,
        fullName: fullName || null,
        citizenId: get(3) || null,
        className: get(4) || null,
        faculty: get(5) || null,
        major: get(6) || null,
        dateOfBirth: this.cellToDate(excelRow.getCell(7).value),
        cardValidUntil: this.cellToDate(excelRow.getCell(8).value),
        extra: Object.keys(extra).length > 0 ? extra : null,
      });
    }
    return rows;
  }

  private cellToString(value: ExcelJS.CellValue): string | null {
    if (value == null) return null;
    if (typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      if ('text' in value)
        return String((value as { text: unknown }).text).trim() || null;
      if ('result' in value) {
        return String((value as { result: unknown }).result).trim() || null;
      }
      // Some other exceljs cell-value shape (hyperlink, rich text, formula
      // error) — not one this roster format needs to read, and `String()`
      // on it would just produce "[object Object]".
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }

  private cellToDate(value: ExcelJS.CellValue): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const text = this.cellToString(value);
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString().slice(0, 10);
  }

  private async buildErrorReport(
    rows: Array<Partial<CampaignSubject>>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lỗi');
    sheet.addRow(['Dòng', 'Mã SV', 'Họ tên', 'Trạng thái', 'Lý do']);
    for (const row of rows) {
      sheet.addRow([
        row.rowNo,
        row.subjectCode,
        row.fullName,
        row.status,
        row.errorMessage,
      ]);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
