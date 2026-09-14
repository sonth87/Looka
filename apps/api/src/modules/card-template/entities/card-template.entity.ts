import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import type { CardTemplateStatus } from '../card-template.constants';
import {
  DEFAULT_CARD_TEMPLATE_SIDE,
  type CardTemplateSide,
} from '../schema/card-template-layout.schema';

/**
 * One card template — cms-8-screens-api-plan.md §2.6/P5. Single mutable
 * row, NOT a separate versions table (see the migration's own doc
 * comment) — `version` is a plain counter `CardTemplateService.patch()`
 * bumps once the template is `ACTIVE` and already used by a print job.
 */
@Entity('card_templates')
export class CardTemplate extends BaseEntity {
  @Column('varchar', { length: 50, unique: true })
  @ApiProperty({ description: 'Mã phôi (duy nhất)' })
  code: string;

  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên phôi' })
  name: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả' })
  description?: string | null;

  @Column('varchar', { length: 10, default: 'DRAFT' })
  @Index()
  @ApiProperty({ description: 'DRAFT | ACTIVE | ARCHIVED' })
  status: CardTemplateStatus;

  @Column('int', { default: 1 })
  @ApiProperty({ description: 'Số lần sửa kể từ khi publish' })
  version: number;

  @Column('real', { name: 'card_width_mm', default: 85.6 })
  @ApiProperty({ description: 'Chiều rộng thẻ (mm), mặc định CR80' })
  cardWidthMm: number;

  @Column('real', { name: 'card_height_mm', default: 54 })
  @ApiProperty({ description: 'Chiều cao thẻ (mm), mặc định CR80' })
  cardHeightMm: number;

  @Column('int', { default: 300 })
  @ApiProperty({ description: 'DPI xuất PNG: 300 hoặc 600' })
  dpi: number;

  @Column('jsonb', { default: DEFAULT_CARD_TEMPLATE_SIDE })
  @ApiProperty({ description: 'Bố cục mặt trước' })
  front: CardTemplateSide;

  @Column('jsonb', { default: DEFAULT_CARD_TEMPLATE_SIDE })
  @ApiProperty({ description: 'Bố cục mặt sau' })
  back: CardTemplateSide;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  @ApiPropertyOptional({ description: 'Người tạo' })
  createdByUserId?: string | null;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  @ApiPropertyOptional({ description: 'Thời điểm publish gần nhất' })
  publishedAt?: Date | null;

  @Column('timestamptz', { name: 'archived_at', nullable: true })
  @ApiPropertyOptional({ description: 'Thời điểm lưu trữ' })
  archivedAt?: Date | null;
}
