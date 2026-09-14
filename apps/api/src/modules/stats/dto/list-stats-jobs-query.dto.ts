import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';

/** `GET /v1/stats/jobs?kind&status&page&limit`. */
export class ListStatsJobsQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({
    enum: ['SNAPSHOT_REFRESH', 'DAILY_RECOMPUTE', 'REBUILD'],
  })
  @IsOptional()
  @IsIn(['SNAPSHOT_REFRESH', 'DAILY_RECOMPUTE', 'REBUILD'])
  kind?: 'SNAPSHOT_REFRESH' | 'DAILY_RECOMPUTE' | 'REBUILD';

  @ApiPropertyOptional({ enum: ['RUNNING', 'DONE', 'FAILED'] })
  @IsOptional()
  @IsIn(['RUNNING', 'DONE', 'FAILED'])
  status?: 'RUNNING' | 'DONE' | 'FAILED';
}
