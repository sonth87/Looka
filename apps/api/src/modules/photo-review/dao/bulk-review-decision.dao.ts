import {
  BulkItemResultDao,
  BulkResultCountsDao,
} from '@app/shared/http/bulk-result.dao';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

/** Outcome for ONE set of a `POST /v1/review/sets/approve|reject` call. */
export class BulkReviewDecisionItemDao extends BulkItemResultDao {
  @ApiProperty() @Expose() setId: string;

  @ApiPropertyOptional({
    description: 'Trạng thái bộ ảnh sau khi xử lý (chỉ khi ok=true)',
  })
  @Expose()
  status?: string;

  @ApiPropertyOptional({
    description:
      'false nếu bộ ảnh đã ở đúng trạng thái đó từ trước (không ghi gì thêm)',
  })
  @Expose()
  changed?: boolean;
}

/**
 * Response of `POST /v1/review/sets/approve|reject`. Partial success is the
 * contract: one failing set never fails the others, so the HTTP status is
 * 201 whenever the request itself was valid and the caller must read
 * `results` for per-set outcomes. `requested` counts distinct sets, after
 * duplicate ids are collapsed.
 */
export class BulkReviewDecisionResultDao extends BulkResultCountsDao {
  @ApiProperty({ type: [BulkReviewDecisionItemDao] })
  @Expose()
  @Type(() => BulkReviewDecisionItemDao)
  results: BulkReviewDecisionItemDao[];
}
