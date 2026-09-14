import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';

@Entity('workflows')
export class WorkflowEntity extends BaseEntity {
  @Column('varchar', { length: 50, unique: true })
  @ApiProperty({ description: 'Mã nghiệp vụ, không đổi được' })
  code: string;

  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên nghiệp vụ' })
  name: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả' })
  description: string | null;

  @Column('varchar', { length: 10, default: 'DRAFT' })
  @ApiProperty({
    description: 'DRAFT | ACTIVE | ARCHIVED',
    enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
  })
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @Column('uuid', { name: 'current_version_id', nullable: true })
  @ApiPropertyOptional({ description: 'Id version đang publish' })
  currentVersionId: string | null;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  @ApiPropertyOptional()
  createdByUserId: string | null;
}
