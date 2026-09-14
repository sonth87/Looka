import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetUserRolesDto {
  @ApiProperty({
    type: [String],
    description: 'Danh sách id vai trò, thay toàn bộ',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  roleIds: string[];
}
