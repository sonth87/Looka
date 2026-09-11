import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CameraRole, CaptureStep, CaptureTriggerMode } from '@face/core';
import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Device } from './device.entity';

export enum CampaignPurpose {
  STUDENT_CARD = 'STUDENT_CARD',
  KYC_ENROLLMENT = 'KYC_ENROLLMENT',
}

/** Manual override of a campaign's derived status — see `computeEffectiveStatus` in `../utils/campaign-status.util.ts`. */
export type CampaignManualStatus = 'PAUSED' | 'CLOSED';

/**
 * Derived 4x6 ID card photo spec — docs/plans/campaign-config-sso-card-photo-discussion.md
 * §3.5/§3.1.1. `headHeightRatio`/`eyeLineRatio` are `[min, max]` fractions of
 * the final card image's height. Nothing here is enforced at the DB level —
 * the crop/retouch pipeline (not built in this pass) is the actual consumer.
 */
export interface CardSpec {
  size: '3x4' | '4x6';
  dpi: 300 | 600;
  backgroundColor: string;
  headHeightRatio: [number, number];
  eyeLineRatio: [number, number];
  retouch: { enabled: boolean };
}

/**
 * A named batch of kiosks sharing one expiry, one consent text, and one
 * capture configuration — see docs/plans/multi-camera-device-management-discussion.md
 * §3.2. Registering a device always happens under a campaign; the campaign
 * carries the settings that would otherwise have to be repeated per device.
 */
@Entity('campaigns')
export class Campaign extends BaseEntity {
  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên campaign' })
  name: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả campaign' })
  description?: string;

  @Column({
    type: 'enum',
    enum: CampaignPurpose,
    default: CampaignPurpose.STUDENT_CARD,
    name: 'purpose',
  })
  @ApiProperty({ description: 'Mục đích sử dụng ảnh', enum: CampaignPurpose })
  purpose: CampaignPurpose;

  /**
   * NULL = vĩnh viễn, không bao giờ hết hạn — không phải một giá trị đặc
   * biệt kiểu "9999-12-31". Áp dụng cho MỌI thiết bị đăng ký trong campaign
   * này (không phải cột trên bảng device) — mục 3.2.
   */
  @Column('timestamptz', { nullable: true, name: 'expires_at' })
  @ApiPropertyOptional({ description: 'Hạn dùng — để trống là vĩnh viễn' })
  expiresAt?: Date | null;

  /**
   * NULL cho tới khi admin cấu hình riêng — mục 2.4 nói rõ dùng 1 nội dung
   * mặc định chung chung khi campaign chưa cấu hình, không chặn luồng chụp
   * vì thiếu cấu hình. `consentVersion` tăng lên mỗi lần nội dung được sửa;
   * 0 nghĩa là "chưa từng cấu hình, đang dùng bản mặc định".
   */
  @Column('text', { nullable: true, name: 'consent_content' })
  @ApiPropertyOptional({ description: 'Nội dung xin đồng ý (consent)' })
  consentContent?: string | null;

  @Column('int', { default: 0, name: 'consent_version' })
  @ApiProperty({ description: 'Phiên bản nội dung consent hiện tại' })
  consentVersion: number;

  /**
   * Short human-facing campaign code (BRD §III.2.4.2, e.g. `2026DOT01`) —
   * nullable because a migration can't sanely backfill uniqueness for
   * existing rows, but required in `CreateCampaignDto` for every campaign
   * created going forward (2026-09-08, §3.1.1).
   */
  @Column('varchar', { length: 20, nullable: true, unique: true })
  @ApiPropertyOptional({ description: 'Mã campaign, ví dụ 2026DOT01' })
  code?: string | null;

  @Column('varchar', { length: 100, nullable: true })
  @ApiPropertyOptional({ description: 'Khóa (K20…)' })
  cohort?: string | null;

  /**
   * NULL = no lower bound — the campaign is open from the start (as soon as
   * `manual_status`/`expiresAt` allow it), same "always open" meaning
   * `expiresAt: null` already has for the upper bound. See
   * `computeEffectiveStatus` for how this combines with `expiresAt`/
   * `manualStatus` into `effectiveStatus` (2026-09-08, §3.1.2).
   */
  @Column('timestamptz', { nullable: true, name: 'starts_at' })
  @ApiPropertyOptional({
    description: 'Thời điểm mở campaign — để trống là mở ngay',
  })
  startsAt?: Date | null;

  /** NULL = không giới hạn số lượng SV dự kiến. Used only for `quotaReached` (a warning, never a hard block — §3.1.2/Q6). */
  @Column('int', { nullable: true, name: 'quota_planned' })
  @ApiPropertyOptional({
    description: 'Chỉ tiêu số lượng SV dự kiến — để trống là không giới hạn',
  })
  quotaPlanned?: number | null;

  /**
   * Manual override of the otherwise date-derived status — `PAUSED` or
   * `CLOSED`. NULL means "let the dates decide" (`UPCOMING`/`OPEN`/
   * `EXPIRED`) — see `computeEffectiveStatus`. Never set to `OPEN`/
   * `UPCOMING`/`EXPIRED` directly; those are always derived, never stored.
   */
  @Column('varchar', { length: 10, nullable: true, name: 'manual_status' })
  @ApiPropertyOptional({
    description: 'PAUSED | CLOSED — ghi đè trạng thái suy ra từ ngày',
    enum: ['PAUSED', 'CLOSED'],
  })
  manualStatus?: CampaignManualStatus | null;

  /**
   * Which mapped camera roles should also have their video recorded when
   * `recordVideo` is on. NULL = every mapped camera records (the
   * `recordVideo` boolean alone used to mean this implicitly) — §3.1.1.
   */
  @Column('jsonb', { nullable: true, name: 'record_video_roles' })
  @ApiPropertyOptional({
    description: 'Camera nào quay video — null = tất cả camera đã gán',
    type: [String],
  })
  recordVideoRoles?: CameraRole[] | null;

  /** NULL = chưa cấu hình ảnh thẻ cho campaign này — xem `CardSpec`. */
  @Column('jsonb', { nullable: true, name: 'card_spec' })
  @ApiPropertyOptional({
    description: 'Chuẩn ảnh thẻ (cỡ/dpi/nền/crop/làm mịn)',
  })
  cardSpec?: CardSpec | null;

  /**
   * NULL = dùng `defaultWorkflow` hardcode của app (5 góc hiện tại) — mục
   * 3.6. Khi có giá trị, đây là danh sách `CaptureStep` thay thế hoàn toàn,
   * app tải về lúc đăng ký/khởi động thay vì hardcode.
   */
  @Column('jsonb', { nullable: true, name: 'capture_angles' })
  @ApiPropertyOptional({ description: 'Danh sách bước chụp tuỳ chỉnh' })
  captureAngles?: CaptureStep[] | null;

  /**
   * @deprecated Moved to kiosk-side settings per the 2026-09-08 decision —
   * see docs/plans/campaign-config-sso-card-photo-discussion.md §3.9. Kept
   * only for the existing `GET /v1/devices/config` kiosk-compatibility path
   * (old zip-activated kiosks) — do not read or write this from any new
   * code. NULL = giữ default cục bộ của app.
   */
  @Column('varchar', { length: 10, nullable: true, name: 'capture_mode' })
  @ApiPropertyOptional({
    description: 'AUTO | MANUAL | OFF',
    enum: ['AUTO', 'MANUAL', 'OFF'],
  })
  captureMode?: CaptureTriggerMode | null;

  /**
   * @deprecated Moved to kiosk-side settings per the 2026-09-08 decision —
   * see docs/plans/campaign-config-sso-card-photo-discussion.md §3.9. Kept
   * only for the existing `GET /v1/devices/config` kiosk-compatibility path
   * — do not read or write this from any new code.
   */
  @Column('int', { nullable: true, name: 'auto_hold_ms' })
  @ApiPropertyOptional({
    description: 'Thời gian giữ tư thế khi ở chế độ AUTO (ms)',
  })
  autoHoldMs?: number | null;

  /**
   * @deprecated Moved to kiosk-side settings ("Cách chụp: Tuần tự/Đồng
   * thời") per the 2026-09-08 decision — see
   * docs/plans/campaign-config-sso-card-photo-discussion.md §3.9. Kept only
   * for the existing `GET /v1/devices/config` kiosk-compatibility path — do
   * not read or write this from any new code. The "mỗi khung một camera
   * riêng" hard block this used to gate is gone from
   * `capture-angles.validator.ts`; a campaign is never blocked from being
   * created by how many cameras a kiosk happens to have (see
   * `requiredCameraCount`, a non-blocking hint, instead).
   *
   * When true, the kiosk must map every capture step to its own physical
   * camera before it can start a session — one mapped camera per frame, no
   * step sharing a camera with another. Fed straight to the kiosk via
   * `GET /v1/devices/config` alongside `captureAngles`; the kiosk refuses to
   * start a session if the current camera mapping cannot satisfy it (i.e.
   * some step's effective role — explicit `cameraRole` or the type default —
   * has no camera assigned, or two steps resolve to the same role).
   */
  @Column('boolean', { default: false, name: 'simultaneous_capture' })
  @ApiProperty({
    description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng',
  })
  simultaneousCapture: boolean;

  /**
   * Campaign-level switch for local video "stream" recording alongside a
   * capture session (§3.1) — off by default, so no `capture_streams` row is
   * created at all unless a campaign explicitly opts in. Fed straight to the
   * kiosk via `GET /v1/devices/config` alongside `simultaneousCapture`; video
   * upload to fs-core is explicitly out of scope (2026-09-05 product
   * decision) — this only ever gates local recording.
   */
  @Column('boolean', { default: false, name: 'record_video' })
  @ApiProperty({
    description: 'Quay video trong lúc chụp (lưu local, không upload)',
  })
  recordVideo: boolean;

  @OneToMany(() => Device, (device) => device.campaign)
  devices?: Device[];
}
