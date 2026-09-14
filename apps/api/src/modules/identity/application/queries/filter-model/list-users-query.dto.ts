import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListUsersQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({
    description: 'Tìm theo email, tên, mã, hoặc số điện thoại',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Lọc theo mã vai trò' })
  @IsOptional()
  @IsString()
  roleCode?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @ApiPropertyOptional({ enum: ['SSO', 'MANUAL', 'SYNC'] })
  @IsOptional()
  @IsIn(['SSO', 'MANUAL', 'SYNC'])
  source?: 'SSO' | 'MANUAL' | 'SYNC';
}
