import { ApiProperty } from '@nestjs/swagger';

export class SetUserRolesResult {
  @ApiProperty() userId: string;
  @ApiProperty({ type: [String] }) roleCodes: string[];
}
