import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A class, not a bare interface — `RoleCommandController` passes this to
 * `@ApiResponseDecorator()`, which needs a real constructor to build a
 * Swagger schema via reflection (an `interface` has no runtime
 * representation to reflect on).
 */
export class RoleResult {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() isSystem: boolean;
  @ApiProperty({ type: [String] }) permissionCodes: string[];
}
