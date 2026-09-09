import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PhotoReviewSetStatus } from '../photo-review.constants';
import { PhotoKind } from './photo-kind.entity';

/**
 * One person's photo-review record within one campaign (plan §2) — "hồ sơ
 * ảnh". `currentCardVariantId` deliberately has NO foreign-key constraint
 * to `photo_variants` (see this module's schema migration's own comment):
 * the two tables would otherwise need a chicken-and-egg two-step migration
 * for a pointer the application already guards carefully — every write to
 * this column goes through `PhotoReviewService`, which always checks the
 * variant belongs to this set and is not `DISCARDED` first, and
 * `photo_variants` rows are never hard-deleted (only `DISCARDED`), so a
 * dangling pointer cannot occur in practice.
 *
 * Locking (plan §4) reads `status`/`currentCardVariantId` together — see
 * `PhotoReviewService.assertUnlocked`.
 *
 * `campaignId`/`sourceSessionId` are plain uuid columns with no FK, by
 * design: this module must not structurally depend on `device-management`
 * or `capture` (both owned/edited by other agents concurrently) — see this
 * module's own `photo-review.module.ts` top comment.
 */
@Entity('subject_photo_sets')
@Index('IDX_subject_photo_sets_unique', ['campaignId', 'subjectCode', 'kindId'], {
  unique: true,
})
export class SubjectPhotoSet extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign chứa hồ sơ này' })
  campaignId: string;

  @Column('varchar', { length: 100, name: 'subject_code' })
  @ApiProperty({ description: 'Mã định danh người (mã SV)' })
  subjectCode: string;

  @Column('varchar', { length: 255, name: 'subject_name', nullable: true })
  @ApiPropertyOptional({ description: 'Tên người, nếu có' })
  subjectName?: string | null;

  @Column('uuid', { name: 'kind_id' })
  @ApiProperty({ description: 'Loại ảnh (photo_kinds.id)' })
  kindId: string;

  @ManyToOne(() => PhotoKind, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'kind_id' })
  kind?: PhotoKind;

  @Column('uuid', { name: 'source_session_id' })
  @ApiProperty({ description: 'Phiên chụp gốc mới nhất mà hồ sơ này bắt nguồn' })
  sourceSessionId: string;

  @Column('varchar', { length: 20, default: PhotoReviewSetStatus.PENDING_AUTO })
  @ApiProperty({ description: 'Trạng thái hồ sơ', enum: PhotoReviewSetStatus })
  status: PhotoReviewSetStatus;

  @Column('uuid', { name: 'current_card_variant_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Phiên bản ảnh thẻ hiện tại (photo_variants.id) — không có FK cứng, xem doc comment của entity',
  })
  currentCardVariantId?: string | null;
}
