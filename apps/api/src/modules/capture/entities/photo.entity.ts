import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Session } from './session.entity';

@Entity('photos')
// A retake is a new attempt, never an overwrite of an earlier one - the
// earlier photo must survive until the operator has actually chosen between
// them. This is what makes that guarantee a database constraint rather than
// an application convention that a bug could quietly violate.
@Index('IDX_photos_session_step_attempt', ['sessionId', 'stepId', 'attempt'], {
  unique: true,
})
export class Photo extends BaseEntity {
  @Column('uuid', { name: 'session_id' })
  sessionId: string;

  @ManyToOne(() => Session, (session) => session.photos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session?: Session;

  @Column('varchar', { length: 50, name: 'step_id' })
  @ApiProperty({ description: 'Bước trong quy trình chụp, ví dụ FRONT/LEFT' })
  stepId: string;

  @Column('int', { default: 1 })
  @ApiProperty({
    description: 'Số lần thử của bước này (chụp lại = attempt mới)',
  })
  attempt: number;

  @Column('varchar', { length: 100, name: 'mime_type' })
  @ApiProperty({ description: 'Kiểu MIME của ảnh' })
  mimeType: string;

  @Column('int')
  @ApiProperty({ description: 'Kích thước ảnh, tính bằng byte' })
  bytes: number;

  @Column('varchar', { length: 64 })
  @ApiProperty({ description: 'SHA-256 của nội dung ảnh' })
  sha256: string;

  @Column('uuid', { nullable: true, name: 'fs_file_id' })
  @ApiPropertyOptional({
    description: 'file_id trên file-service, có sau khi upload xong',
  })
  fsFileId?: string;

  @Column('varchar', { length: 255, nullable: true, name: 'fs_etag' })
  @ApiPropertyOptional({ description: 'ETag hiện hành trên file-service' })
  fsEtag?: string;

  @Column('varchar', { length: 50, nullable: true, name: 'fs_status' })
  @ApiPropertyOptional({
    description: 'Trạng thái file trên file-service (SCANNING/READY/...)',
  })
  fsStatus?: string;

  @Column('text', { nullable: true, name: 'virtual_path' })
  @ApiPropertyOptional({ description: 'Đường dẫn ảo trên file-service' })
  virtualPath?: string;
}
