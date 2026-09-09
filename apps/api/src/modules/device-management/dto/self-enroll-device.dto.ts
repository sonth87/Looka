import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Body for `POST /v1/devices/self-enroll` (§3.3) — user-token, campaign
 * optional at the type level but in practice always sent by the desktop
 * client once the operator has picked a campaign (`CampaignGate.tsx`):
 * without it, the device row stays `campaignId: null` and every subsequent
 * `GET /v1/devices/config`/`POST /v1/devices/events` call 409s with
 * `DEVICE_HAS_NO_CAMPAIGN` (see `DeviceSelfController`'s own doc comments) —
 * a self-enrolled device otherwise has no way to attach one, since nothing
 * else about it ever changes after the initial call except by enrolling
 * again. Re-enrolling (an existing fingerprint) re-attaches this same field,
 * so switching which campaign the operator is capturing for on this kiosk
 * is just a matter of calling self-enroll again with the new id.
 */
export class SelfEnrollDeviceDto {
  @ApiProperty({ description: 'Tên máy (hostname)' })
  @IsString()
  @MaxLength(255)
  hostname: string;

  @ApiProperty({
    description:
      'Fingerprint máy (hash machine id + OS), dùng để nhận lại thiết bị cũ',
  })
  @IsString()
  @MaxLength(255)
  fingerprint: string;

  @ApiPropertyOptional({
    description:
      'Hệ điều hành, chỉ để ghi chú — không chọn installer như luồng zip cũ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  os?: string;

  @ApiPropertyOptional({
    description:
      'Campaign đang chọn để chụp trên máy này — gắn vào thiết bị để GET /v1/devices/config và POST /v1/devices/events hoạt động được',
  })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
