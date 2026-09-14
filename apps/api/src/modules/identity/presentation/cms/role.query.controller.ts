import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { Pagination } from '@app/shared/http/pagination';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../guards/require-permission.decorator';
import { ListRolesQuery } from '../../application/queries/query/list-roles.query';
import { GetRoleQuery } from '../../application/queries/query/get-role.query';
import { ListRoleUsersQuery } from '../../application/queries/query/list-role-users.query';
import { RoleReadModel } from '../../application/queries/read-model/role.read-model';
import { UserReadModel } from '../../application/queries/read-model/user.read-model';

@Controller({ path: 'roles', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('role:read', 'Xem danh sách vai trò')
@ApiBearerAuth('sso')
export class RoleQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách vai trò kèm số quyền và số người dùng' })
  @ApiResponseArrayDecorator(RoleReadModel)
  list(): Promise<RoleReadModel[]> {
    return this.queryBus.execute(new ListRolesQuery());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết một vai trò' })
  @ApiResponseDecorator(RoleReadModel)
  getOne(@Param('id') id: string): Promise<RoleReadModel> {
    return this.queryBus.execute(new GetRoleQuery(id));
  }

  @Get(':id/users')
  @ApiOperation({ summary: 'Danh sách người dùng đang có vai trò này' })
  @ApiResponsePaginatedDecorator(UserReadModel)
  listUsers(
    @Param('id') id: string,
    @Query() query: QueryPaginateDto,
  ): Promise<Pagination<UserReadModel>> {
    return this.queryBus.execute(
      new ListRoleUsersQuery(id, query.page ?? 1, query.limit ?? 10),
    );
  }
}
