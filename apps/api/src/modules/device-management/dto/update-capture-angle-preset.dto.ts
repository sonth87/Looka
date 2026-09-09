import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CameraRole, PoseTarget } from '@face/core';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const CAMERA_ROLES = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] as const;

/**
 * `code` and `isSystem` are both deliberately absent from this DTO —
 * `code` is immutable after creation (task brief: "refuse to change code
 * after creation"; the simplest way to refuse is to never accept it here),
 * and `isSystem` is only ever set once, by `CaptureAnglePresetService` on
 * create. A system preset's label/instruction/pose ARE editable through
 * this DTO like any other row (task brief: "allow editing is_system rows'
 * label/instruction/pose but not deleting them") — only `active: false` is
 * how any preset, system or not, is "removed".
 */
export class UpdateCaptureAnglePresetDto {
  @ApiPropertyOptional({ description: 'Tên hiển thị (tiếng Việt)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  labelVi?: string;

  @ApiPropertyOptional({ description: 'Hướng dẫn hiện cho SV (tiếng Việt)' })
  @IsOptional()
  @IsString()
  instructionVi?: string;

  @ApiPropertyOptional({
    description: 'Góc độ mặc định (yaw/pitch/roll target+tolerance)',
  })
  @IsOptional()
  @IsObject()
  poseDefault?: PoseTarget;

  @ApiPropertyOptional({ enum: CAMERA_ROLES })
  @IsOptional()
  @IsIn(CAMERA_ROLES)
  preferredCameraRole?: CameraRole;

  @ApiPropertyOptional({
    description: '"Xóa" là đặt false, không có endpoint xóa thật',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
