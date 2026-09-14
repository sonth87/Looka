import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class TestEligibilityLookupDto {
  @ApiProperty({ description: 'Mã client, ví dụ DAINAM_STUDENT_INFO' })
  @IsString()
  clientCode: string;

  @ApiProperty({ description: 'Mã dùng để tra cứu thử, ví dụ mã sinh viên' })
  @IsString()
  @MaxLength(100)
  key: string;
}
