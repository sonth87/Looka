import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, NotEquals } from 'class-validator';

/**
 * `POST /v1/printers/:id/stock {delta, reason, note}` — plan §2.7's "cập
 * nhật phôi" manual action. `reason` excludes `PRINT` on purpose: that
 * reason is written automatically by `PrintItemService`'s own PRINTED
 * transition (see `PrinterService.applyStockDelta`'s doc comment) — letting
 * a human pick `PRINT` here would let the audit trail be forged.
 */
export class PrinterStockAdjustDto {
  @ApiProperty({ description: 'Số phôi thay đổi (+/-), khác 0' })
  @IsInt()
  @NotEquals(0)
  delta: number;

  @ApiProperty({ enum: ['REFILL', 'ADJUST', 'WASTE'] })
  @IsIn(['REFILL', 'ADJUST', 'WASTE'])
  reason: 'REFILL' | 'ADJUST' | 'WASTE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
