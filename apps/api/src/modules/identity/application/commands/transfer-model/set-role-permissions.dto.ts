import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [String],
    description: 'Danh sách mã quyền, thay toàn bộ',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissionCodes: string[];
}
