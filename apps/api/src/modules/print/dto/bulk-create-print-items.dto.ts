import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MAX_BULK_ITEMS } from '../print.constants';

class BulkCreateFilterDto {
  @ApiPropertyOptional({
    description: 'Campaign cần tạo item — bắt buộc nếu dùng filter',
  })
  @IsUUID()
  campaignId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  faculty?: string;
}

/**
 * `POST /v1/print/items/bulk {setIds | filter}` — plan §2.5. Exactly one of
 * `setIds` (explicit picks) or `filter` (every APPROVED set in a campaign,
 * optionally narrowed by class/khoa — the "chọn cả lớp" case) must be given;
 * checked in `PrintItemService.bulkCreate`, not here, since it is a
 * cross-field rule `class-validator`'s per-property decorators don't express
 * cleanly.
 */
export class BulkCreatePrintItemsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('4', { each: true })
  setIds?: string[];

  @ApiPropertyOptional({ type: BulkCreateFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkCreateFilterDto)
  filter?: BulkCreateFilterDto;
}
