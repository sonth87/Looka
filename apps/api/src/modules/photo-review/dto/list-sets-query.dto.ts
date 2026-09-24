import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
} from 'class-validator';
import { PhotoReviewSetStatus } from '../photo-review.constants';

/** Query-string booleans arrive as the strings "true"/"false" — `Boolean("false")` is truthy, so this parses the actual text rather than relying on `@Type(() => Boolean)`. */
const parseQueryBoolean = ({
  value,
}: {
  value: unknown;
}): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
};

export class ListSetsQueryDto extends QueryPaginateDto {
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

  @ApiPropertyOptional({ description: 'Lọc theo loại ảnh' })
  @IsOptional()
  @IsUUID()
  kindId?: string;

  @ApiPropertyOptional({
    enum: PhotoReviewSetStatus,
    description: 'Lọc theo trạng thái hồ sơ',
  })
  @IsOptional()
  @IsEnum(PhotoReviewSetStatus)
  status?: PhotoReviewSetStatus;

  @ApiPropertyOptional({
    description: 'Chỉ hồ sơ có ít nhất một phiên bản sửa AI chưa bị hủy',
  })
  @IsOptional()
  @Transform(parseQueryBoolean)
  @IsBoolean()
  hasAi?: boolean;

  @ApiPropertyOptional({
    description: 'Chỉ hồ sơ có ít nhất một phiên bản tải lên chưa bị hủy',
  })
  @IsOptional()
  @Transform(parseQueryBoolean)
  @IsBoolean()
  hasUpload?: boolean;

  @ApiPropertyOptional({
    description:
      'Chỉ hồ sơ chưa có ảnh thẻ hiện tại (current_card_variant_id IS NULL)',
  })
  @IsOptional()
  @Transform(parseQueryBoolean)
  @IsBoolean()
  missingCard?: boolean;

  @ApiPropertyOptional({ description: 'Tìm theo mã hoặc tên người' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Lọc theo lớp (khớp đúng)' })
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional({ description: 'Lọc theo ngành (khớp đúng)' })
  @IsOptional()
  @IsString()
  major?: string;

  @ApiPropertyOptional({ description: 'Lọc theo khoa (khớp đúng)' })
  @IsOptional()
  @IsString()
  faculty?: string;

  @ApiPropertyOptional({ description: 'Lọc theo số CCCD (khớp đúng)' })
  @IsOptional()
  @IsString()
  citizenId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo mã SV (khớp đúng, khác q — q tìm gần đúng)',
  })
  @IsOptional()
  @IsString()
  subjectCode?: string;

  @ApiPropertyOptional({ description: 'Chỉ hồ sơ quá hạn xử lý (P4/D-Q6)' })
  @IsOptional()
  @Transform(parseQueryBoolean)
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({
    description:
      'true = chỉ hồ sơ đã duyệt (APPROVED), false = chỉ hồ sơ chưa duyệt (mọi trạng thái khác) — độc lập với `status` (khớp đúng 1 giá trị)',
  })
  @IsOptional()
  @Transform(parseQueryBoolean)
  @IsBoolean()
  approved?: boolean;
}
