import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RosterGroupFieldDao {
  @ApiProperty({ description: 'Tên field dùng cho groupBy=/secondaryGroupBy=' })
  field: string;

  @ApiProperty({ description: 'Nhãn hiển thị' })
  label: string;

  @ApiProperty({
    description:
      'column: cột thật trong campaign_subjects; extra: khoá jsonb phát hiện được từ API pull',
    enum: ['column', 'extra'],
  })
  source: 'column' | 'extra';
}

export class RosterGroupStatDao {
  @ApiPropertyOptional({
    description: 'Giá trị của groupBy — null gộp "không rõ"',
  })
  value: string | null;

  @ApiPropertyOptional({
    description: 'Giá trị của secondaryGroupBy, nếu có — null gộp "không rõ"',
  })
  secondaryValue: string | null;

  @ApiProperty({ description: 'Tổng số SV trong nhóm (roster VALID)' })
  rosterTotal: number;

  @ApiProperty({ description: 'Số SV đã có hồ sơ ảnh (subject_photo_sets)' })
  captured: number;

  @ApiProperty({ description: 'Số SV có hồ sơ ảnh đã duyệt (APPROVED)' })
  approved: number;

  @ApiProperty({ description: 'Số SV chưa có hồ sơ ảnh' })
  notCaptured: number;

  @ApiProperty({
    description: 'Số SV đã xác nhận in thẻ (campaign_subjects.printedAt)',
  })
  printed: number;

  @ApiProperty({
    description:
      'Số SV có ít nhất 1 thẻ in ghi nhận lỗi — xem doc comment RosterGroupStatsService.groupStats về giới hạn hiện tại',
  })
  rejected: number;
}
