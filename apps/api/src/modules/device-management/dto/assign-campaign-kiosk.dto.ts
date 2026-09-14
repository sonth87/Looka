import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/** `PUT /v1/campaigns/:id/assignments/:deviceId` body — D-Q4. */
export class AssignCampaignKioskDto {
  @ApiProperty({ description: 'Người được gán vào kiosk này' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
