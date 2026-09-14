import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
} from 'class-validator';

/**
 * `GET /v1/campaigns?page&limit&status&workflowId&from&to&q` —
 * cms-8-screens-api-plan.md §2.3/P3. Deliberately does NOT extend
 * `QueryPaginateDto`: that base class defaults `page`/`limit` to `1`/`10`
 * via `class-transformer`, which would make "was `page` actually supplied?"
 * unobservable by the time the controller sees it — and §9.1 backward-compat
 * rule 6 requires `GET /v1/campaigns` to keep returning a **plain array**
 * (today's shape) when the caller omits `page`, only switching to
 * `{items, meta}` once they opt in by passing one. `limit` still defaults to
 * 10, but only applied inside the paginated branch, after `page` is already
 * known to be present.
 */
export class ListCampaignsQueryDto {
  @ApiPropertyOptional({
    description: 'Trang — bỏ trống để giữ hành vi cũ (trả mảng, không lọc)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['PAUSED', 'CLOSED', 'UPCOMING', 'OPEN', 'EXPIRED'],
    description: 'Lọc theo effectiveStatus',
  })
  @IsOptional()
  @IsIn(['PAUSED', 'CLOSED', 'UPCOMING', 'OPEN', 'EXPIRED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Lọc theo nghiệp vụ đã ghim' })
  @IsOptional()
  @IsUUID()
  workflowId?: string;

  @ApiPropertyOptional({
    description: 'Chỉ lấy đợt có thời gian diễn ra giao với [from, to]',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã campaign' })
  @IsOptional()
  @IsString()
  q?: string;
}
