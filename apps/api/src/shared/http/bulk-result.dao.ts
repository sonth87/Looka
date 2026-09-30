import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * The outcome fields every 1-n endpoint reports per item. A concrete DAO
 * extends this and adds only its own item key (`photoId`, `setId`, ...) and any
 * success-only fields. Pairs with `runBulk` in `bulk-item-error.ts`, which
 * produces rows of exactly this shape.
 */
export class BulkItemResultDao {
  @ApiProperty({ description: 'true nếu phần tử này đã được xử lý thành công' })
  @Expose()
  ok: boolean;

  @ApiPropertyOptional({
    description: 'HTTP status tương ứng (chỉ khi ok=false)',
  })
  @Expose()
  statusCode?: number;

  @ApiPropertyOptional({
    oneOf: [{ type: 'number' }, { type: 'string' }],
    description: 'Mã lỗi (chỉ khi ok=false)',
  })
  @Expose()
  errorCode?: number | string;

  @ApiPropertyOptional({ description: 'Thông điệp lỗi (chỉ khi ok=false)' })
  @Expose()
  message?: string;
}

/**
 * The count fields every 1-n endpoint's response starts with. A concrete DAO
 * extends this and adds its typed `results` array (its `@Type` can only name
 * the concrete item class).
 */
export class BulkResultCountsDao {
  @ApiProperty({
    description: 'Số phần tử được xử lý (sau khi bỏ id trùng, nếu có)',
  })
  @Expose()
  requested: number;

  @ApiProperty() @Expose() succeeded: number;
  @ApiProperty() @Expose() failed: number;
}
