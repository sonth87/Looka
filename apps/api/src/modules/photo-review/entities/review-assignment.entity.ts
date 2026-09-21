import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

/**
 * "Ai được duyệt nhóm nào" (plan §5.2, feature 13) — a dynamic 3-column
 * grant: `(userId, groupField, groupValue)`, e.g. `(nguyễn A, 'faculty',
 * 'Khoa CNTT')`. `groupField` is one of `SubjectPhotoSet`'s own denormalized
 * roster columns (`className`/`faculty`/`major` — plan explicitly scopes
 * this to those 3, not full jsonb-discovered-field generality, since
 * `subject_photo_sets` has no `extra` jsonb of its own).
 *
 * Global, not per-campaign — matches the plan's own column list (no
 * `campaignId`). A user with ZERO rows here is UNRESTRICTED (sees/acts on
 * every set) — this table only ever narrows, never the sole gate; see
 * `ReviewAssignmentService.assertInScope`.
 *
 * `userId` deliberately has NO foreign key — this module's consistent
 * "never FK a user-id column" convention (see e.g. `PhotoVariant.
 * createdByUserId`).
 */
@Entity('review_assignments')
@Index(
  'UQ_review_assignments_user_field_value',
  ['userId', 'groupField', 'groupValue'],
  { unique: true },
)
export class ReviewAssignment extends BaseEntity {
  @Column('uuid', { name: 'user_id' })
  @Index()
  @ApiProperty({ description: 'Người được gán (users.id, không FK)' })
  userId: string;

  @Column('varchar', { length: 20, name: 'group_field' })
  @ApiProperty({
    description: 'Trường nhóm',
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
  })
  groupField: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number];

  @Column('varchar', { length: 255, name: 'group_value' })
  @ApiProperty({ description: 'Giá trị của trường nhóm, vd "Khoa CNTT"' })
  groupValue: string;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  @ApiPropertyOptional({ description: 'Người tạo gán (audit, không FK)' })
  createdByUserId?: string | null;
}
