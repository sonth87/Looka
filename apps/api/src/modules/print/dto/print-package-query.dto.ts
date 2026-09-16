import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { MAX_BULK_ITEMS } from '../print.constants';

/**
 * `GET /v1/print/batches/:id/package?itemIds=...&itemIds=...`. No existing
 * GET endpoint in this module (or `ListPrintItemsQueryDto`/sibling query
 * DTOs) takes an array query param to copy a convention from, so this
 * follows the plain Express/`qs` default: repeat the key once per id
 * (`?itemIds=a&itemIds=b`). `qs` already turns repeated keys into a
 * `string[]` on its own — the `@Transform` below only normalizes the
 * single-id case, where `qs` instead hands back a bare string.
 */
export class PrintPackageQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Chỉ đóng gói các item này (bỏ trống = cả đợt)',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('4', { each: true })
  itemIds?: string[];
}
