import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { MAX_BULK_ITEMS } from '../print.constants';

/**
 * `POST /v1/print/batches/:id/package {itemIds?}` (Giai đoạn 4, plan §4.0
 * Bẫy 6 + §4.2) — "xuất gói": builds the same zip `GET .../package`
 * returns, but additionally stamps `exportedAt` on every item that ends
 * up in it and moves each currently-`RENDERED` one to `EXPORTED`. Body,
 * not query — this is a state-changing POST, unlike the read-only GET
 * twin (`PrintPackageQueryDto`) it mirrors. Same "omitted = whole batch"
 * default as `SendPrintBatchDto`.
 */
export class ExportPrintBatchDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Chỉ xuất các item này (bỏ trống = cả đợt)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('4', { each: true })
  itemIds?: string[];
}
