import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
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

  /**
   * `unassigned=true` (Giai đoạn 4, plan §4.1, feature 2) — items with no
   * `batchId` at all. Replaces the CMS's old client-side hack (paginate
   * 100 rows, filter `!i.batchId` in the browser, `limit:200` silently
   * breaking against this DTO's own `@Max(100)`) with a real server-side
   * filter. Mutually exclusive with `batchId` in practice — if both are
   * sent, `batchId` wins (checked first below in the service).
   */
  @ApiPropertyOptional({ description: 'true = chỉ item chưa thuộc đợt in nào' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unassigned?: boolean;

  /**
   * One status, or several comma-separated (`status=PENDING,RENDERED`) —
   * 2026-09-30: a CENTRALIZED batch has no render step, so the CMS shows
   * PENDING and RENDERED as ONE "Chưa in" filter option (two options with
   * the same label were confusing, and the second matched nothing). A single
   * value keeps working exactly as before (parsed to a one-element array).
   */
  @ApiPropertyOptional({
    description: `Một hoặc nhiều trạng thái, cách nhau bằng dấu phẩy. Giá trị hợp lệ: ${PRINT_ITEM_STATUSES.join(', ')}`,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value,
  )
  @IsIn(PRINT_ITEM_STATUSES, { each: true })
  status?: PrintItemStatus[];

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
