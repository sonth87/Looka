import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PRINT_ITEM_STATUSES, type PrintItemStatus } from '../print.constants';
import { PrintBatch } from './print-batch.entity';
import { Printer } from './printer.entity';

export interface PrintItemExtra {
  dob?: string | null;
  cardValidUntil?: string | null;
  barcode?: string | null;
  [key: string]: unknown;
}

/**
 * One person's printable card item — plan §2.5. `setId` (→
 * `subject_photo_sets`, photo-review) and `variantId` (→ `photo_variants`)
 * carry no FK — cross-module, see the migration's top comment.
 *
 * `campaignId`/`subjectCode`/`fullName`/`className`/`faculty` are
 * denormalized off the set (and, if the set is missing a field, off
 * `campaign_subjects`) at `bulkCreate` time — plan §2.5's "person-data
 * source priority" list, implemented in `PrintItemService.resolvePersonData`.
 * A field neither source has is left `null`, never guessed; the CMS is
 * expected to `PATCH /v1/print/items/:id` to hand-fix it (see
 * `PrintItemDetailDao.missingFields`, computed at read time from these
 * columns rather than stored, so it can never drift from them).
 *
 * `variantId` is resolved from `subject_photo_sets.current_card_variant_id`
 * ONCE, at `bulkCreate` (or explicit `render`) time — "chốt tại thời điểm
 * render" (plan's own wording): a later change to the subject's approved
 * photo must not silently change what an already-rendered item prints. See
 * `PrintItemService.render`'s own doc comment for the one path that DOES
 * refresh it.
 */
@Entity('print_items')
export class PrintItem extends BaseEntity {
  @Column('uuid', { name: 'batch_id', nullable: true })
  @Index()
  @ApiPropertyOptional({
    description: 'Đợt in chứa item này — null nếu chưa gán đợt',
  })
  batchId?: string | null;

  @ManyToOne(() => PrintBatch, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch?: PrintBatch | null;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign (denormalized từ subject_photo_sets)' })
  campaignId: string;

  @Column('uuid', { name: 'set_id' })
  @Index()
  @ApiProperty({ description: 'Hồ sơ ảnh nguồn (subject_photo_sets.id)' })
  setId: string;

  @Column('uuid', { name: 'variant_id', nullable: true })
  @ApiPropertyOptional({
    description:
      'Ảnh thẻ dùng để in — chốt tại thời điểm tạo/render, xem doc comment của entity',
  })
  variantId?: string | null;

  @Column('varchar', { length: 100, name: 'subject_code' })
  @ApiProperty({ description: 'Mã người (mã SV)' })
  subjectCode: string;

  @Column('varchar', { length: 255, name: 'full_name', nullable: true })
  @ApiPropertyOptional({ description: 'Họ tên' })
  fullName?: string | null;

  @Column('varchar', { length: 100, name: 'class_name', nullable: true })
  @ApiPropertyOptional({ description: 'Lớp' })
  className?: string | null;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Khoa' })
  faculty?: string | null;

  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({
    description: 'Dữ liệu bổ sung: dob, cardValidUntil, barcode…',
  })
  extra?: PrintItemExtra | null;

  @Column('uuid', { name: 'template_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Phôi in riêng cho item này — override đợt/máy in',
  })
  templateId?: string | null;

  @Column('varchar', {
    length: 255,
    name: 'rendered_front_fs_file_id',
    nullable: true,
  })
  @ApiPropertyOptional({ description: 'file_id ảnh mặt trước đã render' })
  renderedFrontFsFileId?: string | null;

  @Column('varchar', {
    length: 255,
    name: 'rendered_back_fs_file_id',
    nullable: true,
  })
  @ApiPropertyOptional({ description: 'file_id ảnh mặt sau đã render' })
  renderedBackFsFileId?: string | null;

  @Column('timestamptz', { name: 'rendered_at', nullable: true })
  @ApiPropertyOptional({ description: 'Lần render gần nhất' })
  renderedAt?: Date | null;

  /**
   * Giai đoạn 4 (plan §4.2, feature 3) — lần xuất gói gần nhất mà item này
   * nằm trong file zip (`PrintBatchService.exportPackage`). Xuất lại lần
   * nữa (item đã `EXPORTED`/`PRINTED`) chỉ cập nhật mốc này, không lùi lại
   * trạng thái.
   */
  @Column('timestamptz', { name: 'exported_at', nullable: true })
  @ApiPropertyOptional({ description: 'Lần xuất gói gần nhất có mặt item này' })
  exportedAt?: Date | null;

  @Column('varchar', { length: 20, default: 'PENDING' })
  @Index()
  @ApiProperty({ description: 'Trạng thái item', enum: PRINT_ITEM_STATUSES })
  status: PrintItemStatus;

  @Column('uuid', { name: 'printer_id', nullable: true })
  @ApiPropertyOptional({ description: 'Máy in đã/đang xử lý item này' })
  printerId?: string | null;

  @ManyToOne(() => Printer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'printer_id' })
  printer?: Printer | null;

  @Column('timestamptz', { name: 'printed_at', nullable: true })
  @ApiPropertyOptional({
    description:
      'Thời điểm in — CHỈ được set bởi callback print-agent hoặc thao tác tay (source=MANUAL), không bao giờ suy luận (BA #14)',
  })
  printedAt?: Date | null;

  @Column('text', { name: 'error_message', nullable: true })
  @ApiPropertyOptional({ description: 'Lỗi gần nhất (render hoặc in)' })
  errorMessage?: string | null;

  @Column('uuid', { name: 'reprint_of_item_id', nullable: true })
  @ApiPropertyOptional({ description: 'Item gốc nếu đây là bản in lại' })
  reprintOfItemId?: string | null;
}
