import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Body for `POST /v1/devices/videos` (2026-09-09, "route kiosk VIDEO uploads
 * through apps/api the same way kiosk PHOTO uploads already work" — mirrors
 * `AddDevicePhotoDto`'s base64-data-URL shape, guarded by the same
 * `DeviceCredentialsGuard`).
 *
 * No `stepId`/`attempt`/`triggerSource`/`captureMode` the way
 * `AddDevicePhotoDto` has: a video is never retaken at the same id (a redo
 * replaces the whole recording under a fresh id instead — see
 * `ATTEMPT_SUPERSEDED`), and has no per-shutter trigger to report. `videoId`
 * is the caller's id — the kiosk's own local outbox job id, the same
 * `deterministicUuid` derived from `<sessionId>:<streamId>:1:video` that
 * `enqueueSessionVideos()` (apps/desktop/src/main/uploads.ts) already
 * computes — so the row this creates lines up with whatever this same video
 * is later referenced by (an `ATTEMPT_SUPERSEDED` event, a future
 * VIDEO_STATUS resend from an older kiosk build, etc).
 */
export class AddDeviceVideoDto {
  @ApiProperty({
    description:
      "Kiosk-generated video id — apps/desktop's local outbox job id for this recording (deterministicUuid of `<sessionId>:<streamId>:1:video`)",
  })
  @IsUUID()
  videoId: string;

  @ApiProperty({ description: 'Phiên chụp chứa video này' })
  @IsUUID()
  sessionId: string;

  @ApiPropertyOptional({
    description:
      'Số CCCD của sinh viên, nếu có (dùng để đặt video vào cùng thư mục với ảnh của sinh viên đó trên file-service)',
  })
  @IsOptional()
  @IsString()
  identityNumber?: string;

  @ApiPropertyOptional({
    description: 'Camera đã quay video này (vai trò camera, hoặc id thiết bị vật lý nếu không có ánh xạ vai trò)',
  })
  @IsOptional()
  @IsString()
  cameraRole?: string;

  @ApiPropertyOptional({ description: 'Thời lượng video, tính bằng mili giây' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @ApiProperty({
    description: 'Video dạng data URL base64, ví dụ "data:video/webm;base64,..."',
  })
  @IsString()
  dataUrl: string;
}
