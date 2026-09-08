import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { SessionSource, SessionStatus } from '../capture.constants';

/**
 * One photo inside `GET /v1/sessions/:id`. Bytes never leave Postgres here -
 * only the file-service pointers and lifecycle status; the actual image is
 * fetched through `POST /v1/photos/:id/view-link` (decision 2/3).
 */
export class SessionPhotoDao {
  @ApiProperty({ description: 'Photo id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  stepId: string;

  @ApiPropertyOptional({ description: 'Loại bước chụp (kiosk), vd FRONT' })
  @Expose()
  stepType?: string;

  @ApiPropertyOptional({ description: 'Camera vật lý đã chụp (kiosk)' })
  @Expose()
  cameraRole?: string;

  @ApiProperty()
  @Expose()
  attempt: number;

  @ApiProperty()
  @Expose()
  mimeType: string;

  @ApiProperty()
  @Expose()
  bytes: number;

  @ApiPropertyOptional({ description: 'file_id trên file-service' })
  @Expose()
  fsFileId?: string;

  @ApiPropertyOptional({ description: 'Trạng thái file trên file-service' })
  @Expose()
  fsStatus?: string;

  @ApiPropertyOptional({ description: 'Trạng thái hàng đợi cục bộ trên kiosk' })
  @Expose()
  localStatus?: string;

  @ApiPropertyOptional({ description: 'Đường dẫn ảo trên file-service' })
  @Expose()
  virtualPath?: string;

  @ApiPropertyOptional()
  @Expose()
  capturedAt?: Date;

  @ApiPropertyOptional()
  @Expose()
  uploadedAt?: Date;

  @ApiPropertyOptional()
  @Expose()
  readyAt?: Date;

  @ApiPropertyOptional({ description: 'Lỗi upload gần nhất, nếu có' })
  @Expose()
  uploadError?: string;
}

/**
 * One row of `GET /v1/sessions`. Photo counts are derived from `photos` at
 * query time (see `SessionService`'s list query) rather than stored, so they
 * are always current - "ready" = fs_status = READY, "failed" = local_status
 * = FAILED_PERMANENT or fs_status in (QUARANTINED, FAILED), "pending" =
 * everything else (A.5).
 */
export class SessionListItemDao {
  @ApiProperty({ description: 'Session id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty({ enum: SessionSource })
  @Expose()
  source: SessionSource;

  @ApiPropertyOptional()
  @Expose()
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Tên thiết bị, nếu source = KIOSK' })
  @Expose()
  deviceName?: string;

  @ApiPropertyOptional()
  @Expose()
  campaignId?: string;

  @ApiPropertyOptional()
  @Expose()
  subjectCode?: string;

  @ApiPropertyOptional()
  @Expose()
  subjectName?: string;

  @ApiProperty({ enum: SessionStatus })
  @Expose()
  status: SessionStatus;

  @ApiPropertyOptional()
  @Expose()
  capturedAt?: Date;

  @ApiPropertyOptional()
  @Expose()
  completedAt?: Date;

  @ApiPropertyOptional()
  @Expose()
  approvedAt?: Date;

  @ApiProperty()
  @Expose()
  photoCount: number;

  @ApiProperty()
  @Expose()
  photosReady: number;

  @ApiProperty()
  @Expose()
  photosPending: number;

  @ApiProperty()
  @Expose()
  photosFailed: number;
}

/**
 * One video inside `GET /v1/sessions/:id` — mirrors `SessionPhotoDao`. No
 * `stepId`/`attempt`: a video is never retaken, so `cameraRole` alone
 * distinguishes one from another within a session.
 */
export class SessionVideoDao {
  @ApiProperty({ description: 'Video id (uuid)' })
  @Expose()
  id: string;

  @ApiPropertyOptional({ description: 'Camera đã quay video này' })
  @Expose()
  cameraRole?: string;

  @ApiProperty()
  @Expose()
  mimeType: string;

  @ApiProperty()
  @Expose()
  bytes: number;

  @ApiPropertyOptional({ description: 'Thời lượng video, tính bằng mili giây' })
  @Expose()
  durationMs?: number;

  @ApiPropertyOptional({ description: 'file_id trên file-service' })
  @Expose()
  fsFileId?: string;

  @ApiPropertyOptional({ description: 'Trạng thái file trên file-service' })
  @Expose()
  fsStatus?: string;

  @ApiPropertyOptional({ description: 'Trạng thái hàng đợi cục bộ trên kiosk' })
  @Expose()
  localStatus?: string;

  @ApiPropertyOptional({ description: 'Đường dẫn ảo trên file-service' })
  @Expose()
  virtualPath?: string;

  @ApiPropertyOptional()
  @Expose()
  capturedAt?: Date;

  @ApiPropertyOptional()
  @Expose()
  uploadedAt?: Date;

  @ApiPropertyOptional()
  @Expose()
  readyAt?: Date;

  @ApiPropertyOptional({ description: 'Lỗi upload gần nhất, nếu có' })
  @Expose()
  uploadError?: string;
}

export class SessionDetailDao extends SessionListItemDao {
  @ApiProperty({ type: [SessionPhotoDao] })
  @Expose()
  @Type(() => SessionPhotoDao)
  photos: SessionPhotoDao[];

  @ApiProperty({ type: [SessionVideoDao] })
  @Expose()
  @Type(() => SessionVideoDao)
  videos: SessionVideoDao[];
}
