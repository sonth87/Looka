import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PhotoReviewAction } from '../photo-review.constants';
import { PhotoVariant } from './photo-variant.entity';
import { SubjectPhotoSet } from './subject-photo-set.entity';

/**
 * Audit trail (plan §2) — written on every state-changing action in this
 * module, no exceptions (see `PhotoReviewService`'s own top comment).
 * `at` is a separate column from the inherited `createdAt` on purpose: the
 * plan's data model (§2) names the timestamp field `at` explicitly, and
 * some events (currently none, but kept for future flexibility) could in
 * principle be recorded slightly after they logically happened.
 */
@Entity('photo_review_events')
export class PhotoReviewEvent extends BaseEntity {
  @Column('uuid', { name: 'set_id' })
  @Index()
  @ApiProperty({ description: 'Hồ sơ liên quan' })
  setId: string;

  @ManyToOne(() => SubjectPhotoSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'set_id' })
  set?: SubjectPhotoSet;

  @Column('uuid', { name: 'variant_id', nullable: true })
  @ApiPropertyOptional({ description: 'Phiên bản liên quan, nếu có' })
  variantId?: string | null;

  @ManyToOne(() => PhotoVariant, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'variant_id' })
  variant?: PhotoVariant;

  @Column('varchar', { length: 30 })
  @ApiProperty({ description: 'Hành động', enum: PhotoReviewAction })
  action: PhotoReviewAction;

  @Column('uuid', { name: 'actor_user_id', nullable: true })
  @ApiPropertyOptional({ description: 'Người thực hiện, null nếu hệ thống tự động' })
  actorUserId?: string | null;

  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({ description: 'Chi tiết bổ sung (vd lỗi, prompt, độ giống)' })
  payload?: Record<string, unknown> | null;

  @Column('timestamptz', { default: () => 'now()' })
  @ApiProperty({ description: 'Thời điểm hành động' })
  at: Date;
}
