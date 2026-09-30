import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { MAX_REVIEW_BULK_SETS } from '../photo-review.constants';
import { ApproveRejectDto } from './approve-reject.dto';

/**
 * Body of `POST /v1/review/sets/approve` and `/reject` — the 1-n form of the
 * single `sets/:id/approve|reject` routes: one id or many, one request. The
 * same `note` (inherited from `ApproveRejectDto`, so its limits can never
 * drift from the single routes') applies to every named set.
 */
export class BulkApproveRejectDto extends ApproveRejectDto {
  @ApiProperty({
    type: [String],
    description: `Danh sách id bộ ảnh cần duyệt/từ chối (1-${MAX_REVIEW_BULK_SETS}); id trùng được gộp`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REVIEW_BULK_SETS)
  @IsUUID('4', { each: true })
  setIds: string[];
}
