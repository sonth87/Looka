import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { DeviceStatus } from '../entities/device.entity';

/** `GET /v1/campaigns/:id/kiosks` row — cms-8-screens-api-plan.md §2.1's dashboard detail ("danh sách kiosk đang setup + người được gán"). Per-kiosk timing has its own dedicated endpoint (`GET /v1/campaigns/:id/stats/timing?groupBy=device`, P4) rather than being duplicated here. */
export class CampaignKioskSummaryDao {
  @ApiProperty()
  @Expose()
  deviceId: string;

  @ApiProperty()
  @Expose()
  deviceName: string;

  @ApiProperty({ enum: DeviceStatus })
  @Expose()
  status: DeviceStatus;

  @ApiPropertyOptional()
  @Expose()
  assignedUserId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  assignedUserEmail?: string | null;

  @ApiPropertyOptional()
  @Expose()
  assignedUserDisplayName?: string | null;

  @ApiProperty({
    description: 'Số phiên COMPLETED trên kiosk này trong campaign',
  })
  @Expose()
  sessionsCompleted: number;
}
