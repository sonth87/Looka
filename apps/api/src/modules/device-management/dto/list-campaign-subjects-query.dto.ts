import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';

/** `GET /v1/campaigns/:id/subjects?status&q&page&limit` — cms-8-screens-api-plan.md §2.3/P3. */
export class ListCampaignSubjectsQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({ enum: ['VALID', 'ERROR', 'DUPLICATE'] })
  @IsOptional()
  @IsIn(['VALID', 'ERROR', 'DUPLICATE'])
  status?: 'VALID' | 'ERROR' | 'DUPLICATE';

  @ApiPropertyOptional({ description: 'Tìm theo mã SV hoặc họ tên' })
  @IsOptional()
  @IsString()
  q?: string;
}
