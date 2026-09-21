import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { PhotoReviewSetStatus } from '../photo-review.constants';
import { PhotoVariantDao } from './photo-variant.dao';
import { ReviewEventDao } from './review-event.dao';

/** One original capture — read-only mirror of a row from the `capture` module's `photos` table (plan §2 says: no new columns, no edits to that table). */
export class ReviewOriginalPhotoDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  stepId: string;

  @ApiPropertyOptional()
  @Expose()
  stepType?: string;

  @ApiPropertyOptional()
  @Expose()
  cameraRole?: string;

  @ApiProperty()
  @Expose()
  attempt: number;

  @ApiProperty()
  @Expose()
  mimeType: string;

  @ApiPropertyOptional()
  @Expose()
  fsFileId?: string;

  @ApiPropertyOptional()
  @Expose()
  fsStatus?: string;

  @ApiPropertyOptional()
  @Expose()
  capturedAt?: Date;
}

/** One session video — read-only mirror of a row from `capture`'s `session_videos` table (view-only, plan §5.2). */
export class ReviewOriginalVideoDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiPropertyOptional()
  @Expose()
  cameraRole?: string;

  @ApiProperty()
  @Expose()
  mimeType: string;

  @ApiPropertyOptional()
  @Expose()
  durationMs?: number;

  @ApiPropertyOptional()
  @Expose()
  fsFileId?: string;

  @ApiPropertyOptional()
  @Expose()
  fsStatus?: string;
}

/** One row of `GET /v1/review/sets`. */
export class ReviewSetListItemDao {
  @ApiProperty({ description: 'Set id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiPropertyOptional({ description: 'Tên campaign, nếu tra được' })
  @Expose()
  campaignName?: string;

  @ApiProperty()
  @Expose()
  subjectCode: string;

  @ApiPropertyOptional()
  @Expose()
  subjectName?: string | null;

  @ApiProperty()
  @Expose()
  kindId: string;

  @ApiPropertyOptional({ description: 'photo_kinds.code, nếu tra được' })
  @Expose()
  kindCode?: string;

  @ApiProperty()
  @Expose()
  sourceSessionId: string;

  @ApiProperty({ enum: PhotoReviewSetStatus })
  @Expose()
  status: PhotoReviewSetStatus;

  @ApiPropertyOptional()
  @Expose()
  currentCardVariantId?: string | null;

  @ApiPropertyOptional({
    description:
      'Lý do tạo ảnh 4x6 tự động thất bại — chỉ có giá trị khi status=AUTO_FAILED, lấy từ note của variant CARD_AUTO lỗi gần nhất',
  })
  @Expose()
  failReason?: string | null;

  @ApiPropertyOptional({ description: 'Link xem ảnh thẻ hiện tại, ngắn hạn' })
  @Expose()
  currentCardViewUrl?: string;

  @ApiPropertyOptional()
  @Expose()
  currentCardViewUrlExpiresAt?: string;

  @ApiProperty({
    description: 'Có ít nhất một phiên bản CARD_AI chưa bị hủy hay không',
  })
  @Expose()
  hasAi: boolean;

  @ApiProperty({
    description: 'Có ít nhất một phiên bản CARD_UPLOAD chưa bị hủy hay không',
  })
  @Expose()
  hasUpload: boolean;

  @ApiPropertyOptional({
    description: 'Lop, lay tu roster (campaign_subjects) neu co',
  })
  @Expose()
  className?: string;

  @ApiPropertyOptional({ description: 'Nganh, lay tu roster neu co' })
  @Expose()
  major?: string;

  @ApiPropertyOptional({ description: 'Khoa, lay tu roster neu co' })
  @Expose()
  faculty?: string;

  @ApiPropertyOptional({ description: 'So CCCD, lay tu roster neu co' })
  @Expose()
  citizenId?: string;

  @ApiPropertyOptional({
    description:
      'Nguoi chup (operator SSO), resolve tu sessions.operator_user_id -> users; undefined neu chua ro',
  })
  @Expose()
  operatorName?: string;

  @ApiPropertyOptional({
    description: 'Han xu ly - null neu campaign khong dat SLA (P4/D-Q6)',
  })
  @Expose()
  dueAt?: Date;

  @ApiProperty({
    description: 'true neu da qua dueAt va chua duoc duyet/tu choi',
  })
  @Expose()
  overdue: boolean;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}

/** `GET /v1/review/sets/:id` — the list row plus everything the detail page needs (plan §5.2). */
export class ReviewSetDetailDao extends ReviewSetListItemDao {
  @ApiPropertyOptional({
    description: 'Thời điểm chụp phiên gốc (sessions.created_at)',
  })
  @Expose()
  sourceCapturedAt?: Date;

  @ApiPropertyOptional({
    description: 'Tên thiết bị đã chụp phiên gốc, nếu tra được',
  })
  @Expose()
  sourceDeviceName?: string;

  @ApiProperty({ type: [ReviewOriginalPhotoDao] })
  @Expose()
  @Type(() => ReviewOriginalPhotoDao)
  originalPhotos: ReviewOriginalPhotoDao[];

  @ApiProperty({ type: [ReviewOriginalVideoDao] })
  @Expose()
  @Type(() => ReviewOriginalVideoDao)
  videos: ReviewOriginalVideoDao[];

  @ApiProperty({
    type: [PhotoVariantDao],
    description: 'Phiên bản chưa bị hủy, mới nhất trước',
  })
  @Expose()
  @Type(() => PhotoVariantDao)
  variants: PhotoVariantDao[];

  @ApiProperty({
    type: [ReviewEventDao],
    description: 'Nhật ký gần đây nhất (xem đầy đủ ở GET .../events)',
  })
  @Expose()
  @Type(() => ReviewEventDao)
  events: ReviewEventDao[];
}
