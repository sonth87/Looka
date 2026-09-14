import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  ApiResponsePaginatedDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { Pagination } from '@app/shared/http/pagination';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../guards/require-permission.decorator';
import { ListUsersQueryDto } from '../../application/queries/filter-model/list-users-query.dto';
import { ListUsersQuery } from '../../application/queries/query/list-users.query';
import { GetUserQuery } from '../../application/queries/query/get-user.query';
import { GetUserSyncStatusQuery } from '../../application/queries/query/get-user-sync-status.query';
import { UserReadModel } from '../../application/queries/read-model/user.read-model';
import { UserDirectorySyncStatus } from '../../application/user-directory-sync.service';

@Controller({ path: 'users', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('user:read', 'Xem danh sách người dùng')
@ApiBearerAuth('sso')
export class UserQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({
    summary:
      'Danh sách người dùng, lọc theo email/tên/mã/SĐT, vai trò, trạng thái, nguồn',
  })
  @ApiResponsePaginatedDecorator(UserReadModel)
  list(@Query() query: ListUsersQueryDto): Promise<Pagination<UserReadModel>> {
    return this.queryBus.execute(
      new ListUsersQuery({
        q: query.q,
        roleCode: query.roleCode,
        status: query.status,
        source: query.source,
        page: query.page ?? 1,
        limit: query.limit ?? 10,
      }),
    );
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Trạng thái lần đồng bộ danh bạ cán bộ gần nhất' })
  @ApiResponseDecorator(Object)
  syncStatus(): Promise<UserDirectorySyncStatus> {
    return this.queryBus.execute(new GetUserSyncStatusQuery());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết một người dùng, kèm mã vai trò' })
  @ApiResponseDecorator(UserReadModel)
  getOne(@Param('id') id: string): Promise<UserReadModel> {
    return this.queryBus.execute(new GetUserQuery(id));
  }
}
