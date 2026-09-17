import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Plan item 14, 2026-09-17 — `POST /v1/users/find-or-create-by-email`. */
export class FindOrCreateUserByEmailDto {
  @ApiProperty({ description: 'Email' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({
    description:
      'Tên hiển thị, nếu biết — không có thì suy ra từ phần trước @ của email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}
