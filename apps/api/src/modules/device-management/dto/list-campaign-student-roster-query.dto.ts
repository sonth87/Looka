import { QueryPaginateDto } from '@app/common/dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** `GET /v1/campaigns/:id/roster` — paginated, optionally filtered by a free-text search over mã SV/tên/CCCD. */
export class ListCampaignStudentRosterQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({ description: 'Tìm theo mã SV, tên, hoặc số CCCD' })
  @IsOptional()
  @IsString()
  q?: string;
}
