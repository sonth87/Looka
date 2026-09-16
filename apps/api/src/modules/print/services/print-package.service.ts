import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { PrintItem } from '../entities/print-item.entity';
import { PrintBatch } from '../entities/print-batch.entity';

/**
 * `GET /v1/print/batches/:id/package` — plan §2.5, "supersedes
 * `GET /v1/review/export`" (the review module's own export stays in place,
 * unchanged — see the task brief's own note). Same `archiver` +
 * `PassThrough` zip-building shape as `PhotoReviewService.exportApproved`/
 * `ActivationPackageService.buildActivationZip` (already a dependency, no
 * new one added), built fresh on every call rather than cached — a batch's
 * items can be re-rendered after the package was last downloaded, and
 * caching would risk handing out a stale zip; `review/export` makes the
 * same "build on demand" choice for the same reason.
 */
@Injectable()
export class PrintPackageService {
  private readonly logger = new Logger(PrintPackageService.name);

  constructor(
    @InjectRepository(PrintItem) private readonly items: Repository<PrintItem>,
    private readonly fileStorage: FileStorageService,
  ) {}

  async buildPackage(batch: PrintBatch, itemIds?: string[]): Promise<Buffer> {
    const where: FindOptionsWhere<PrintItem> = { batchId: batch.id };
    if (itemIds?.length) where.id = In(itemIds);
    const items = await this.items.find({
      where,
      order: { subjectCode: 'ASC' },
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(output);

    const manifestLines = ['subject_code,full_name,class_name,status'];
    const csvField = (value: string) => `"${value.replace(/"/g, '""')}"`;

    for (const item of items) {
      await this.appendSide(archive, item, 'front', item.renderedFrontFsFileId);
      await this.appendSide(archive, item, 'back', item.renderedBackFsFileId);
      manifestLines.push(
        [
          csvField(item.subjectCode),
          csvField(item.fullName ?? ''),
          csvField(item.className ?? ''),
          item.status,
        ].join(','),
      );
    }

    archive.append(manifestLines.join('\n'), { name: 'manifest.csv' });
    await archive.finalize();
    return done;
  }

  private async appendSide(
    archive: archiver.Archiver,
    item: PrintItem,
    side: 'front' | 'back',
    fsFileId: string | null | undefined,
  ): Promise<void> {
    if (!fsFileId) return; // not rendered yet — manifest's `status` column already flags this
    try {
      const link = await this.fileStorage.issueViewLink(
        fsFileId,
        'print-package',
      );
      const response = await fetch(link.url);
      if (!response.ok) {
        this.logger.warn(
          `package download failed for item ${item.id} (${side}): HTTP ${response.status}`,
        );
        return;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      archive.append(buf, { name: `${item.subjectCode}-${side}.png` });
    } catch (error) {
      this.logger.warn(
        `package download failed for item ${item.id} (${side}): ${(error as Error).message}`,
      );
    }
  }
}
