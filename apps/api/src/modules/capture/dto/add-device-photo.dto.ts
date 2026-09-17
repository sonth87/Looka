import type { CaptureTriggerMode, CaptureTriggerSource } from '@face/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/** `@face/core`'s `CaptureTriggerSource` — same list `AddPhotoDto` validates against. */
const TRIGGER_SOURCES: CaptureTriggerSource[] = [
  'AUTO',
  'GESTURE',
  'SHUTTER',
  'EXTERNAL',
];

/** `@face/core`'s `CaptureTriggerMode`. */
const CAPTURE_MODES: CaptureTriggerMode[] = ['AUTO', 'MANUAL', 'OFF'];

/**
 * Body for `POST /v1/devices/photos` (Part A of the "route kiosk photo
 * uploads through apps/api" work) — a kiosk pushing one captured photo's
 * actual bytes, guarded by `DeviceCredentialsGuard` the same way
 * `DeviceSelfController`'s other routes already are. Mirrors `AddPhotoDto`'s
 * base64-data-URL shape (both are decoded/validated by
 * `PhotoService.decodeDataUrl`) plus the per-photo identity/step fields
 * `SessionReportPhotoInput` already carries — see `PhotoService.addDevicePhoto`'s
 * own doc comment for why `photoId`/`sessionId` are supplied by the caller
 * rather than generated here.
 */
export class AddDevicePhotoDto {
  @ApiProperty({
    description:
      "Kiosk-generated photo id — the same id SESSION_REPORT/PHOTO_STATUS device events report this photo under (apps/desktop's local outbox job id)",
  })
  @IsUUID()
  photoId: string;

  @ApiProperty({ description: 'Phiên chụp chứa ảnh này' })
  @IsUUID()
  sessionId: string;

  @ApiPropertyOptional({
    description:
      'Số CCCD của sinh viên, nếu có (dùng để đặt tên thư mục ảnh trên file-service cho dễ truy xuất)',
  })
  @IsOptional()
  @IsString()
  identityNumber?: string;

  /**
   * The subject's `user_code` from the external roster (2026-09-16, backend-
   * owned embedding) — threaded through end-to-end from
   * `RunScopedCaptureSession`'s cached `StudentSubjectInfo.userCode` the same
   * way `identityNumber` above already is, so `PhotoService.addDevicePhoto`
   * can enqueue an `embedding_jobs` row without depending on this session's
   * `SESSION_REPORT` metadata having landed first (which may not have
   * happened yet at this point — see that method's own doc comment).
   */
  @ApiPropertyOptional({
    description:
      'user_code của sinh viên theo hồ sơ ngoài, nếu có (dùng để đăng ký embedding)',
  })
  @IsOptional()
  @IsString()
  userCode?: string;

  /**
   * Người vận hành (SSO) đang chụp phiên này, nếu có (2026-09-17, "theo dõi
   * ai chụp/ai upload") — threaded end-to-end from the kiosk's logged-in
   * operator the same way `identityNumber`/`userCode` above already are, so
   * `PhotoService.addDevicePhoto` can set `sessions.operator_user_id` at
   * capture time instead of only once a later SESSION_REPORT device-event
   * lands (see that method's own doc comment).
   */
  @ApiPropertyOptional({
    description: 'Người vận hành (SSO) đang chụp phiên này, nếu có',
  })
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;

  @ApiProperty({ description: 'Bước trong quy trình chụp, ví dụ FRONT/LEFT' })
  @IsString()
  @IsNotEmpty()
  stepId: string;

  @ApiPropertyOptional({ description: 'Loại bước (FRONT/LEFT/RIGHT…), nếu có' })
  @IsOptional()
  @IsString()
  stepType?: string;

  @ApiPropertyOptional({ description: 'Camera đã chụp ảnh này, nếu có' })
  @IsOptional()
  @IsString()
  cameraRole?: string;

  @ApiProperty({
    description: 'Số lần thử của bước này, bắt đầu từ 1',
    default: 1,
  })
  @IsInt()
  @Min(1)
  attempt: number;

  @ApiProperty({
    description: 'Ảnh dạng data URL base64, ví dụ "data:image/jpeg;base64,..."',
  })
  @IsString()
  @IsNotEmpty()
  dataUrl: string;

  @ApiPropertyOptional({
    description: 'Nguồn kích hoạt chụp, nếu có',
    enum: TRIGGER_SOURCES,
  })
  @IsOptional()
  @IsIn(TRIGGER_SOURCES)
  triggerSource?: CaptureTriggerSource;

  @ApiPropertyOptional({
    description: 'Chế độ chụp đang bật khi ảnh này được chụp, nếu có',
    enum: CAPTURE_MODES,
  })
  @IsOptional()
  @IsIn(CAPTURE_MODES)
  captureMode?: CaptureTriggerMode;
}
