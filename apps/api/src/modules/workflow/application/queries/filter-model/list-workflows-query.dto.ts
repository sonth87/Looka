import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListWorkflowsQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED'])
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã' })
  @IsOptional()
  @IsString()
  q?: string;
}
