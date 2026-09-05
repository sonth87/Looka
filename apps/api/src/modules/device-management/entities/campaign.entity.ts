import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaptureStep, CaptureTriggerMode } from '@face/core';
import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../shared/common/base.entity';
import { Device } from './device.entity';

export enum CampaignPurpose {
  STUDENT_CARD = 'STUDENT_CARD',
  KYC_ENROLLMENT = 'KYC_ENROLLMENT',
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
   * NULL = dùng `defaultWorkflow` hardcode của app (5 góc hiện tại) — mục
   * 3.6. Khi có giá trị, đây là danh sách `CaptureStep` thay thế hoàn toàn,
   * app tải về lúc đăng ký/khởi động thay vì hardcode.
   */
  @Column('jsonb', { nullable: true, name: 'capture_angles' })
  @ApiPropertyOptional({ description: 'Danh sách bước chụp tuỳ chỉnh' })
  captureAngles?: CaptureStep[] | null;

  /** NULL = giữ default cục bộ của app (hiện là MANUAL) — mục 3.8. */
  @Column('varchar', { length: 10, nullable: true, name: 'capture_mode' })
  @ApiPropertyOptional({ description: 'AUTO | MANUAL | OFF', enum: ['AUTO', 'MANUAL', 'OFF'] })
  captureMode?: CaptureTriggerMode | null;

  @Column('int', { nullable: true, name: 'auto_hold_ms' })
  @ApiPropertyOptional({ description: 'Thời gian giữ tư thế khi ở chế độ AUTO (ms)' })
  autoHoldMs?: number | null;

  /**
   * When true, the kiosk must map every capture step to its own physical
   * camera before it can start a session — one mapped camera per frame, no
   * step sharing a camera with another. Fed straight to the kiosk via
   * `GET /v1/devices/config` alongside `captureAngles`; the kiosk refuses to
   * start a session if the current camera mapping cannot satisfy it (i.e.
   * some step's effective role — explicit `cameraRole` or the type default —
   * has no camera assigned, or two steps resolve to the same role).
   */
  @Column('boolean', { default: false, name: 'simultaneous_capture' })
  @ApiProperty({ description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng' })
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
  @ApiProperty({ description: 'Quay video trong lúc chụp (lưu local, không upload)' })
  recordVideo: boolean;

  @OneToMany(() => Device, (device) => device.campaign)
  devices?: Device[];
}
