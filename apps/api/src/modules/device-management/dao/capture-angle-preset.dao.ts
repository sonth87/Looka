import { ApiProperty } from '@nestjs/swagger';
import type { CameraRole, PoseTarget } from '@face/core';
import { Expose } from 'class-transformer';

export class CaptureAnglePresetDao {
  @ApiProperty({ description: 'Preset id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  code: string;

  @ApiProperty()
  @Expose()
  labelVi: string;

  @ApiProperty()
  @Expose()
  instructionVi: string;

  @ApiProperty()
  @Expose()
  poseDefault: PoseTarget;

  @ApiProperty({ enum: ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] })
  @Expose()
  preferredCameraRole: CameraRole;

  @ApiProperty()
  @Expose()
  isSystem: boolean;

  @ApiProperty()
  @Expose()
  active: boolean;

  @ApiProperty()
  @Expose()
  sortOrder: number;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
