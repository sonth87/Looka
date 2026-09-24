import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Body of `POST /v1/review/reviewers` — grants unrestricted REVIEWER access (2026-09-22 product ask, replaces the old scoped-assignment-only "Thêm phân công" flow for new grants). */
export class GrantReviewerDto {
  @ApiProperty({ description: 'Người được cấp quyền duyệt (users.id)' })
  @IsUUID()
  userId: string;
}
