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

  @ApiPropertyOptional({ description: 'Link xem ảnh thẻ hiện tại, ngắn hạn' })
  @Expose()
  currentCardViewUrl?: string;

  @ApiPropertyOptional()
  @Expose()
  currentCardViewUrlExpiresAt?: string;

  @ApiProperty({ description: 'Có ít nhất một phiên bản CARD_AI chưa bị hủy hay không' })
  @Expose()
  hasAi: boolean;

  @ApiProperty({ description: 'Có ít nhất một phiên bản CARD_UPLOAD chưa bị hủy hay không' })
  @Expose()
  hasUpload: boolean;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}

/** `GET /v1/review/sets/:id` — the list row plus everything the detail page needs (plan §5.2). */
export class ReviewSetDetailDao extends ReviewSetListItemDao {
  @ApiProperty({ type: [ReviewOriginalPhotoDao] })
  @Expose()
  @Type(() => ReviewOriginalPhotoDao)
  originalPhotos: ReviewOriginalPhotoDao[];

  @ApiProperty({ type: [ReviewOriginalVideoDao] })
  @Expose()
  @Type(() => ReviewOriginalVideoDao)
  videos: ReviewOriginalVideoDao[];

  @ApiProperty({ type: [PhotoVariantDao], description: 'Phiên bản chưa bị hủy, mới nhất trước' })
  @Expose()
  @Type(() => PhotoVariantDao)
  variants: PhotoVariantDao[];

  @ApiProperty({ type: [ReviewEventDao], description: 'Nhật ký gần đây nhất (xem đầy đủ ở GET .../events)' })
  @Expose()
  @Type(() => ReviewEventDao)
  events: ReviewEventDao[];
}
