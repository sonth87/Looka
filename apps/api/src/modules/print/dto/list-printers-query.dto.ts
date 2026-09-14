import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { PRINTER_STATUSES, type PrinterStatus } from '../print.constants';

/** `GET /v1/printers?status&campaignId&q&page` — plan §2.7. `campaignId` filters via `device_id → devices.campaign_id` (raw SQL, cross-module — see `PrinterService.list`), since `printers` itself has no campaign column. */
export class ListPrintersQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({ enum: PRINTER_STATUSES })
  @IsOptional()
  @IsIn(PRINTER_STATUSES)
  status?: PrinterStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên/model máy in' })
  @IsOptional()
  @IsString()
  q?: string;
}
