import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class AddPhotoDto {
  @ApiProperty({ description: 'Bước trong quy trình chụp, ví dụ FRONT/LEFT' })
  @IsString()
  @IsNotEmpty()
  stepId: string;

  @ApiProperty({
    description: 'Số lần thử của bước này, bắt đầu từ 1',
    default: 1,
  })
  @IsInt()
  @Min(1)
  attempt: number;

  @ApiProperty({
    description: 'Ảnh dạng data URL base64, ví dụ "data:image/jpeg;base64,..."',
  })
  @IsString()
  @IsNotEmpty()
  dataUrl: string;
}
