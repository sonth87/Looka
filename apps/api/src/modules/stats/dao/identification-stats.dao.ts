import { ApiProperty } from '@nestjs/swagger';

export class IdentificationStatsDao {
  @ApiProperty({ description: '{ QR_CCCD: 12, MANUAL_LOOKUP: 3, ... }' })
  byMethod: Record<string, number>;
}
