import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

/**
 * "Ai được duyệt đợt/nhóm nào" (plan §5.2 feature 13, PER-CAMPAIGN pivot
 * 2026-09-28) — a grant `(userId, campaignId, groupField?, groupValue?)`,
 * e.g. `(nguyễn A, <campaign C>, 'faculty', 'Khoa CNTT')`. `groupField` is
 * one of `SubjectPhotoSet`'s own denormalized roster columns
 * (`className`/`faculty`/`major` — plan explicitly scopes this to those 3,
 * not full jsonb-discovered-field generality, since `subject_photo_sets`
 * has no `extra` jsonb of its own). `groupField`/`groupValue` BOTH `NULL`
 * means "the whole campaign" — a distinct grant kind from a group row, not
 * a degenerate case of one.
 *
 * **PER-CAMPAIGN, not global** (2026-09-28 pivot away from this entity's
 * original 2026-09-18 design — see migration
 * `1838000000000-ReviewAssignmentsPerCampaign.ts` for the full history/data
 * migration). A user with ZERO rows for a given `campaignId` sees NOTHING
 * in that campaign — this table is now the SOLE gate for "which campaigns/
 * groups", not just a narrowing filter on top of an otherwise-unrestricted
 * default. `ReviewerRoleGuard` (route-level "is this person a reviewer at
 * all") is unaffected and still required first. Admin (`users.is_admin`)
 * always bypasses this table entirely — see `ReviewAssignmentService.
 * assertInScope`/`buildScopeFilter`.
 *
 * `userId`/`campaignId` deliberately have NO foreign key — this module's
 * consistent "never FK a cross-module/user id" convention (see e.g.
 * `SubjectPhotoSet.campaignId`, `PhotoVariant.createdByUserId`).
 *
 * Unique on `(userId, campaignId, groupField, groupValue)` treating NULLs as
 * equal (`NULLS NOT DISTINCT` — see the migration; TypeORM's `@Index`
 * decorator below cannot express that clause itself, but `synchronize` is
 * never used against a real database in this app, only the migration's own
 * DDL is authoritative) — re-granting the same thing to the same person is
 * a harmless no-op, not a new row.
 */
@Entity('review_assignments')
@Index(
  'UQ_review_assignments_user_campaign_field_value',
  ['userId', 'campaignId', 'groupField', 'groupValue'],
  { unique: true },
)
export class ReviewAssignment extends BaseEntity {
  @Column('uuid', { name: 'user_id' })
  @Index()
  @ApiProperty({ description: 'Người được gán (users.id, không FK)' })
  userId: string;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Đợt chụp được gán (campaigns.id, không FK)' })
  campaignId: string;

  @Column('varchar', { length: 20, name: 'group_field', nullable: true })
  @ApiPropertyOptional({
    description:
      'Trường nhóm — bỏ trống (cùng groupValue) nghĩa là cả đợt chụp',
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
    nullable: true,
  })
  groupField?: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number] | null;

  @Column('varchar', { length: 255, name: 'group_value', nullable: true })
  @ApiPropertyOptional({
    description: 'Giá trị của trường nhóm, vd "Khoa CNTT" — null nếu cả đợt',
    nullable: true,
  })
  groupValue?: string | null;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  @ApiPropertyOptional({ description: 'Người tạo gán (audit, không FK)' })
  createdByUserId?: string | null;
}
