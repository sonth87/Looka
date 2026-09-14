import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    description:
      'Mã vai trò (chữ hoa, số, gạch dưới), không đổi được sau khi tạo',
  })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ description: 'Tên vai trò' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả' })
  @IsOptional()
  @IsString()
  description?: string;
}
