import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'Tên hiển thị' })
  @IsString()
  @MaxLength(255)
  displayName: string;

  @ApiPropertyOptional({ description: 'Chức danh' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: 'Email' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({ description: 'Mã nội bộ' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ description: 'Số điện thoại' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Phân quyền ngay khi tạo, hoặc để trống để phân quyền sau',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  roleIds?: string[];
}
