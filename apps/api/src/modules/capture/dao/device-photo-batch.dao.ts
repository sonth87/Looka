import {
  BulkItemResultDao,
  BulkResultCountsDao,
} from '@app/shared/http/bulk-result.dao';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

/** Outcome for ONE photo of a `POST /v1/devices/photos` batch. */
export class DevicePhotoBatchItemDao extends BulkItemResultDao {
  @ApiProperty() @Expose() photoId: string;
}

/**
 * Response of the batch form of `POST /v1/devices/photos`. Partial success
 * is the contract — the request is 201 whenever the BODY was valid, and each
 * photo's own outcome (a bad data URL, a session owned by another device,
 * ...) is in `results`, keyed by `photoId`.
 */
export class DevicePhotoBatchResultDao extends BulkResultCountsDao {
  @ApiProperty({ type: [DevicePhotoBatchItemDao] })
  @Expose()
  @Type(() => DevicePhotoBatchItemDao)
  results: DevicePhotoBatchItemDao[];
}
