import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  MAX_BULK_ITEMS,
  PRINT_ITEM_STATUSES,
  type PrintItemStatus,
} from '../print.constants';

class BulkTemplateFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  faculty?: string;

  @ApiPropertyOptional({ enum: PRINT_ITEM_STATUSES })
  @IsOptional()
  @IsIn(PRINT_ITEM_STATUSES)
  status?: PrintItemStatus;
}

/**
 * `POST /v1/print/items/bulk-template {itemIds | filter, templateId}` —
 * plan §2.5's "thiết kế phôi cho 1 người rồi áp cho nhiều người". Does NOT
 * render on apply — it only sets `template_id` on each matched item (and
 * resets a RENDERED item back to PENDING, since its old render no longer
 * matches the new template); the operator still triggers the actual render
 * via `POST /v1/print/batches/:id/render` or per-item `render`, same
 * two-step "pick, then render" flow the single-item PATCH already has.
 */
export class BulkTemplatePrintItemsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @ApiPropertyOptional({ type: BulkTemplateFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkTemplateFilterDto)
  filter?: BulkTemplateFilterDto;

  @ApiProperty({ description: 'Phôi in áp dụng' })
  @IsUUID()
  templateId: string;
}
