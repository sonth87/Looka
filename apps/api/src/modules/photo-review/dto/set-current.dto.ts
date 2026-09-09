import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetCurrentDto {
  @ApiProperty({ description: 'Phiên bản muốn đặt làm ảnh thẻ hiện tại' })
  @IsUUID()
  variantId: string;
}
