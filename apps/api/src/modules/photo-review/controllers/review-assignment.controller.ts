import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReviewAssignmentDao } from '../dao';
import {
  CreateReviewAssignmentDto,
  GroupValuesQueryDto,
  ListReviewAssignmentsQueryDto,
} from '../dto';
import { ReviewerRoleGuard } from '../guards/reviewer-role.guard';
import { ReviewAssignmentService } from '../services/review-assignment.service';

/**
 * `GET/POST /v1/review/assignments`, `DELETE .../:id`,
 * `GET .../group-values` — plan §5.2, feature 13. ADMIN only for
 * write/list-by-any-user, checked inline (`req.user?.isAdmin`) rather than
 * a dedicated guard for a handful of routes — same precedent as
 * `ReviewController.exportApproved`. A non-admin reviewer may still list
 * (read-only) their OWN assignments (`userId` forced to `req.user.id`,
 * ignoring any `userId` query param) so the CMS can show "bạn đang được
 * phân công duyệt: ..." without needing admin rights.
 */
@Controller({ path: 'review/assignments', version: '1' })
@ApiTags('photo-review')
@UseGuards(SsoAuthGuard, ReviewerRoleGuard)
@ApiBearerAuth('sso')
export class ReviewAssignmentController {
  constructor(private readonly assignmentService: ReviewAssignmentService) {}

  @Get()
  @ApiOperation({
    summary:
      'List review assignments — admin sees all/filtered, others only their own (plan §5.2)',
  })
  list(
    @Query() query: ListReviewAssignmentsQueryDto,
    @Req() req: Request,
  ): Promise<ReviewAssignmentDao[]> {
    const userId = req.user?.isAdmin
      ? query.userId
      : (req.user?.id ?? undefined);
    return this.assignmentService.list(userId);
  }

  @Get('group-values')
  @ApiOperation({
    summary:
      'Distinct className/faculty/major values across all sets, for the assignment picker (plan §5.2). ADMIN only.',
  })
  groupValues(
    @Query() query: GroupValuesQueryDto,
    @Req() req: Request,
  ): Promise<string[]> {
    // Global (no campaignId filter) across every set — only feeds the
    // admin-only `create` picker below, so it must not be open to a
    // non-admin reviewer (who is otherwise scope-restricted everywhere
    // else, e.g. `PhotoReviewService.listSets`/`getSetDetail`).
    if (!req.user?.isAdmin) throw new ForbiddenException('Requires admin');
    return this.assignmentService.groupValues(query.field);
  }

  @Post()
  @ApiOperation({ summary: 'Grant a review assignment. ADMIN only.' })
  create(
    @Body() dto: CreateReviewAssignmentDto,
    @Req() req: Request,
  ): Promise<ReviewAssignmentDao> {
    if (!req.user?.isAdmin) throw new ForbiddenException('Requires admin');
    return this.assignmentService.create(dto, req.user?.id ?? null);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a review assignment. ADMIN only.' })
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    if (!req.user?.isAdmin) throw new ForbiddenException('Requires admin');
    await this.assignmentService.remove(id);
  }
}
