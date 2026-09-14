import { ApiProperty } from '@nestjs/swagger';

export class RoleReadModel {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty() isSystem: boolean;
  @ApiProperty({ type: [String] }) permissionCodes: string[];
  @ApiProperty() userCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
