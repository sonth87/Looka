import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
} from 'class-validator';

export class ListStudentsQueryDto extends QueryPaginateDto {
  // Same override reasoning as ListSessionsQueryDto: this endpoint's own
  // plan calls for a default of 20, not QueryPaginateDto's 10.
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

  @ApiPropertyOptional({
    description:
      'Tìm theo mã SV, tên, số CCCD, hoặc tên lớp (hai trường sau đọc từ sessions.metadata — xem StudentService.listStudents)',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
