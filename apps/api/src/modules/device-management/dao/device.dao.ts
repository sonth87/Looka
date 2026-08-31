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

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
