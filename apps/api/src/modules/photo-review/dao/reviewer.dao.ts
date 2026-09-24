import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/** A user with unrestricted REVIEWER access (`users.roles @> '["REVIEWER"]'`) — see `ReviewAssignmentService.listReviewers`'s own doc comment. */
export class ReviewerDao {
  @ApiProperty()
  @Expose()
  userId: string;

  @ApiPropertyOptional({
    description: 'Tên/email người được cấp, nếu tra được',
  })
  @Expose()
  userName?: string;

  @ApiPropertyOptional() @Expose() userEmail?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Phòng ban' })
  @Expose()
  userDepartment?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Khoa' })
  @Expose()
  userFaculty?: string | null;
  @ApiProperty({
    type: [String],
    description: 'Mã vai trò RBAC (roles.code) của người này',
  })
  @Expose()
  userRoleCodes: string[];
}
