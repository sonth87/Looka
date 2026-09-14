import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { PRINT_ITEM_STATUSES, type PrintItemStatus } from '../print.constants';
import type { PrintItemExtra } from '../entities/print-item.entity';

/**
 * `PATCH /v1/print/items/:id {templateId?, extra?, status?}` — plan §2.5.
 * `status` here is deliberately narrow: `PrintItemService.patch` only lets
 * this move an item to `CANCELLED` (an operator pulling a bad row out of a
 * batch) — every other transition goes through a dedicated action
 * (`render`, `reprint`, the agent's own status callback, or the manual
 * "đã in" action) so each one gets its own validation/side-effects
 * (stats, stock, events) instead of being reachable two different ways.
 */
export class UpdatePrintItemDto {
  @ApiPropertyOptional({ description: 'Đổi phôi in riêng cho item này' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Sửa dữ liệu bổ sung (dob, cardValidUntil, barcode…)',
  })
  @IsOptional()
  @IsObject()
  extra?: PrintItemExtra;

  @ApiPropertyOptional({
    enum: PRINT_ITEM_STATUSES,
    description:
      'Chỉ chấp nhận CANCELLED qua route này — các chuyển trạng thái khác có action riêng',
  })
  @IsOptional()
  @IsIn(PRINT_ITEM_STATUSES)
  status?: PrintItemStatus;
}
