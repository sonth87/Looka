import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CampaignTimingRowDao {
  @ApiPropertyOptional({
    description:
      'deviceId/operatorUserId/date tuỳ groupBy — null gộp "không rõ"',
  })
  key: string | null;

  @ApiProperty({
    description: 'Số phiên có đủ identifiedAt+finishedAt để tính',
  })
  count: number;

  @ApiPropertyOptional()
  avgMs: number | null;

  @ApiPropertyOptional({
    description: 'null cho tới khi cron DAILY_RECOMPUTE đã chạy qua ngày này',
  })
  p50Ms: number | null;

  @ApiPropertyOptional()
  p95Ms: number | null;
}
