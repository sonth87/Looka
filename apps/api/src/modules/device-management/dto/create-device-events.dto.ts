import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { DeviceEventType } from '../entities/device-event.entity';

export class DeviceEventInput {
  @ApiProperty({ enum: DeviceEventType })
  @IsEnum(DeviceEventType)
  type: DeviceEventType;

  @ApiProperty({ description: "The kiosk's own clock when this happened" })
  @IsDateString()
  occurredAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * A batch, not one event per request — a kiosk queues locally while
 * offline (see docs/plans/multi-camera-device-management-discussion.md
 * §3.3/§3.4) and pushes whatever has accumulated on its own schedule, so a
 * single push is commonly many events at once.
 */
export class CreateDeviceEventsDto {
  @ApiProperty({ type: [DeviceEventInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceEventInput)
  events: DeviceEventInput[];
}
