import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import sharp from 'sharp';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { PrintItem } from '../entities/print-item.entity';
import { PrintBatch } from '../entities/print-batch.entity';

/**
 * Turns a `subject_code` into a safe zip-entry base name. `subject_code`
 * is free text — kiosk `CreateSessionDto` only checks `@IsString()
 * @MaxLength(100)`, and roster Excel imports/QR-barcode scans feed it too
 * — and `archiver`'s own path normalization only strips a LEADING
 * `../`/`/`, leaving a `..` in the MIDDLE of the string untouched (zip-slip:
 * a code like `SV01/../../../evil` survives into the archive entry name
 * unchanged). Collapsing every path separator and non-word character also
 * keeps entries flat — a code containing `/` would otherwise silently
 * create a nested folder inside the zip instead of a flat `{code}.jpg`
 * file.
 */
function safeZipBaseName(item: PrintItem): string {
  const cleaned = item.subjectCode
    .normalize('NFC')
    .replace(/[\\/]/g, '_')
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    .replace(/^\.+/, '');
  return cleaned || item.id;
}

/** First 3 bytes of a real JPEG file (`FF D8 FF`) — cheaper and more trustworthy than trusting a file-service `content-type` header, which this codebase doesn't even store for `photo_variants` (see `PhotoVariant` entity — no `mimeType` column). */
function isJpeg(buf: Buffer): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

/**
 * Hands back `base`, `base_2`, `base_3`, … the 1st/2nd/3rd time a given
 * base name is seen — a deterministic disambiguation for the rare case two
 * items in the same package export to the same sanitized `subject_code`
 * (duplicate/typo'd codes across campaigns mixed into one batch), rather
 * than silently letting the later `archive.append` overwrite the earlier
 * entry.
 */
function nextZipName(base: string, seen: Map<string, number>): string {
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}_${count}`;
}

interface SetEligibilityRow {
  set_id: string;
  status: string;
  current_card_variant_id: string | null;
  fs_file_id: string | null;
  fs_status: string | null;
}

/**
 * `GET/POST /v1/print/batches/:id/package` — plan §2.5, later reshaped by
 * the 2026-09-25 product decision on CENTRALIZED export output: the zip
 * used to carry each item's RENDERED card-template PNGs (front/back) plus
 * a `manifest.csv`. It now carries exactly ONE image per item — the
 * APPROVED, AI-processed card photo (`subject_photo_sets.current_card_variant_id`),
 * the same photo `CardTemplateRenderService.resolveCardPhoto` bakes into a
 * rendered card — named `{subjectCode}.jpg`, plus a `danh-sach-in.xlsx`
 * list in the exact format `PrintResultImportService` accepts back
 * (same header names — see `HEADER_ALIASES` there — so the print shop can
 * fill this file in and upload it unchanged). Eligibility is re-checked
 * HERE, against the live `subject_photo_sets`/`photo_variants` rows, not
 * against `print_items.variantId` (frozen at render/bulkCreate time) — a
 * set can be rejected/reopened, or its current variant swapped, after the
 * print item was created (same reasoning `PrintItemService.render`'s own
 * doc comment gives for re-checking `status = 'APPROVED'` right before
 * baking a photo into a printable card).
 *
 * Same `archiver` + `PassThrough` zip-building shape as
 * `PhotoReviewService.exportApproved`/`ActivationPackageService
 * .buildActivationZip` (already a dependency, no new one added), built
 * fresh on every call rather than cached — an item's current card photo
 * can change after the package was last downloaded, and caching would risk
 * handing out a stale zip; `review/export` makes the same "build on
 * demand" choice for the same reason.
 */
@Injectable()
export class PrintPackageService {
  private readonly logger = new Logger(PrintPackageService.name);

  constructor(
    @InjectRepository(PrintItem) private readonly items: Repository<PrintItem>,
    private readonly fileStorage: FileStorageService,
  ) {}

  async buildPackage(
    batch: PrintBatch,
    itemIds?: string[],
  ): Promise<{
    zip: Buffer;
    /** ids whose card photo actually made it into the zip. */
    includedItemIds: string[];
    /** ids that could not be packaged — set no longer APPROVED, no current card variant, or the download/convert itself failed. */
    failedItemIds: string[];
  }> {
    const where: FindOptionsWhere<PrintItem> = { batchId: batch.id };
    if (itemIds?.length) where.id = In(itemIds);
    const items = await this.items.find({
      where,
      order: { subjectCode: 'ASC' },
    });

    // `cohort` ("khóa") is a `campaigns` column, not denormalized onto
    // `print_items` the way `className`/`faculty` are — items span at most
    // a handful of distinct campaigns per batch in practice, so one batched
    // lookup here is simpler than a migration to add the column.
    const campaignIds = [...new Set(items.map((i) => i.campaignId))];
    const cohortByCampaignId = new Map<string, string | null>();
    if (campaignIds.length > 0) {
      const rows: Array<{ id: string; cohort: string | null }> =
        await this.items.manager.query(
          `SELECT id, cohort FROM campaigns WHERE id = ANY($1)`,
          [campaignIds],
        );
      for (const row of rows) cohortByCampaignId.set(row.id, row.cohort);
    }

    // One batched read of every item's SET (not `print_items.variantId`,
    // frozen at render/bulkCreate time — see this class's own doc comment)
    // — mirrors `CardTemplateRenderService.resolveCardPhoto`'s own
    // `fs_status NOT IN ('FAILED', 'QUARANTINED')` guard: a variant row can
    // exist with a `current_card_variant_id` set yet have no usable file
    // (upload still scanning, or fs-core discarded it), which is not
    // meaningfully different from "no current card variant" for export
    // purposes.
    const setIds = [...new Set(items.map((i) => i.setId))];
    const eligibilityRows: SetEligibilityRow[] =
      setIds.length > 0
        ? await this.items.manager.query(
            `SELECT s.id AS set_id, s.status, s.current_card_variant_id,
                    cv.fs_file_id AS fs_file_id, cv.fs_status AS fs_status
               FROM subject_photo_sets s
               LEFT JOIN photo_variants cv ON cv.id = s.current_card_variant_id
              WHERE s.id = ANY($1)`,
            [setIds],
          )
        : [];
    const eligibilityBySetId = new Map(
      eligibilityRows.map((row) => [row.set_id, row]),
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(output);

    const includedItemIds: string[] = [];
    const failedItemIds: string[] = [];
    const includedItems: PrintItem[] = [];
    const usedNames = new Map<string, number>();

    for (const item of items) {
      const elig = eligibilityBySetId.get(item.setId);
      const eligible =
        !!elig &&
        elig.status === 'APPROVED' &&
        !!elig.current_card_variant_id &&
        !!elig.fs_file_id &&
        elig.fs_status !== 'FAILED' &&
        elig.fs_status !== 'QUARANTINED';
      if (!eligible) {
        failedItemIds.push(item.id);
        continue;
      }
      try {
        const link = await this.fileStorage.issueViewLink(
          // `elig` itself is narrowed non-undefined by `eligible` above (TS's
          // aliased-condition control-flow analysis); `fs_file_id` still
          // needs the cast since that narrowing doesn't fully propagate
          // through a `Map.get()`-sourced property truthiness check.
          elig.fs_file_id as string,
          'print-package',
        );
        const response = await fetch(link.url);
        if (!response.ok) {
          this.logger.warn(
            `package download failed for item ${item.id}: HTTP ${response.status}`,
          );
          failedItemIds.push(item.id);
          continue;
        }
        const raw = Buffer.from(await response.arrayBuffer());
        // Pass real JPEG bytes through unchanged; anything else (the card
        // AI pipeline can also hand back PNG) is re-encoded to JPEG q95
        // WITHOUT resizing, so pixel dimensions are preserved.
        const jpeg = isJpeg(raw)
          ? raw
          : await sharp(raw).jpeg({ quality: 95 }).toBuffer();
        const name = nextZipName(safeZipBaseName(item), usedNames);
        archive.append(jpeg, { name: `${name}.jpg` });
        includedItemIds.push(item.id);
        includedItems.push(item);
      } catch (error) {
        this.logger.warn(
          `package download/convert failed for item ${item.id}: ${(error as Error).message}`,
        );
        failedItemIds.push(item.id);
      }
    }

    const listBuffer = await this.buildResultListWorkbook(
      includedItems,
      cohortByCampaignId,
    );
    archive.append(listBuffer, { name: 'danh-sach-in.xlsx' });

    await archive.finalize();
    const zip = await done;
    return { zip, includedItemIds, failedItemIds };
  }

  /**
   * `danh-sach-in.xlsx` — same header names `PrintResultImportService
   * .HEADER_ALIASES` recognizes (`Mã SV`, `Tình trạng`, `Lý do`), so the
   * print shop can fill THIS file in and upload it straight back through
   * `POST /v1/print/batches/:id/result-imports` unchanged. `Tình trạng`/`Lý
   * do` are left blank for the print shop; a data-validation dropdown on
   * `Tình trạng` (Đã in / In thất bại) keeps that column's free text
   * matching `PRINTED_VALUES`/`FAILED_VALUES` there. Only items whose photo
   * actually made it into the zip are listed — a row with no matching
   * image in the package would be meaningless for the print shop to mark.
   */
  private async buildResultListWorkbook(
    includedItems: PrintItem[],
    cohortByCampaignId: Map<string, string | null>,
  ): Promise<Buffer> {
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
    includedItems.forEach((item, idx) => {
      sheet.addRow([
        idx + 1,
        item.subjectCode,
        item.fullName ?? '',
        item.className ?? '',
        item.faculty ?? '',
        cohortByCampaignId.get(item.campaignId) ?? '',
        '',
        '',
      ]);
    });
    // Dropdown on `Tình trạng` (column G) for every data row — allowBlank so
    // the print shop can leave a row untouched until it's actually printed.
    for (let row = 2; row <= includedItems.length + 1; row += 1) {
      sheet.getCell(`G${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Đã in,In thất bại"'],
      };
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
