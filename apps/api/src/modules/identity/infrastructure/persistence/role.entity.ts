import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';

@Entity('roles')
export class RoleEntity extends BaseEntity {
  @Column('varchar', { length: 50, unique: true })
  @ApiProperty({ description: 'Mã vai trò, không đổi được' })
  code: string;

  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên vai trò' })
  name: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả' })
  description: string | null;

  @Column('boolean', { name: 'is_system', default: false })
  @ApiProperty({
    description: 'Vai trò hệ thống (ADMIN/REVIEWER) — không xóa được',
  })
  isSystem: boolean;
}
