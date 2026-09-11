import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';

/**
 * A configurable "type of photo" (plan §2, §5.6 / yêu cầu 7) — student card
 * is just the first row seeded by this module's migration, not a hardcoded
 * concept. `cardSpec`/`qualityProfile` feed the sidecar's `/card-photo`
 * pipeline (see `PhotoReviewSidecarService`); `promptHints` seed the AI-edit
 * modal's suggestion chips (§5.3).
 */
@Entity('photo_kinds')
export class PhotoKind extends BaseEntity {
  @Column('varchar', { length: 100, unique: true })
  @Index()
  @ApiProperty({ description: 'Mã loại ảnh, ví dụ STUDENT_CARD' })
  code: string;

  @Column('varchar', { length: 255, name: 'label_vi' })
  @ApiProperty({ description: 'Tên hiển thị tiếng Việt' })
  labelVi: string;

  /** Default card spec for this kind — size/dpi/background/head-eye ratio. See this module's seed migration for the STUDENT_CARD default. */
  @Column('jsonb', { name: 'card_spec' })
  @ApiProperty({ description: 'Chuẩn ảnh thẻ mặc định (cỡ, dpi, nền, tỉ lệ đầu/mắt)' })
  cardSpec: Record<string, unknown>;

  @Column('jsonb', { name: 'quality_profile', nullable: true })
  @ApiPropertyOptional({ description: 'Bộ kiểm tra chất lượng riêng cho loại ảnh này' })
  qualityProfile?: Record<string, unknown> | null;

  @Column('jsonb', { name: 'prompt_hints', default: () => "'[]'" })
  @ApiProperty({ description: 'Gợi ý prompt AI cho loại ảnh này', type: [String] })
  promptHints: string[];

  @Column('boolean', { default: true })
  @ApiProperty({ description: 'Loại ảnh còn dùng được hay đã ẩn' })
  active: boolean;
}
