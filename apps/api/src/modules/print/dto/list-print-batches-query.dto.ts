import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import {
  PRINT_BATCH_STATUSES,
  type PrintBatchStatus,
} from '../print.constants';

export class ListPrintBatchesQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({ enum: PRINT_BATCH_STATUSES })
  @IsOptional()
  @IsIn(PRINT_BATCH_STATUSES)
  status?: PrintBatchStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
