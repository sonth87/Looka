import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { PhotoReviewSetStatus } from '@app/modules/photo-review/photo-review.constants';

/**
 * `GET /v1/campaigns/:id/subjects/:subjectCode/photo-status` response
 * (2026-09-15) — the kiosk's pre-capture "đã có hồ sơ ảnh chưa?" check.
 * `exists: false` is the common case (a genuinely new student); every other
 * field is only present when `exists` is `true`.
 */
export class CampaignSubjectPhotoStatusDao {
  @ApiProperty({
    description: 'Sinh viên này đã có hồ sơ ảnh trong đợt chụp này chưa',
  })
  @Expose()
  exists: boolean;

  @ApiPropertyOptional({ enum: PhotoReviewSetStatus })
  @Expose()
  status?: PhotoReviewSetStatus;

  @ApiPropertyOptional({ description: 'Thời điểm hồ sơ này được tạo (lần chụp trước)' })
  @Expose()
  capturedAt?: Date;

  @ApiPropertyOptional({
    description: 'URL xem trước ảnh thẻ hiện tại — vắng mặt nếu chưa có ảnh nào được xử lý xong',
  })
  @Expose()
  viewUrl?: string;
}
