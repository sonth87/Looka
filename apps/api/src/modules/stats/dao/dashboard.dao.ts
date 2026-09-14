import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardCapturedByDayDao {
  @ApiProperty({ example: '2026-09-14' })
  date: string;

  @ApiProperty()
  count: number;
}

export class DashboardKpisDao {
  @ApiProperty()
  captured: { total: number; byDay: DashboardCapturedByDayDao[] };

  @ApiProperty({
    description: 'Số bộ ảnh đang chờ CTSV duyệt (READY/IN_REVIEW)',
  })
  pendingReview: number;

  @ApiProperty({ description: 'Luôn 0 cho tới khi P6 (đợt in) có dữ liệu' })
  printed: number;

  @ApiProperty({ description: 'Số bộ ảnh quá hạn xử lý (D-Q6)' })
  overdue: number;
}

export class DashboardActiveCampaignDao {
  @ApiProperty()
  campaignId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  code?: string | null;

  @ApiPropertyOptional()
  location?: string | null;

  @ApiPropertyOptional({
    description: 'quotaPlanned hoặc số dòng roster hợp lệ',
  })
  quota?: number | null;

  @ApiProperty()
  captured: number;

  @ApiProperty()
  processed: number;

  @ApiProperty()
  sessions: number;

  @ApiProperty()
  pendingReview: number;

  @ApiProperty()
  captureErrors: number;

  @ApiPropertyOptional({ description: 'null nếu chưa có roster' })
  notCaptured?: number | null;

  @ApiProperty()
  overdue: number;

  @ApiProperty({
    description: 'Phiên SESSION_STARTED chưa hoàn tất trong 15 phút gần nhất',
  })
  inProgressNow: number;

  @ApiPropertyOptional()
  lastCaptureAt?: Date | null;
}
