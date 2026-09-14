import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { PRINT_ITEM_STATUSES, type PrintItemStatus } from '../print.constants';

/** `GET /v1/print/items?campaignId&batchId&status&className&faculty&q&page&limit` — plan §2.5. */
export class ListPrintItemsQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: PRINT_ITEM_STATUSES })
  @IsOptional()
  @IsIn(PRINT_ITEM_STATUSES)
  status?: PrintItemStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  faculty?: string;

  @ApiPropertyOptional({ description: 'Tìm theo mã SV hoặc họ tên' })
  @IsOptional()
  @IsString()
  q?: string;
}
