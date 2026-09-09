import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CameraRole, PoseTarget } from '@face/core';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const CAMERA_ROLES = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] as const;

/** `isSystem` is never accepted here — every API-created preset is `isSystem: false`, set by the service, never the caller. */
export class CreateCaptureAnglePresetDto {
  @ApiProperty({ description: 'Mã góc chụp, ví dụ LEFT_45', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code chỉ chứa chữ, số, gạch dưới, gạch ngang',
  })
  code: string;

  @ApiProperty({ description: 'Tên hiển thị (tiếng Việt)' })
  @IsString()
  @MaxLength(255)
  labelVi: string;

  @ApiProperty({ description: 'Hướng dẫn hiện cho SV (tiếng Việt)' })
  @IsString()
  instructionVi: string;

  /** Deep shape (`yaw`/`pitch`/`roll` target+tolerance) validated at runtime by the capture pipeline, same lightweight `@IsObject()` treatment `Campaign.captureAngles` gets. */
  @ApiProperty({
    description: 'Góc độ mặc định (yaw/pitch/roll target+tolerance)',
  })
  @IsObject()
  poseDefault: PoseTarget;

  @ApiProperty({ enum: CAMERA_ROLES })
  @IsIn(CAMERA_ROLES)
  preferredCameraRole: CameraRole;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
