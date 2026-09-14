import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { MAX_BULK_ITEMS } from '../print.constants';

/** `POST /v1/print/batches/:id/items {itemIds}` — plan §2.5. */
export class BatchItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('4', { each: true })
  itemIds: string[];
}
