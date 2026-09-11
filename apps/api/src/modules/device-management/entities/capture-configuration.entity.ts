import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CaptureStep } from '@face/core';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import type { CardSpec } from './campaign.entity';

/**
 * A reusable capture template (item 10, 2026-09-09 task brief) —
 * "Configuration 1: 3 cameras, mapped to trái/phải/chính giữa, captures at
 * 4x6 ratio, plus other params". Deliberately a **preset**, not a live
 * foreign-key relationship: a campaign that picks one of these at creation
 * time (`CampaignForm.tsx`'s "Chọn từ cấu hình có sẵn") gets its
 * `captureAngles`/`cardSpec` **pre-filled** with a one-time copy of this
 * row's values, which the operator can still edit before saving — nothing
 * about how a campaign actually runs capture ever reads from this table at
 * runtime. This keeps every existing capture code path (round planning,
 * `resolveActiveWorkflow`, `GET /v1/campaigns/:id/config`, …) completely
 * unaffected by this table's existence: a campaign's own `capture_angles`/
 * `card_spec` columns (`Campaign` entity) are still the only things any
 * kiosk ever reads, exactly as before this feature.
 *
 * Modelled on `CaptureAnglePreset` (§3.1.6) for consistency, but a real,
 * hard-deletable CRUD resource rather than an `active`-flag "soft delete"
 * catalog — a capture configuration is a convenience template an admin
 * creates/edits/deletes freely, not a system-seeded angle catalog other
 * data links back to by code.
 */
@Entity('capture_configurations')
export class CaptureConfiguration extends BaseEntity {
  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên cấu hình, ví dụ "3 camera - Thẻ SV 4x6"' })
  name: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả cấu hình' })
  description?: string | null;

  /**
   * Same shape/validation as `Campaign.captureAngles` (`CaptureStep[]`,
   * `capture-angles.validator.ts`'s `validateCaptureAngles`) — this is what
   * gets copied verbatim into a campaign's own `captureAngles` when the
   * operator picks this configuration in `CampaignForm.tsx`. Never null
   * here (unlike the campaign column): a configuration with nothing to
   * offer wouldn't be worth saving as a template.
   */
  @Column('jsonb', { name: 'capture_angles' })
  @ApiProperty({ description: 'Danh sách bước chụp (mẫu)' })
  captureAngles: CaptureStep[];

  /** Same shape as `Campaign.cardSpec` — see that field's own doc comment. NULL = this template has no card-photo spec opinion. */
  @Column('jsonb', { nullable: true, name: 'card_spec' })
  @ApiPropertyOptional({ description: 'Chuẩn ảnh thẻ (mẫu)' })
  cardSpec?: CardSpec | null;
}
