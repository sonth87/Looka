import { ApiProperty } from '@nestjs/swagger';

/** Response for `GET /v1/me/permissions` — cms-8-screens-api-plan.md §2.8. */
export class MePermissionsReadModel {
  @ApiProperty() isAdmin: boolean;
  @ApiProperty({ type: [String] }) roleCodes: string[];
  @ApiProperty({
    type: [String],
    description:
      'Empty when isAdmin is true — an admin implicitly has every permission.',
  })
  permissionCodes: string[];
}
