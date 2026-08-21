import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, OneToMany } from 'typeorm';
import { SessionStatus } from '../capture.constants';
import { Photo } from './photo.entity';

@Entity('sessions')
export class Session extends BaseEntity {
  @Column('varchar', { length: 100, nullable: true, name: 'subject_code' })
  @ApiPropertyOptional({ description: 'Mã định danh người được chụp, nếu có' })
  subjectCode?: string;

  @Column('varchar', { length: 255, nullable: true, name: 'subject_name' })
  @ApiPropertyOptional({ description: 'Tên người được chụp, nếu có' })
  subjectName?: string;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.IN_PROGRESS,
  })
  @ApiProperty({ description: 'Trạng thái phiên chụp', enum: SessionStatus })
  status: SessionStatus;

  @Column('timestamptz', { nullable: true, name: 'completed_at' })
  @ApiPropertyOptional({ description: 'Thời điểm phiên hoàn tất' })
  completedAt?: Date;

  // jsonb rather than dedicated columns: whatever the capturing client wants
  // to remember about the run, without a migration for every new field.
  @Column('jsonb', { default: {} })
  @ApiProperty({ description: 'Dữ liệu bổ sung do client gửi kèm' })
  metadata: Record<string, unknown>;

  @OneToMany(() => Photo, (photo) => photo.session)
  photos?: Photo[];
}
