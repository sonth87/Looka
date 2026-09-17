import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { PRINT_ITEM_STATUSES, type PrintItemStatus } from '../print.constants';

/** `GET /v1/print/items?campaignId&batchId&status&className&faculty&q&sort&page&limit` — plan §2.5. */
export class ListPrintItemsQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  /**
   * `statusPriority` — chốt 2026-09-17 (plan item 8, §5 Q2): "chưa in" lên
   * đầu, rồi "đang in", rồi "đã in" — cho màn xem theo campaign, nơi 1
   * campaign đã in gần hết vẫn cần nổi bật ngay các mục còn lại. Mặc định
   * (không truyền) giữ đúng hành vi cũ — mới nhất lên đầu — vì đó vẫn đúng
   * cho màn xem theo batch (`PrintBatchDetailPage.tsx`).
   */
  @ApiPropertyOptional({ enum: ['createdAt', 'statusPriority'] })
  @IsOptional()
  @IsIn(['createdAt', 'statusPriority'])
  sort?: 'createdAt' | 'statusPriority';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: PRINT_ITEM_STATUSES })
  @IsOptional()
  @IsIn(PRINT_ITEM_STATUSES)
  status?: PrintItemStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  faculty?: string;

  @ApiPropertyOptional({ description: 'Tìm theo mã SV hoặc họ tên' })
  @IsOptional()
  @IsString()
  q?: string;
}
