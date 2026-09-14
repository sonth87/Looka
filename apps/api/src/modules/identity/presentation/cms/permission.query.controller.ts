import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../guards/require-permission.decorator';
import { ListPermissionsQuery } from '../../application/queries/query/list-permissions.query';
import { PermissionReadModel } from '../../application/queries/read-model/permission.read-model';

/**
 * "Danh sách các quyền được truy cập vào các đầu API" —
 * cms-8-screens-api-plan.md §2.8, màn Người dùng & phân quyền. Rows come
 * from `PermissionCatalogService` at boot, never hand-typed.
 */
@Controller({ path: 'permissions', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('permission:read', 'Xem catalog quyền')
@ApiBearerAuth('sso')
export class PermissionQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({
    summary: 'Catalog toàn bộ quyền phát hiện được từ @RequirePermission',
  })
  @ApiResponseArrayDecorator(PermissionReadModel)
  list(): Promise<PermissionReadModel[]> {
    return this.queryBus.execute(new ListPermissionsQuery());
  }
}
