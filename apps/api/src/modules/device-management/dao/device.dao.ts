import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { DeviceStatus } from '../entities/device.entity';

/** Never exposes `deviceSecretHash` — the secret itself is only ever handed out once, inside the activation zip. */
export class DeviceDao {
  @ApiProperty({ description: 'Device id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional()
  @Expose()
  authApiEndpoint?: string;

  @ApiProperty({ enum: DeviceStatus })
  @Expose()
  status: DeviceStatus;

  @ApiPropertyOptional()
  @Expose()
  activatedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Thời điểm cấp lại mã gần nhất, còn đang chờ kiosk nạp gói mới' })
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
