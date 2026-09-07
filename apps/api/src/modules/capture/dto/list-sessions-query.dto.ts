import { QueryPaginateDto } from '@app/common/dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
} from 'class-validator';
import { SessionListState, SessionSource } from '../capture.constants';

export class ListSessionsQueryDto extends QueryPaginateDto {
  // Overrides QueryPaginateDto's own default of 10 - the plan for this
  // endpoint specifically calls for 20 (A.6). Redeclaring the property
  // means every decorator has to be repeated too - a subclass field
  // declaration replaces the parent's entirely, it does not merge with it.
  @ApiPropertyOptional({
    description: 'Số kết quả mỗi trang',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Lọc theo campaign' })
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo thiết bị' })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo nguồn phiên',
    enum: SessionSource,
  })
  @IsOptional()
  @IsEnum(SessionSource)
  source?: SessionSource;

  @ApiPropertyOptional({
    description: 'Từ thời điểm (ISO), so theo captured_at',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Đến thời điểm (ISO), so theo captured_at',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái tải ảnh, suy ra từ các photo của phiên',
    enum: SessionListState,
    default: SessionListState.ALL,
  })
  @IsOptional()
  @IsEnum(SessionListState)
  state?: SessionListState;
}
