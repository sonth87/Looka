import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewStatsByReviewerDao {
  @ApiPropertyOptional({
    description: 'null gộp hành động không có actor (hệ thống)',
  })
  reviewerUserId: string | null;

  @ApiProperty()
  reviewerName: string;

  @ApiProperty()
  approved: number;

  @ApiProperty()
  rejected: number;
}

export class ReviewStatsDao {
  @ApiProperty({
    description:
      'Số bộ ảnh hiện tại theo status (đếm trực tiếp, không phải từ bảng thống kê)',
  })
  byStatus: Record<string, number>;

  @ApiProperty()
  approved: number;

  @ApiProperty()
  rejected: number;

  @ApiProperty({ description: 'Số lần AI được chấp nhận (AI_ACCEPTED)' })
  aiEdited: number;

  @ApiProperty()
  uploaded: number;

  @ApiProperty({
    description:
      'Xấp xỉ: approved trừ đi aiEdited/uploaded — không có bộ đếm riêng phân biệt "duyệt thẳng từ ảnh tự động"',
  })
  autoOnly: number;

  @ApiProperty({ type: [ReviewStatsByReviewerDao] })
  byReviewer: ReviewStatsByReviewerDao[];

  @ApiPropertyOptional()
  avgReviewHours: number | null;
}
