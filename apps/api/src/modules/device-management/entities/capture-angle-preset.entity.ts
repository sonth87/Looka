import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CameraRole, PoseTarget } from '@face/core';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../shared/common/base.entity';

/**
 * The dynamic capture-angle catalog — docs/plans/campaign-config-sso-card-photo-discussion.md
 * §3.1.6. Replaces the hardcoded 5-angle toggle
 * (`apps/cms/src/captureAngles.ts`'s `CAPTURE_STEP_DEFS`) with a
 * CMS-managed, system-wide table: campaign creation picks a preset, which
 * fills in `pose_default`/`preferred_camera_role`/`instruction_vi` as a
 * starting point that gets **snapshotted** onto the campaign's own
 * `capture_angles[]` row at save time (`CaptureStep.angleCode` links back
 * here for display only — a later edit to a preset never silently changes
 * an already-saved campaign's steps).
 *
 * Seeded with the 5 original hardcoded angles as `is_system = true` rows
 * (migration `CaptureAnglePresets1793001000000`) — editable (label/
 * instruction/pose) but never deletable; "delete" for any preset, system or
 * not, is `active = false` (`CaptureAnglePresetService.updatePreset`).
 */
@Entity('capture_angle_presets')
export class CaptureAnglePreset extends BaseEntity {
  /** Immutable after creation — enforced by `UpdateCaptureAnglePresetDto` simply not accepting this field, not a service-level check. */
  @Column('varchar', { length: 50, unique: true })
  @ApiProperty({ description: 'Mã góc chụp, ví dụ FRONT, LEFT_30' })
  code: string;

  @Column('varchar', { length: 255, name: 'label_vi' })
  @ApiProperty({ description: 'Tên hiển thị (tiếng Việt)' })
  labelVi: string;

  @Column('text', { name: 'instruction_vi' })
  @ApiProperty({ description: 'Hướng dẫn hiện cho SV (tiếng Việt)' })
  instructionVi: string;

  @Column('jsonb', { name: 'pose_default' })
  @ApiProperty({
    description: 'Góc độ mặc định (yaw/pitch/roll target+tolerance)',
  })
  poseDefault: PoseTarget;

  @Column('varchar', { length: 10, name: 'preferred_camera_role' })
  @ApiProperty({
    description: 'Camera ưu tiên cho góc này',
    enum: ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'],
  })
  preferredCameraRole: CameraRole;

  /** The 5 angles seeded from `CAPTURE_STEP_DEFS` — never deletable, but editable like any other row. */
  @Column('boolean', { default: false, name: 'is_system' })
  @ApiProperty({
    description: 'Góc gốc của hệ thống (5 góc mặc định) — không xóa được',
  })
  isSystem: boolean;

  /** "Xóa" for any preset (system or CMS-created) is setting this to false — see this entity's own doc comment. */
  @Column('boolean', { default: true })
  @ApiProperty({ description: 'Còn hiển thị trong danh mục hay không' })
  active: boolean;

  @Column('int', { default: 0, name: 'sort_order' })
  @ApiPropertyOptional({ description: 'Thứ tự hiển thị trong danh mục' })
  sortOrder: number;
}
