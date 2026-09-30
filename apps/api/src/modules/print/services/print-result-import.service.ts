import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DataSource, In, Not, Repository } from 'typeorm';
import { PrintResultImportDao } from '../dao';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
import { PrintItemEvent } from '../entities/print-item-event.entity';
import { PrintResultImport } from '../entities/print-result-import.entity';
import {
  PRINT_ITEM_INACTIVE_STATUSES,
  type PrintBatchMode,
  type PrintItemStatus,
} from '../print.constants';
import { PrinterService } from './printer.service';
import { PrintStatsService } from '@app/modules/stats/services/print-stats.service';

interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

type ResultFieldKey =
  'subjectCode' | 'printStatus' | 'errorReason' | 'cardCode';

/** Same header-matching mechanism `CampaignSubjectService.parseWorkbook` uses for roster uploads — duplicated (not imported) since `print` must not depend on `device-management` for one small string-normalization helper (module-boundary convention this whole codebase follows, see `1818000000000-Print.ts`'s own top comment). */
const HEADER_ALIASES: Record<ResultFieldKey, string[]> = {
  subjectCode: ['Mã SV', 'MSSV', 'Mã số SV', 'Mã số sinh viên'],
  printStatus: ['Tình trạng', 'Tình trạng in', 'Trạng thái', 'Kết quả'],
  errorReason: ['Lỗi', 'Lý do', 'Lý do lỗi', 'Ghi chú'],
  cardCode: ['Mã thẻ', 'Số thẻ', 'Mã số thẻ'],
};
/**
 * `cardCode` is deliberately NOT required: `danh-sach-in.xlsx` files exported
 * before the "Mã thẻ" column existed (and print shops that simply don't
 * report card codes) must keep importing exactly as they always did.
 */
const REQUIRED_FIELDS: ResultFieldKey[] = ['subjectCode', 'printStatus'];

/** `print_items.card_code` / `campaign_subjects.card_code` are `varchar(64)` — a longer value is rejected per row, never silently truncated. */
const CARD_CODE_MAX_LENGTH = 64;

/**
 * Only items that were actually handed off for physical printing may be
 * moved by a result-file row. Matching against every non-terminal status
 * (as this used to do) let a "Đã in" row jump a never-exported
 * PENDING/RENDERED item straight to PRINTED, and a "Lỗi" row regress it to
 * RENDERED with no rendered PNG attached — either way leaving a card that
 * was never packaged looking like it went through the print flow.
 */
const HANDED_OFF_ITEM_STATUSES = ['EXPORTED', 'PRINTED'];

/**
 * Vietnamese label for a print item's status, used only for the "chưa xuất
 * gói" rejection reason below (see `HANDED_OFF_ITEM_STATUSES`) — a tiny
 * server-side duplicate of the CMS's own `PRINT_ITEM_STATUS_LABEL`
 * (`apps/cms/src/print/printFormat.ts`), not imported from there since
 * `apps/api` must not depend on `apps/cms` (same module-boundary reasoning
 * `HEADER_ALIASES`'s own doc comment gives for duplicating instead of
 * importing a helper from another module). Keep in sync if the CMS's labels
 * change.
 */
const PRINT_ITEM_STATUS_LABEL_VI: Record<PrintItemStatus, string> = {
  PENDING: 'Chờ render',
  RENDERED: 'Đã render',
  EXPORTED: 'Đã xuất, chờ in',
  QUEUED: 'Đã xếp hàng',
  PRINTING: 'Đang in',
  PRINTED: 'Đã in',
  FAILED: 'Lỗi',
  REPRINT_REQUESTED: 'Chờ in lại',
  CANCELLED: 'Đã hủy',
};

/**
 * Mirrors the CMS's mode-aware `printItemStatusLabel` (same file):
 * a CENTRALIZED batch never renders (see `PrintBatchService.exportPackage`'s
 * own doc comment — render is no longer a precondition for CENTRALIZED
 * export), so a CENTRALIZED item sitting in PENDING or RENDERED reads to the
 * operator as just "chưa in", not the raw enum value or a "chờ
 * render"/"đã render" wording that only makes sense for a DIRECT batch.
 */
function statusLabelForRejectionReason(
  status: PrintItemStatus,
  batchMode: PrintBatchMode,
): string {
  if (
    batchMode === 'CENTRALIZED' &&
    (status === 'PENDING' || status === 'RENDERED')
  ) {
    return 'Chưa in';
  }
  return PRINT_ITEM_STATUS_LABEL_VI[status];
}

/**
 * A "Lỗi in" row for an EXPORTED item must send it back to whatever it
 * really was before "Xuất gói" — not a hardcoded `RENDERED`. Since the
 * 2026-09-25 product decision that CENTRALIZED export promotes PENDING
 * straight to EXPORTED with no render step (`PrintBatchService.exportPackage`'s
 * own doc comment), an item can reach EXPORTED having never been rendered at
 * all; regressing it to RENDERED unconditionally would leave it "Đã render"
 * with no rendered PNG file actually attached.
 *
 * Read directly off `renderedFrontFsFileId`/`renderedBackFsFileId` — the
 * item's own authoritative "was this actually rendered" columns — rather
 * than looking up the item's latest `print_item_events` row (e.g. the
 * `fromStatus` of its EXPORTED event): that would need an extra per-item
 * query (or a batched follow-up query keyed by item id) for something this
 * row's own two columns already answer directly, and stays correct even if
 * an item somehow accumulated more than one EXPORTED event.
 */
function resolvePriorStatus(item: PrintItem): 'PENDING' | 'RENDERED' {
  return item.renderedFrontFsFileId || item.renderedBackFsFileId
    ? 'RENDERED'
    : 'PENDING';
}

const PRINTED_VALUES = new Set([
  'da in',
  'in thanh cong',
  'da in thanh cong',
  'thanh cong',
  'ok',
  'x',
]);
const FAILED_VALUES = new Set([
  'loi',
  'khong in duoc',
  'in loi',
  'in that bai',
  'that bai',
  'khong thanh cong',
  'tu choi',
  'fail',
]);

/** Strips accents/case/whitespace so header AND value text match regardless of wording — same normalization spirit `normalizeHeaderText` in `campaign-subject.service.ts` uses for roster headers, extended here to also classify the `printStatus` cell's own text. */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_HEADER_ALIASES: Record<string, ResultFieldKey> =
  Object.fromEntries(
    (
      Object.entries(HEADER_ALIASES) as Array<[ResultFieldKey, string[]]>
    ).flatMap(([field, aliases]) =>
      aliases.map((alias) => [normalizeText(alias), field]),
    ),
  );

interface ParsedResultRow {
  rowNo: number;
  subjectCode: string | null;
  printStatus: string | null;
  errorReason: string | null;
  /** Trimmed "Mã thẻ" cell text; `null` when the column is absent or the cell is empty. Length is validated later, per row, in `importResults`. */
  cardCode: string | null;
}

/**
 * Renders a numeric xlsx cell as plain digits. Excel hands a numeric card
 * code back as a JS number (e.g. `123456`); `String(n)` is already fine for
 * that (never a trailing `.0`), but flips to exponent notation from 1e21 up
 * (and for tiny fractions) — which would silently corrupt a long numeric
 * code. Leading zeros can only survive when the cell is stored as TEXT —
 * that is why the exported `Mã thẻ` column is pre-formatted as Text.
 */
function numberToPlainString(n: number): string {
  if (Number.isInteger(n)) return BigInt(n).toString();
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
}

/** `classifyStatus`'s three outcomes — `UNKNOWN` (an unrecognized status word) is deliberately never guessed into either PRINTED or FAILED (same "không bao giờ suy luận" spirit BA #14 states for `printedAt`) — it is reported alongside unmatched rows instead. */
type StatusOutcome = 'PRINTED' | 'FAILED' | 'UNKNOWN';

function classifyStatus(raw: string | null): StatusOutcome {
  if (!raw) return 'UNKNOWN';
  const normalized = normalizeText(raw);
  if (PRINTED_VALUES.has(normalized)) return 'PRINTED';
  if (FAILED_VALUES.has(normalized)) return 'FAILED';
  return 'UNKNOWN';
}

/**
 * Print-result upload — Giai đoạn 4 (plan §4.3, features 4+5). Parses and
 * validates **synchronously**, same reasoning `CampaignSubjectImport`'s own
 * doc comment gives for roster Excel uploads: a print batch's result file
 * is a few hundred rows a human is already waiting on, not an unattended
 * background job.
 *
 * Two distinct "từ chối" levels (plan's own explicit decision):
 * 1. The WHOLE file is unreadable/missing a required column →
 *    `PrintResultImport.status = 'FAILED'`, nothing else touched, thrown
 *    back as a 400 — the batch/items stay exactly as they were.
 * 2. A single ROW doesn't match any item in this batch, wasn't handed off
 *    for printing yet, its status text isn't recognized, or it conflicts
 *    with an item's current state (see below) → counted into
 *    `unmatchedRows`, reported both in the downloadable error file AND
 *    inline on this call's own response (`errors` — response-only, never
 *    persisted), but the rest of the file still applies (partial apply, by
 *    product decision — see `HANDED_OFF_ITEM_STATUSES`'s own doc comment for
 *    why an item's CURRENT status, not just its subjectCode, gates whether a
 *    row may act on it).
 *
 * 2026-09-25 product rule ("Chỉ ảnh đã được export... mới đổi trạng thái"):
 * only an EXPORTED item may be moved by a row. A "Đã in" row on an
 * already-PRINTED item is an idempotent no-op (cumulative sheets re-list old
 * rows); an "In thất bại" row on an already-PRINTED item is rejected outright
 * (a confirmed print must never be talked back into a failure). A "Lỗi" row
 * on an EXPORTED item regresses it to its real prior status — RENDERED or
 * PENDING, see `resolvePriorStatus` — never a hardcoded RENDERED.
 *
 * That "only EXPORTED" rule is enforced TWICE, not once: the in-memory plan
 * built from the `find()` snapshot above (which items/rows to even attempt),
 * AND the write-time `UPDATE ... WHERE status = 'EXPORTED' AND batch_id =
 * $N` guards inside the transaction below — the snapshot can go stale
 * between the two (a concurrent upload, `removeItems`, a reprint) in the gap
 * this async method spans. A row whose write loses that race (0 rows
 * `RETURNING`) is walked back out of `printedCount`/`failedCount` and
 * reported exactly like any other rejected row (`RACE_LOST_REASON`) —
 * counts always reflect what was actually WRITTEN, never merely planned.
 *
 * "Mã thẻ" (card code, optional `Mã thẻ` column — see `HEADER_ALIASES`):
 * - "Đã in" + a code on an EXPORTED item → PRINTED as always AND the code is
 *   stored on the print item (and on `campaign_subjects.card_code`, the
 *   student's latest card) in the SAME guarded UPDATE/transaction.
 * - "Đã in" with no code → PRINTED as always, `card_code` stays null (the
 *   code is never required).
 * - "Đã in" on an already-PRINTED item stays an idempotent no-op (no stock,
 *   no stats, no event), with ONE exception: a non-empty code that differs
 *   from the stored one (including stored null) updates ONLY the card code
 *   — guarded by `status = 'PRINTED' AND batch_id = $N AND card_code IS NOT
 *   DISTINCT FROM <snapshot value>` (optimistic concurrency, so the event's
 *   from→to note is always truthful) — and writes one `RESULT_UPLOAD` event.
 *   A same code (or no code) is a pure no-op.
 * - "In thất bại": any code on the row is IGNORED, never stored.
 * - A code longer than `CARD_CODE_MAX_LENGTH` rejects that ("Đã in") row with
 *   a Vietnamese reason — never truncated.
 * - Counters: every accepted "Đã in" row counts in `printedRows` (a code-only
 *   update included — same bucket the pre-existing idempotent re-listed rows
 *   already use: "rows whose reported outcome was printed and that weren't
 *   rejected", NOT "cards that just transitioned"); `matchedRows` and
 *   `unmatchedRows` keep their existing meaning. No new persisted bucket.
 * - No uniqueness is enforced on card codes (open business question).
 */
@Injectable()
export class PrintResultImportService {
  private readonly logger = new Logger(PrintResultImportService.name);

  constructor(
    @InjectRepository(PrintResultImport)
    private readonly imports: Repository<PrintResultImport>,
    @InjectRepository(PrintBatch)
    private readonly batches: Repository<PrintBatch>,
    @InjectRepository(PrintItem)
    private readonly items: Repository<PrintItem>,
    @InjectRepository(PrintItemEvent)
    private readonly events: Repository<PrintItemEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
    private readonly printerService: PrinterService,
    private readonly printStats: PrintStatsService,
  ) {}

  async importResults(
    batchId: string,
    file: UploadedMulterFile,
    uploadedByUserId: string | null,
  ): Promise<PrintResultImportDao> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Không tìm thấy đợt in');
    if (batch.status === 'CANCELLED') {
      throw new ConflictException(
        'Đợt in đã hủy — không thể tải lên kết quả in',
      );
    }

    const importRow = await this.imports.save(
      this.imports.create({
        batchId,
        fileName: file.originalname,
        uploadedByUserId,
        status: 'PROCESSING',
      }),
    );

    let rows: ParsedResultRow[];
    try {
      rows = await this.parseWorkbook(file.buffer);
    } catch (error) {
      const failureReason = (error as Error).message;
      await this.imports.update(importRow.id, {
        status: 'FAILED',
        failureReason,
      });
      throw new BadRequestException(
        `Không đọc được file kết quả in: ${failureReason}`,
      );
    }

    // CANCELLED/FAILED/REPRINT_REQUESTED items are excluded from matching
    // on purpose — a cancelled or superseded card should not be silently
    // revived by an upload that never knew about it, and (crucially for a
    // reprinted card) the superseded REPRINT_REQUESTED original must never
    // win a subjectCode collision against its own active reprint item.
    const batchItems = await this.items.find({
      where: { batchId, status: Not(In(PRINT_ITEM_INACTIVE_STATUSES)) },
    });
    // Grouped by subjectCode (not a straight last-wins Map) so a genuine
    // collision — more than one active item sharing a subjectCode, e.g. an
    // in-flight reprint pair that briefly shares a batch — is detected and
    // reported instead of silently applying the result to whichever row
    // `find()` happened to return last.
    const itemsByCode = new Map<string, PrintItem[]>();
    for (const item of batchItems) {
      const list = itemsByCode.get(item.subjectCode) ?? [];
      list.push(item);
      itemsByCode.set(item.subjectCode, list);
    }

    let matched = 0;
    let printedCount = 0;
    let failedCount = 0;
    let unmatched = 0;
    // Keyed by item id, not pushed straight into a `printedItems`/
    // `failedItems` array per row — a file can list the same student more
    // than once (a cumulative sheet re-listing an already-printed row, or
    // a typo'd duplicate), and applying every row would double-decrement
    // stock, double-count stats, and write duplicate events for one
    // physical card. The LAST row for a given item wins, including across
    // a PRINTED/FAILED conflict for the same code, so the file's own row
    // order decides the outcome instead of "FAILED always wins" regardless
    // of order.
    // `rowNo`/`subjectCode` are carried on every entry (not just re-derived
    // from `item` at write time) so a row that loses the write-time race
    // (see the transaction below) can still be reported against the exact
    // file row that produced it, using the file's own subjectCode text
    // rather than the item's — same reasoning `reportRows` elsewhere in this
    // loop already follows.
    const outcomeByItemId = new Map<
      string,
      | {
          item: PrintItem;
          outcome: 'PRINTED';
          /** Validated, trimmed "Mã thẻ" from this row — `null` = none reported. */
          cardCode: string | null;
          rowNo: number;
          subjectCode: string | null;
        }
      | {
          item: PrintItem;
          outcome: 'FAILED';
          message: string;
          /** Status to regress to — see `resolvePriorStatus`'s own doc comment. */
          targetStatus: 'PENDING' | 'RENDERED';
          rowNo: number;
          subjectCode: string | null;
        }
    >();
    const reportRows: Array<{
      rowNo: number;
      subjectCode: string | null;
      reason: string;
    }> = [];

    for (const row of rows) {
      const code = row.subjectCode?.trim() || null;
      const allCandidates = code ? itemsByCode.get(code) : undefined;
      if (!allCandidates || allCandidates.length === 0) {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: 'Không tìm thấy mã SV trong đợt in này',
        });
        continue;
      }
      // The code exists in this batch, but its item was never actually
      // packaged/exported (still PENDING/RENDERED, or superseded by a
      // reprint) — a result row must not fabricate a print outcome for a
      // card the print vendor never received.
      const candidates = allCandidates.filter((i) =>
        HANDED_OFF_ITEM_STATUSES.includes(i.status),
      );
      if (candidates.length === 0) {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: `Thẻ chưa được xuất gói (đang ở trạng thái ${statusLabelForRejectionReason(allCandidates[0].status, batch.mode)}) — cần "Xuất gói" trước khi ghi nhận kết quả in`,
        });
        continue;
      }
      if (candidates.length > 1) {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: `Mã SV trùng ${candidates.length} item trong đợt in — không thể xác định item nào, cần xử lý tay`,
        });
        continue;
      }
      const item = candidates[0];
      matched++;
      const outcome = classifyStatus(row.printStatus);
      if (outcome === 'PRINTED') {
        // A code that can't fit the column is rejected for THIS row (never
        // truncated — a silently cut-off card code would be a wrong code).
        // Counted like the "unrecognized status" rows below: matched (the
        // code was found) AND unmatched (nothing done with it). Only
        // "Đã in" rows can reach here, so a too-long code on an
        // "In thất bại" row — where the code is ignored anyway — never
        // rejects that row. Length is measured in code points, matching
        // Postgres' `varchar(n)`, not in UTF-16 units.
        const cardCode = row.cardCode?.trim() || null;
        const cardCodeLength = cardCode ? Array.from(cardCode).length : 0;
        if (cardCodeLength > CARD_CODE_MAX_LENGTH) {
          unmatched++;
          reportRows.push({
            rowNo: row.rowNo,
            subjectCode: row.subjectCode,
            reason: `Mã thẻ quá dài (${cardCodeLength} ký tự, tối đa ${CARD_CODE_MAX_LENGTH}) — dòng bị từ chối, không lưu gì`,
          });
          continue;
        }
        // An already-PRINTED item re-listed as "Đã in" (a cumulative sheet
        // re-including an old row) is split out below into either a pure
        // no-op (same/no code — the write never touches it: no re-decrement,
        // no duplicate event, `printedCount` still counts it as a normal
        // successful row) or a card-code-only update (a different non-empty
        // code). Everything else in `printedItems` is snapshotted EXPORTED
        // here and is reconciled against what the guarded UPDATE actually
        // touched.
        printedCount++;
        outcomeByItemId.set(item.id, {
          item,
          outcome: 'PRINTED',
          cardCode,
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
        });
      } else if (outcome === 'FAILED') {
        if (item.status === 'PRINTED') {
          // A card already confirmed printed must never be talked back into
          // a failure by a later/conflicting row (e.g. a typo'd duplicate,
          // or two rows for the same reprint window) — reported like any
          // other row this import couldn't act on, not silently dropped.
          unmatched++;
          reportRows.push({
            rowNo: row.rowNo,
            subjectCode: row.subjectCode,
            reason:
              'Thẻ đã được ghi nhận in thành công trước đó — không thể chuyển sang lỗi',
          });
        } else {
          failedCount++;
          outcomeByItemId.set(item.id, {
            item,
            outcome: 'FAILED',
            message:
              row.errorReason?.trim() || 'Lỗi in (từ file upload kết quả)',
            targetStatus: resolvePriorStatus(item),
            rowNo: row.rowNo,
            subjectCode: row.subjectCode,
          });
        }
      } else {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: `Không hiểu trạng thái in: "${row.printStatus ?? ''}"`,
        });
      }
    }

    /**
     * "Đã in" rows on items snapshotted EXPORTED — the guarded
     * EXPORTED → PRINTED transition. `cardCode` is whatever this row
     * reported (null = none); stored in that same UPDATE.
     */
    const printedItems: Array<{
      item: PrintItem;
      cardCode: string | null;
      rowNo: number;
      subjectCode: string | null;
    }> = [];
    /**
     * "Đã in" rows on items snapshotted ALREADY PRINTED that carry a non-empty
     * card code differing from the stored one (`item.cardCode`, including
     * null) — the ONE exception to the "already printed → no-op" rule; only
     * `card_code` is written, never status/stock/stats. A same code, or no
     * code, on an already-printed item never makes it into this list (pure
     * no-op — it was still counted in `printedCount` at planning time).
     */
    const cardCodeUpdates: Array<{
      item: PrintItem;
      cardCode: string;
      rowNo: number;
      subjectCode: string | null;
    }> = [];
    const failedItems: Array<{
      item: PrintItem;
      message: string;
      targetStatus: 'PENDING' | 'RENDERED';
      rowNo: number;
      subjectCode: string | null;
    }> = [];
    for (const entry of outcomeByItemId.values()) {
      if (entry.outcome === 'PRINTED') {
        if (entry.item.status !== 'PRINTED') {
          printedItems.push({
            item: entry.item,
            cardCode: entry.cardCode,
            rowNo: entry.rowNo,
            subjectCode: entry.subjectCode,
          });
        } else if (
          entry.cardCode &&
          entry.cardCode !== (entry.item.cardCode ?? null)
        ) {
          cardCodeUpdates.push({
            item: entry.item,
            cardCode: entry.cardCode,
            rowNo: entry.rowNo,
            subjectCode: entry.subjectCode,
          });
        }
      } else
        failedItems.push({
          item: entry.item,
          message: entry.message,
          targetStatus: entry.targetStatus,
          rowNo: entry.rowNo,
          subjectCode: entry.subjectCode,
        });
    }
    /** Shared reason/message for any row whose in-memory plan (built above from a `find()` snapshot) loses the write-time race — see the transaction below for the write-time guards this covers. */
    const RACE_LOST_REASON =
      'Trạng thái thẻ đã thay đổi trong lúc xử lý — vui lòng tải lại trang và thử lại';

    try {
      await this.dataSource.transaction(async (manager) => {
        const now = new Date();

        if (printedItems.length) {
          const ids = printedItems.map((p) => p.item.id);
          // `WHERE ... AND batch_id = $2 AND status = 'EXPORTED'` +
          // `RETURNING id` — NOT `status <> 'PRINTED'` (the old guard): that
          // only stopped a RE-upload from re-decrementing stock, but let
          // through any item that drifted off EXPORTED for another reason
          // between the `find()` snapshot above and this write — a
          // concurrent upload, a `removeItems`/cancel, or a reprint — since
          // anything other than PENDING/RENDERED/QUEUED/PRINTING/CANCELLED/
          // FAILED/REPRINT_REQUESTED would still have matched `<> 'PRINTED'`
          // and been happily stamped PRINTED anyway. `batch_id` is pinned
          // too so an item detached from this batch mid-upload can't be
          // stamped as this batch's own PRINTED count. `UPDATE ...
          // RETURNING` here returns a `[rows, affectedCount]` tuple, same
          // rule `PrintItemService.bulkUpdateTemplate` documents.
          //
          // Card codes travel as a parallel `text[]` (aligned with `ids`,
          // `null` = none reported) zipped in via a multi-argument
          // `unnest(...)` — one row per item, in ONE guarded statement, so
          // the code is stored atomically with the status change and can
          // never land on an item this UPDATE didn't actually transition.
          // `COALESCE(v.card_code, pi.card_code)` never blanks a code that
          // is somehow already there.
          const cardCodes = printedItems.map((p) => p.cardCode);
          const [updatedRows]: [Array<{ id: string }>, number] =
            await manager.query(
              `UPDATE print_items AS pi
                SET status = 'PRINTED', printed_at = COALESCE(pi.printed_at, $3), card_code = COALESCE(v.card_code, pi.card_code), error_message = NULL, updated_at = now()
               FROM unnest($1::uuid[], $4::text[]) AS v(id, card_code)
              WHERE pi.id = v.id AND pi.batch_id = $2 AND pi.status = 'EXPORTED'
              RETURNING pi.id`,
              [ids, batchId, now, cardCodes],
            );
          const updatedIds = new Set(updatedRows.map((r) => r.id));
          const newlyPrinted = printedItems.filter((p) =>
            updatedIds.has(p.item.id),
          );
          const newlyPrintedItems = newlyPrinted.map((p) => p.item);

          // Every entry in `printedItems` was snapshotted EXPORTED (an
          // already-PRINTED item never gets here — see the split above), so
          // anything the guarded UPDATE didn't touch lost a genuine race:
          // something else moved it before this write landed. It must not
          // silently vanish from the counts (`printedCount` was
          // optimistically incremented for it above) nor be dropped from the
          // report.
          for (const p of printedItems) {
            if (updatedIds.has(p.item.id)) continue;
            printedCount--;
            unmatched++;
            reportRows.push({
              rowNo: p.rowNo,
              subjectCode: p.subjectCode,
              reason: RACE_LOST_REASON,
            });
          }

          if (newlyPrinted.length) {
            await manager.save(
              PrintItemEvent,
              newlyPrinted.map(({ item, cardCode }) =>
                this.events.create({
                  itemId: item.id,
                  fromStatus: item.status,
                  toStatus: 'PRINTED',
                  source: 'RESULT_UPLOAD',
                  actorUserId: uploadedByUserId,
                  message: cardCode
                    ? `Xác nhận đã in (upload file kết quả) — mã thẻ: ${cardCode}`
                    : 'Xác nhận đã in (upload file kết quả)',
                }),
              ),
            );

            // Feature 6 wiring (Giai đoạn 3 deferred this exact write to here
            // — see `campaign_subjects.printedAt`'s own doc comment). Grouped
            // by campaign since one print batch's items can span more than
            // one. `COALESCE` for the same double-upload reason as above.
            // `card_code` is set to exactly this card's code (null when none
            // was reported — NOT COALESCEd) so it always describes the same
            // card `printed_batch_id` is being re-pointed at, never a stale
            // code from an earlier print of the same student.
            const rosterByCampaign = new Map<
              string,
              { codes: string[]; cardCodes: Array<string | null> }
            >();
            for (const { item, cardCode } of newlyPrinted) {
              const entry = rosterByCampaign.get(item.campaignId) ?? {
                codes: [],
                cardCodes: [],
              };
              entry.codes.push(item.subjectCode);
              entry.cardCodes.push(cardCode);
              rosterByCampaign.set(item.campaignId, entry);
            }
            for (const [campaignId, entry] of rosterByCampaign) {
              await manager.query(
                `UPDATE campaign_subjects AS cs
                  SET printed_at = COALESCE(cs.printed_at, now()), printed_batch_id = $3, card_code = v.card_code, updated_at = now()
                 FROM unnest($2::text[], $4::text[]) AS v(subject_code, card_code)
                WHERE cs.campaign_id = $1 AND cs.subject_code = v.subject_code AND cs.status = 'VALID'`,
                [campaignId, entry.codes, batchId, entry.cardCodes],
              );
            }

            // Stock/stats bookkeeping — same "thao tác tay" path
            // `PrintItemService.markPrintedManually` already follows, just
            // looped per matched row; a printer that can't be resolved
            // (common for a CENTRALIZED batch with no `printerId`) simply
            // skips the stock decrement, same tolerant fallback that method
            // documents. Only rows that just transitioned to PRINTED reach
            // here, so a duplicate upload can never double-decrement stock or
            // double-count the daily stats.
            for (const item of newlyPrintedItems) {
              const printerId = item.printerId ?? batch.printerId ?? null;
              if (printerId) {
                await this.printerService.applyStockDelta(
                  manager,
                  printerId,
                  -1,
                  'PRINT',
                  uploadedByUserId,
                  'Xác nhận đã in (upload file kết quả)',
                );
              }
              await this.printStats.recordPrinted(
                manager,
                item.campaignId,
                printerId,
                now,
              );
            }
          }
        }

        if (cardCodeUpdates.length) {
          // Card-code-only update on already-PRINTED items — NEVER touches
          // status/printed_at/stock/stats. Own guard: `status = 'PRINTED' AND
          // batch_id = $2`, PLUS `card_code IS NOT DISTINCT FROM <the value
          // read at snapshot time>` (optimistic concurrency): the UPDATE only
          // lands if the stored code is still what the plan was built from,
          // so a concurrent upload that changed it in the meantime is
          // reported as a lost race instead of being overwritten, and the
          // event's from→to note below is always truthful. `IS NOT DISTINCT
          // FROM` (not `=`) because the stored value is usually NULL.
          // Same `[rows, affectedCount]` tuple rule as the UPDATEs above.
          const [changedRows]: [Array<{ id: string }>, number] =
            await manager.query(
              `UPDATE print_items AS pi
                SET card_code = v.card_code, updated_at = now()
               FROM unnest($1::uuid[], $3::text[], $4::text[]) AS v(id, card_code, old_card_code)
              WHERE pi.id = v.id AND pi.batch_id = $2 AND pi.status = 'PRINTED'
                AND pi.card_code IS NOT DISTINCT FROM v.old_card_code
              RETURNING pi.id`,
              [
                cardCodeUpdates.map((u) => u.item.id),
                batchId,
                cardCodeUpdates.map((u) => u.cardCode),
                cardCodeUpdates.map((u) => u.item.cardCode ?? null),
              ],
            );
          const changedIds = new Set(changedRows.map((r) => r.id));
          const changed = cardCodeUpdates.filter((u) =>
            changedIds.has(u.item.id),
          );

          // Same reconciliation as the PRINTED branch: `printedCount` counted
          // this row optimistically at planning time, so a row whose guarded
          // write didn't land is walked back out into an error.
          for (const u of cardCodeUpdates) {
            if (changedIds.has(u.item.id)) continue;
            printedCount--;
            unmatched++;
            reportRows.push({
              rowNo: u.rowNo,
              subjectCode: u.subjectCode,
              reason: RACE_LOST_REASON,
            });
          }

          if (changed.length) {
            await manager.save(
              PrintItemEvent,
              changed.map(({ item, cardCode }) =>
                this.events.create({
                  itemId: item.id,
                  fromStatus: 'PRINTED',
                  toStatus: 'PRINTED',
                  source: 'RESULT_UPLOAD',
                  actorUserId: uploadedByUserId,
                  message: item.cardCode
                    ? `Cập nhật mã thẻ (upload file kết quả): "${item.cardCode}" → "${cardCode}"`
                    : `Ghi nhận mã thẻ (upload file kết quả): (chưa có) → "${cardCode}"`,
                }),
              ),
            );

            // The student's "latest card code" — only when THIS batch is
            // still the one their latest print points at
            // (`printed_batch_id = $3`); if a newer print of the same
            // student has since re-pointed it, this older card's corrected
            // code must not overwrite the newer card's.
            const rosterByCampaign = new Map<
              string,
              { codes: string[]; cardCodes: string[] }
            >();
            for (const { item, cardCode } of changed) {
              const entry = rosterByCampaign.get(item.campaignId) ?? {
                codes: [],
                cardCodes: [],
              };
              entry.codes.push(item.subjectCode);
              entry.cardCodes.push(cardCode);
              rosterByCampaign.set(item.campaignId, entry);
            }
            for (const [campaignId, entry] of rosterByCampaign) {
              await manager.query(
                `UPDATE campaign_subjects AS cs
                  SET card_code = v.card_code, updated_at = now()
                 FROM unnest($2::text[], $4::text[]) AS v(subject_code, card_code)
                WHERE cs.campaign_id = $1 AND cs.subject_code = v.subject_code
                  AND cs.status = 'VALID' AND cs.printed_batch_id = $3`,
                [campaignId, entry.codes, batchId, entry.cardCodes],
              );
            }
          }
        }

        if (failedItems.length) {
          // Per-row error message AND per-row target status → `UPDATE ...
          // FROM (VALUES ...)`, not a single `ANY($1)` update (every row can
          // regress to a different prior status — see `resolvePriorStatus`).
          // `pi.status = 'EXPORTED' AND pi.batch_id = $N` — NOT `pi.status <>
          // v.target_status` (the old guard): every item reaching this
          // branch was snapshotted EXPORTED at `find()` time (an
          // already-PRINTED item is rejected before it ever gets here — see
          // the "Thẻ đã được ghi nhận in thành công" branch above), so this
          // guard is simply "is it STILL what we read" — the old one would
          // just as happily regress an item a concurrent upload had ALREADY
          // moved to PRINTED (stock already decremented for it) back down to
          // PENDING/RENDERED, since PENDING/RENDERED always differ from
          // whatever `v.target_status` is.
          const valuesSql = failedItems
            .map(
              (_, idx) =>
                `($${idx * 3 + 1}::uuid, $${idx * 3 + 2}::text, $${idx * 3 + 3}::varchar)`,
            )
            .join(', ');
          const batchIdParamIndex = failedItems.length * 3 + 1;
          const params = [
            ...failedItems.flatMap((f) => [
              f.item.id,
              f.message,
              f.targetStatus,
            ]),
            batchId,
          ];
          const [regressedRows]: [Array<{ id: string }>, number] =
            await manager.query(
              `UPDATE print_items AS pi
                SET status = v.target_status, error_message = v.msg, printed_at = NULL, updated_at = now()
               FROM (VALUES ${valuesSql}) AS v(id, msg, target_status)
              WHERE pi.id = v.id AND pi.batch_id = $${batchIdParamIndex} AND pi.status = 'EXPORTED'
              RETURNING pi.id`,
              params,
            );
          const regressedIds = new Set(regressedRows.map((r) => r.id));
          const regressedItems = failedItems.filter(({ item }) =>
            regressedIds.has(item.id),
          );

          // Every entry here was snapshotted EXPORTED — unlike the PRINTED
          // branch above, there is no legitimate "expected no-op" case, so
          // anything the guarded UPDATE didn't touch lost a genuine race.
          for (const f of failedItems) {
            if (regressedIds.has(f.item.id)) continue;
            failedCount--;
            unmatched++;
            reportRows.push({
              rowNo: f.rowNo,
              subjectCode: f.subjectCode,
              reason: RACE_LOST_REASON,
            });
          }

          if (regressedItems.length) {
            await manager.save(
              PrintItemEvent,
              regressedItems.map(({ item, message, targetStatus }) =>
                this.events.create({
                  itemId: item.id,
                  fromStatus: item.status,
                  toStatus: targetStatus,
                  source: 'RESULT_UPLOAD',
                  actorUserId: uploadedByUserId,
                  message,
                }),
              ),
            );

            const codesByCampaign = new Map<string, string[]>();
            for (const { item } of regressedItems) {
              const list = codesByCampaign.get(item.campaignId) ?? [];
              list.push(item.subjectCode);
              codesByCampaign.set(item.campaignId, list);
            }
            for (const [campaignId, codes] of codesByCampaign) {
              await manager.query(
                `UPDATE campaign_subjects
                  SET printed_at = NULL, printed_batch_id = NULL, updated_at = now()
                WHERE campaign_id = $1 AND subject_code = ANY($2) AND status = 'VALID'`,
                [campaignId, codes],
              );
            }

            for (const { item } of regressedItems) {
              await this.printStats.recordFailed(
                manager,
                item.campaignId,
                item.printerId ?? batch.printerId ?? null,
                now,
              );
            }
          }
        }

        // Bẫy 5 — recompute the batch's maintained counters from a real
        // COUNT in this same transaction, rather than incrementing N times;
        // this also self-heals any drift that predates this specific upload.
        // A print-failure from a result upload lands the item back on its
        // real prior status — RENDERED or PENDING, see `resolvePriorStatus`
        // — with `error_message` set (never `FAILED`, see
        // `PRINT_ITEM_STATUS`'s own doc comment on why); counting only
        // `status = 'FAILED'` here would silently reset `failedCount` to 0
        // on every such upload, making every upload-reported print failure
        // invisible in the batch summary, so BOTH regressed statuses are
        // counted whenever they carry an `error_message`.
        const [counts]: Array<{
          printed: number;
          failed: number;
          total: number;
        }> = await manager.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'PRINTED')::int AS printed,
                  COUNT(*) FILTER (WHERE status = 'FAILED' OR (status IN ('RENDERED', 'PENDING') AND error_message IS NOT NULL))::int AS failed,
                  COUNT(*)::int AS total
             FROM print_items WHERE batch_id = $1`,
          [batchId],
        );
        await manager.update(PrintBatch, batchId, {
          printedCount: counts.printed,
          failedCount: counts.failed,
          itemCount: counts.total,
        });

        // Bẫy 4's reopen rule — only when this upload actually sent an item
        // back to a prior (not-yet-printed) status, and only if the batch
        // had already been marked DONE; goes to READY (not PRINTING),
        // matching `exportPackage()`'s own precondition so "Xuất gói" can
        // run again immediately.
        if (failedItems.length > 0) {
          await manager.query(
            `UPDATE print_batches SET status = 'READY', done_at = NULL WHERE id = $1 AND status = 'DONE'`,
            [batchId],
          );
        }

        await manager.update(PrintResultImport, importRow.id, {
          status: 'DONE',
          totalRows: rows.length,
          matchedRows: matched,
          printedRows: printedCount,
          failedRows: failedCount,
          unmatchedRows: unmatched,
        });
      });
    } catch (error) {
      // Without this, any error inside the transaction (most realistically
      // `PrinterService.applyStockDelta`'s `ConflictException` when a
      // printer's `blank_stock` runs out mid-upload) rolls back every item
      // update but leaves `importRow` — already committed as PROCESSING
      // above, outside this transaction — stuck at "Đang xử lý" forever,
      // and the whole upload fails with no result recorded anywhere.
      const failureReason = (error as Error).message;
      await this.imports.update(importRow.id, {
        status: 'FAILED',
        failureReason,
      });
      throw error;
    }

    // Best-effort, outside the transaction — same precedent
    // `CampaignSubjectService.importRoster` follows for its own two
    // uploads.
    let errorReportFsFileId: string | null = null;
    if (reportRows.length > 0) {
      try {
        const buffer = await this.buildErrorReport(reportRows);
        const result = await this.fileStorage.uploadRaw({
          virtualPath: `print-batches/${batchId}/result-imports/${importRow.id}-errors.xlsx`,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: new Uint8Array(buffer),
          idempotencyKey: randomUUID(),
          visibility: 'public',
        });
        errorReportFsFileId = result.fileId;
      } catch (error) {
        this.logger.warn(
          `error-report upload failed for result import ${importRow.id}: ${(error as Error).message}`,
        );
      }
    }

    let fsFileId: string | null = null;
    try {
      const result = await this.fileStorage.uploadRaw({
        virtualPath: `print-batches/${batchId}/result-imports/${importRow.id}-${file.originalname}`,
        mimeType: file.mimetype,
        data: new Uint8Array(file.buffer),
        idempotencyKey: randomUUID(),
        visibility: 'public',
      });
      fsFileId = result.fileId;
    } catch (error) {
      this.logger.warn(
        `original-file upload failed for result import ${importRow.id}: ${(error as Error).message}`,
      );
    }

    await this.imports.update(importRow.id, { errorReportFsFileId, fsFileId });

    const dao = await this.toDao({
      ...importRow,
      status: 'DONE',
      totalRows: rows.length,
      matchedRows: matched,
      printedRows: printedCount,
      failedRows: failedCount,
      unmatchedRows: unmatched,
      errorReportFsFileId,
      fsFileId,
    });
    // Inline, response-only — NOT persisted (no new column/migration): the
    // CMS needs these visible the moment the upload finishes, not only via
    // the downloadable `errorReportUrl` xlsx. A later `listImports()`/
    // `getImport()` for this same row won't have them (nothing to rebuild
    // them from), which is fine — those already have `errorReportUrl` for
    // reviewing an old upload's rejected rows.
    dao.errors = reportRows;
    return dao;
  }

  async listImports(batchId: string): Promise<PrintResultImportDao[]> {
    await this.assertBatchExists(batchId);
    const rows = await this.imports.find({
      where: { batchId },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((r) => this.toDao(r)));
  }

  async getImport(
    batchId: string,
    importId: string,
  ): Promise<PrintResultImportDao> {
    await this.assertBatchExists(batchId);
    const row = await this.imports.findOne({
      where: { id: importId, batchId },
    });
    if (!row)
      throw new NotFoundException('Không tìm thấy lần upload kết quả in');
    return this.toDao(row);
  }

  /** Same 4 result-related column headers `PrintPackageService`'s own `danh-sach-in.xlsx` export uses (`Mã SV`/`Tình trạng`/`Mã thẻ`/`Lý do`), so a fresh template and the real export stay interchangeable through `parseWorkbook`'s `HEADER_ALIASES`. `Mã thẻ` cells are pre-formatted as Text so a code typed with leading zeros survives the upload (see `numberToPlainString`). */
  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ket qua in');
    sheet.addRow(['Mã SV', 'Tình trạng', 'Mã thẻ', 'Lý do']);
    sheet.addRow(['SV001', 'Đã in', 'TH0001', '']);
    sheet.addRow(['SV002', 'In thất bại', '', 'Kẹt giấy']);
    sheet.getColumn(3).numFmt = '@';
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async assertBatchExists(batchId: string): Promise<void> {
    const exists = await this.batches.exist({ where: { id: batchId } });
    if (!exists) throw new NotFoundException('Không tìm thấy đợt in');
  }

  private async toDao(row: PrintResultImport): Promise<PrintResultImportDao> {
    const dao = new PrintResultImportDao();
    dao.id = row.id;
    dao.batchId = row.batchId;
    dao.fileName = row.fileName;
    dao.uploadedByUserId = row.uploadedByUserId ?? null;
    dao.status = row.status;
    dao.totalRows = row.totalRows;
    dao.matchedRows = row.matchedRows;
    dao.printedRows = row.printedRows;
    dao.failedRows = row.failedRows;
    dao.unmatchedRows = row.unmatchedRows;
    dao.failureReason = row.failureReason ?? null;
    dao.createdAt = row.createdAt;
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

  private async parseWorkbook(buffer: Buffer): Promise<ParsedResultRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('File không có sheet nào');

    const headerRow = sheet.getRow(1);
    const columnByField: Partial<Record<ResultFieldKey, number>> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = this.cellToString(cell.value);
      if (!text) return;
      const field = NORMALIZED_HEADER_ALIASES[normalizeText(text)];
      if (field && columnByField[field] === undefined) {
        columnByField[field] = colNumber;
      }
    });

    const missingRequired = REQUIRED_FIELDS.filter(
      (f) => columnByField[f] === undefined,
    );
    if (missingRequired.length > 0) {
      throw new Error(
        `Không tìm thấy cột bắt buộc trong dòng tiêu đề: ${missingRequired.join(', ')}`,
      );
    }

    const rows: ParsedResultRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const excelRow = sheet.getRow(r);
      if (excelRow.cellCount === 0) continue;
      const get = (field: ResultFieldKey): string | null => {
        const col = columnByField[field];
        return col === undefined
          ? null
          : this.cellToString(excelRow.getCell(col).value);
      };
      const subjectCode = get('subjectCode');
      const printStatus = get('printStatus');
      if (!subjectCode && !printStatus) continue; // fully blank row
      rows.push({
        rowNo: r,
        subjectCode,
        printStatus,
        errorReason: get('errorReason'),
        cardCode: get('cardCode'),
      });
    }
    return rows;
  }

  private cellToString(value: ExcelJS.CellValue): string | null {
    if (value == null) return null;
    if (typeof value === 'number') return numberToPlainString(value);
    if (typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      // A cell with mixed-format runs comes back as `{ richText: [...] }` —
      // without this it would read as empty (a card code / status typed into
      // such a cell would be silently dropped).
      if ('richText' in value) {
        return (
          value.richText
            .map((run) => run.text)
            .join('')
            .trim() || null
        );
      }
      if ('text' in value)
        return String((value as { text: unknown }).text).trim() || null;
      if ('result' in value) {
        const result = (value as { result: unknown }).result;
        if (typeof result === 'number') return numberToPlainString(result);
        return String(result).trim() || null;
      }
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }

  private async buildErrorReport(
    rows: Array<{ rowNo: number; subjectCode: string | null; reason: string }>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lỗi');
    sheet.addRow(['Dòng', 'Mã SV', 'Lý do']);
    for (const row of rows) {
      sheet.addRow([row.rowNo, row.subjectCode ?? '', row.reason]);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
