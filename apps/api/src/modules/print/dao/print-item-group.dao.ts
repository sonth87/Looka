import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** `GET /v1/print/items/groups` row — one group (class or faculty) with per-status counts, plan §2.5's "gom nhóm". */
export class PrintItemGroupDao {
  @ApiPropertyOptional({
    description: 'Giá trị nhóm — null gộp các item chưa có className/faculty',
  })
  value: string | null;

  @ApiProperty() total: number;
  @ApiProperty() pending: number;
  @ApiProperty() rendered: number;
  @ApiProperty() printed: number;
  @ApiProperty() failed: number;
}
