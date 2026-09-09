import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { DeviceStatus } from '../entities/device.entity';

/** Never exposes `deviceSecretHash` — the secret itself is only ever handed out once, inside the activation zip / self-enroll response. */
export class DeviceDao {
  @ApiProperty({ description: 'Device id (uuid)' })
  @Expose()
  id: string;

  @ApiPropertyOptional({
    description: 'null nếu tự đăng ký và chưa chọn campaign (§3.3)',
  })
  @Expose()
  campaignId?: string | null;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional({ description: 'Tên máy — chỉ có khi tự đăng ký' })
  @Expose()
  hostname?: string | null;

  @ApiPropertyOptional({ description: 'Người tự đăng ký thiết bị này lần đầu' })
  @Expose()
  enrolledByUserId?: string | null;

  @ApiPropertyOptional({
    description: 'Người đăng nhập gần nhất trên thiết bị này',
  })
  @Expose()
  lastUserId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  authApiEndpoint?: string;

  @ApiProperty({ enum: DeviceStatus })
  @Expose()
  status: DeviceStatus;

  @ApiPropertyOptional()
  @Expose()
  activatedAt?: Date | null;

  @ApiPropertyOptional({
    description:
      'Thời điểm cấp lại mã gần nhất, còn đang chờ kiosk nạp gói mới',
  })
  @Expose()
  secretRotatedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Lần xác thực thành công gần nhất' })
  @Expose()
  lastAuthAt?: Date | null;

  @ApiPropertyOptional({ description: 'Lần xác thực thất bại gần nhất' })
  @Expose()
  lastAuthFailedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Lý do xác thực thất bại gần nhất' })
  @Expose()
  lastAuthFailReason?: string | null;

  @ApiPropertyOptional({ description: 'Thời điểm thiết bị bị thu hồi' })
  @Expose()
  revokedAt?: Date | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}

/**
 * `POST /v1/devices/self-enroll` response (§3.3) — plain JSON, no zip: the
 * plaintext secret is handed back exactly once, same "never stored, never
 * retrievable again" rule as the admin zip flow's `activation.json`, just
 * without a file download wrapper around it.
 */
export class SelfEnrollDeviceDao {
  @ApiProperty()
  @Expose()
  deviceId: string;

  @ApiProperty({ description: 'Chỉ trả về đúng một lần' })
  @Expose()
  deviceSecret: string;

  @ApiProperty()
  @Expose()
  apiBaseUrl: string;

  @ApiPropertyOptional({
    description: 'null nếu request không gửi campaignId — thiết bị chưa gắn campaign nào',
  })
  @Expose()
  campaignId: string | null;
}
