import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * `POST /v1/campaigns/:id/members/grant` (2026-09-18 — replaces the
 * device-pairing-based auto-approve `campaign_kiosk_assignments` used to
 * provide, see `CampaignMemberService.grant()`'s own doc comment). Batch
 * so the CMS's "Cấp quyền" picker (`CampaignList.tsx`, multi-select over
 * the existing user list) can grant several people access to one campaign
 * in a single request, not one round-trip per person.
 *
 * `@ArrayUnique()` added 2026-09-18 (plan §1.2): the CMS picker can never
 * submit a duplicate id today (`selected` is a `Map<string, UserListItem>`
 * keyed by id), but without this a duplicate reaching `grant()`'s
 * `orUpdate(...)` bulk upsert would hit Postgres's "ON CONFLICT DO UPDATE
 * command cannot affect row a second time" and surface as an opaque 500 —
 * reject it here as a normal 400 instead.
 */
export class GrantCampaignMembersDto {
  @ApiProperty({
    type: [String],
    description:
      'user_id của những người được cấp quyền APPROVED vào campaign này',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds: string[];
}
