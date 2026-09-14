import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { CreatePrinterDto } from './create-printer.dto';

/** `PATCH /v1/printers/:id` — everything `CreatePrinterDto` has except `blankStock` (stock only ever moves through `POST /v1/printers/:id/stock`, so its own audit trail in `printer_stock_events` can never be bypassed by a silent PATCH). */
export class UpdatePrinterDto extends PartialType(
  OmitType(CreatePrinterDto, ['blankStock'] as const),
) {
  @ApiPropertyOptional()
  declare model?: string;
}
