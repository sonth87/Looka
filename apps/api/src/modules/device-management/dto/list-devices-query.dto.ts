import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { DeviceStatus } from '../entities/device.entity';

/** `GET /v1/devices?campaignId&status&q&page&limit` — cms-8-screens-api-plan.md §2.3/P3. */
export class ListDevicesQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ enum: DeviceStatus })
  @IsOptional()
  @IsIn(Object.values(DeviceStatus))
  status?: DeviceStatus;

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc hostname' })
  @IsOptional()
  @IsString()
  q?: string;
}
