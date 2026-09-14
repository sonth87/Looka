import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { CardTemplateAssetKind } from '../card-template.constants';
import { CardTemplate } from './card-template.entity';

/** A logo/background/font file attached to a template (§2.6) — bytes live on the file-service, this row is just the pointer + metadata. */
@Entity('card_template_assets')
export class CardTemplateAsset extends BaseEntity {
  @Column('uuid', { name: 'template_id' })
  @Index()
  @ApiProperty({ description: 'Phôi sở hữu asset này' })
  templateId: string;

  @ManyToOne(() => CardTemplate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template?: CardTemplate;

  @Column('varchar', { length: 20 })
  @ApiProperty({ description: 'LOGO | BACKGROUND | FONT' })
  kind: CardTemplateAssetKind;

  @Column('varchar', { length: 255, name: 'fs_file_id' })
  @ApiProperty({ description: 'file_id trên file-service' })
  fsFileId: string;

  @Column('varchar', { length: 255, name: 'file_name' })
  @ApiProperty({ description: 'Tên file gốc' })
  fileName: string;

  @Column('varchar', { length: 100, name: 'mime_type' })
  @ApiProperty({ description: 'MIME type' })
  mimeType: string;

  @Column('int', { nullable: true })
  @ApiPropertyOptional({ description: 'Chiều rộng (px), nếu là ảnh' })
  width?: number | null;

  @Column('int', { nullable: true })
  @ApiPropertyOptional({ description: 'Chiều cao (px), nếu là ảnh' })
  height?: number | null;
}
