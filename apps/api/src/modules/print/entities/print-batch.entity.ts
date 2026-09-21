import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { PrintBatchMode, PrintBatchStatus } from '../print.constants';
import { Printer } from './printer.entity';

/**
 * A named batch of `print_items` sent to print together — plan §2.5.
 * `campaignId`/`defaultTemplateId` reference other modules' tables (no FK,
 * see the migration's top comment); `printerId` is an in-module FK since
 * `printers` lives in this same module/migration.
 *
 * `itemCount`/`printedCount`/`failedCount` are maintained counters (updated
 * by `PrintItemService`/`PrintBatchService` alongside the item writes that
 * change them), not computed via `COUNT(*)` on every read — same
 * "maintained counter, not a live aggregate" choice `campaigns` makes for
 * nothing directly comparable here, but matching this module's own
 * `PrintStatsService` hot-path-counter pattern (see that service's doc
 * comment) rather than a query-time aggregate, since batch list rows are
 * read far more often than items change.
 */
@Entity('print_batches')
export class PrintBatch extends BaseEntity {
  @Column('varchar', { length: 50 })
  @ApiProperty({ description: 'Mã đợt in' })
  code: string;

  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên đợt in' })
  name: string;

  @Column('uuid', { name: 'campaign_id', nullable: true })
  @Index()
  @ApiPropertyOptional({ description: 'Campaign gắn với đợt in này, nếu có' })
  campaignId?: string | null;

  @Column('uuid', { name: 'default_template_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Phôi in mặc định cho các item chưa override',
  })
  defaultTemplateId?: string | null;

  @Column('uuid', { name: 'printer_id', nullable: true })
  @ApiPropertyOptional({ description: 'Máy in gắn với đợt (chế độ DIRECT)' })
  printerId?: string | null;

  @ManyToOne(() => Printer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'printer_id' })
  printer?: Printer | null;

  @Column('varchar', { length: 12, default: 'CENTRALIZED' })
  @ApiProperty({ description: 'DIRECT | CENTRALIZED' })
  mode: PrintBatchMode;

  @Column('varchar', { length: 12, default: 'DRAFT' })
  @Index()
  @ApiProperty({ description: 'DRAFT | READY | PRINTING | DONE | CANCELLED' })
  status: PrintBatchStatus;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  @ApiPropertyOptional({ description: 'Người tạo đợt in' })
  createdByUserId?: string | null;

  @Column('int', { name: 'item_count', default: 0 })
  @ApiProperty({ description: 'Tổng số item trong đợt' })
  itemCount: number;

  @Column('int', { name: 'printed_count', default: 0 })
  @ApiProperty({ description: 'Số item đã in' })
  printedCount: number;

  @Column('int', { name: 'failed_count', default: 0 })
  @ApiProperty({ description: 'Số item lỗi' })
  failedCount: number;

  @Column('timestamptz', { name: 'sent_at', nullable: true })
  @ApiPropertyOptional({
    description: 'Thời điểm gửi in (DIRECT) / xuất gói gần nhất (CENTRALIZED)',
  })
  sentAt?: Date | null;

  @Column('timestamptz', { name: 'done_at', nullable: true })
  @ApiPropertyOptional({ description: 'Thời điểm hoàn tất đợt' })
  doneAt?: Date | null;

  /** Giai đoạn 4 (plan §4.2) — mirror của `print_items.exportedAt` mới nhất trong đợt, chỉ để hiển thị (CMS không cần join sang print_items để biết "lần xuất gần nhất"). */
  @Column('timestamptz', { name: 'last_exported_at', nullable: true })
  @ApiPropertyOptional({ description: 'Lần xuất gói gần nhất của đợt' })
  lastExportedAt?: Date | null;
}
