import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../shared/common/base.entity';
import { Campaign } from './campaign.entity';

export enum DeviceStatus {
  /** Registered on the CMS, but the kiosk has not loaded its activation file yet. */
  REGISTERED = 'REGISTERED',
  /** The kiosk has loaded its activation file and is operating. */
  ACTIVATED = 'ACTIVATED',
}

/**
 * One physical kiosk. `id` (inherited uuid) is the device_id handed to the
 * kiosk in its activation file — see docs/plans/multi-camera-device-management-discussion.md
 * §3.2. Registration always happens under a `Campaign`, which is where
 * expiry, consent, and capture configuration actually live; nothing here
 * duplicates those.
 */
@Entity('devices')
export class Device extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign chứa thiết bị này' })
  campaignId: string;

  @ManyToOne(() => Campaign, (campaign) => campaign.devices, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign;

  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên thiết bị' })
  name: string;

  @Column('varchar', { length: 500, nullable: true, name: 'auth_api_endpoint' })
  @ApiPropertyOptional({ description: 'API endpoint lấy thông tin xác thực cho thiết bị này' })
  authApiEndpoint?: string;

  /**
   * SHA-256 of the device_secret, never the secret itself — the plaintext
   * is handed to the kiosk exactly once, inside the activation file, and is
   * not retrievable afterwards. Verified with a constant-time compare, the
   * same reasoning as `ApiKeyMiddleware`'s `timingSafeEqual` use.
   */
  @Column('varchar', { length: 64, name: 'device_secret_hash', select: false })
  deviceSecretHash: string;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    default: DeviceStatus.REGISTERED,
  })
  @ApiProperty({ description: 'Trạng thái thiết bị', enum: DeviceStatus })
  status: DeviceStatus;

  @Column('timestamptz', { nullable: true, name: 'activated_at' })
  @ApiPropertyOptional({ description: 'Thời điểm kiosk nạp mã kích hoạt' })
  activatedAt?: Date | null;
}
