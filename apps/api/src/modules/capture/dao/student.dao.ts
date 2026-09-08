import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { SessionSource, SessionStatus } from '../capture.constants';

/**
 * One row of `GET /v1/students` — one per distinct `subject_code`, not one
 * per session (a student may have several, across campaigns/days) — see
 * `StudentService.listStudents()` for the grouping query.
 */
export class StudentListItemDao {
  @ApiProperty({ description: 'Mã sinh viên' })
  @Expose()
  subjectCode: string;

  @ApiPropertyOptional({ description: 'Tên sinh viên gần nhất được ghi nhận' })
  @Expose()
  subjectName?: string;

  @ApiProperty({ description: 'Số phiên chụp của sinh viên này' })
  @Expose()
  sessionCount: number;

  @ApiProperty({ description: 'Tổng số ảnh trên mọi phiên' })
  @Expose()
  totalPhotos: number;

  @ApiPropertyOptional()
  @Expose()
  lastCapturedAt?: Date;

  @ApiProperty({ type: [String], description: 'Các campaign sinh viên này đã xuất hiện' })
  @Expose()
  campaignIds: string[];
}

/**
 * One photo inside a student's session summary — a trimmed `SessionPhotoDao`
 * plus a pre-resolved `viewUrl` (see `StudentService.getStudentDetail()`'s
 * own doc comment for why the resolving happens here, at the service layer,
 * instead of the caller making a second call to `POST /v1/photos/:id/view-link`).
 */
export class StudentSessionPhotoDao {
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
  fsStatus?: string;

  @ApiPropertyOptional({ description: 'Link xem trực tiếp, có sẵn khi ảnh đã READY trên file-service' })
  @Expose()
  viewUrl?: string;

  @ApiPropertyOptional()
  @Expose()
  viewUrlExpiresAt?: string;
}

/** Video counterpart of `StudentSessionPhotoDao` — see that class's own doc comment. */
export class StudentSessionVideoDao {
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
  fsStatus?: string;

  @ApiPropertyOptional({ description: 'Link xem trực tiếp, có sẵn khi video đã READY trên file-service' })
  @Expose()
  viewUrl?: string;

  @ApiPropertyOptional()
  @Expose()
  viewUrlExpiresAt?: string;
}

/**
 * One of a student's sessions, inside `GET /v1/students/:code` — a summary
 * (not the full `SessionDetailDao`), with photos/videos embedded and
 * view-links already resolved, since apps/web has no other authorized path
 * to reach them (see `StudentController`'s own doc comment on the auth
 * design this shape exists to support).
 */
export class StudentSessionSummaryDao {
  @ApiProperty({ description: 'Session id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty({ enum: SessionSource })
  @Expose()
  source: SessionSource;

  @ApiPropertyOptional()
  @Expose()
  deviceId?: string;

  @ApiPropertyOptional()
  @Expose()
  deviceName?: string;

  @ApiPropertyOptional()
  @Expose()
  campaignId?: string;

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

  @ApiProperty({ type: [StudentSessionPhotoDao] })
  @Expose()
  @Type(() => StudentSessionPhotoDao)
  photos: StudentSessionPhotoDao[];

  @ApiProperty({ type: [StudentSessionVideoDao] })
  @Expose()
  @Type(() => StudentSessionVideoDao)
  videos: StudentSessionVideoDao[];
}

/** `GET /v1/students/:code` — always every session the student has, across every campaign; see `StudentService.getStudentDetail()`'s own doc comment for why the campaign filter used to reach the list is not applied here. */
export class StudentDetailDao {
  @ApiProperty({ description: 'Mã sinh viên' })
  @Expose()
  subjectCode: string;

  @ApiPropertyOptional()
  @Expose()
  subjectName?: string;

  @ApiProperty({ type: [StudentSessionSummaryDao] })
  @Expose()
  @Type(() => StudentSessionSummaryDao)
  sessions: StudentSessionSummaryDao[];
}
