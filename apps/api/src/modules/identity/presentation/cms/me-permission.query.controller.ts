import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import type { Request } from 'express';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { GetMePermissionsQuery } from '../../application/queries/query/get-me-permissions.query';
import { MePermissionsReadModel } from '../../application/queries/read-model/me-permissions.read-model';

/**
 * `GET /v1/me/permissions` — any authenticated caller may see their own
 * permission set (used by the CMS to show/hide nav items,
 * cms-8-screens-api-plan.md §2.8); no `@RequirePermission` here — this is
 * deliberately not gated the same way admin-facing routes are, mirroring
 * `MeController.getMe()`'s own "any authenticated person" stance
 * (device-management/controllers/me.controller.ts).
 */
@Controller({ path: 'me', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class MePermissionQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Quyền và vai trò của người dùng đang đăng nhập' })
  @ApiResponseDecorator(MePermissionsReadModel)
  getMine(@Req() req: Request): Promise<MePermissionsReadModel> {
    return this.queryBus.execute(
      new GetMePermissionsQuery(req.user!.id, req.user!.isAdmin),
    );
  }
}
