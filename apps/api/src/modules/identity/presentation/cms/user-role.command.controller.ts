import { Body, Controller, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import type { Request } from 'express';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../guards/require-permission.decorator';
import { SetUserRolesCommand } from '../../application/commands/command/set-user-roles.command';
import { SetUserRolesDto } from '../../application/commands/transfer-model/set-user-roles.dto';
import { SetUserRolesResult } from '../../application/commands/result/set-user-roles.result';

@Controller({ path: 'users', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@ApiBearerAuth('sso')
export class UserRoleCommandController {
  constructor(private readonly commandBus: CommandBus) {}

  @Put(':id/roles')
  @RequirePermission('user:write', 'Gán vai trò cho người dùng')
  @ApiOperation({ summary: 'Thay toàn bộ vai trò của một người dùng' })
  @ApiResponseDecorator(SetUserRolesResult)
  setRoles(
    @Param('id') userId: string,
    @Body() dto: SetUserRolesDto,
    @Req() req: Request,
  ): Promise<SetUserRolesResult> {
    return this.commandBus.execute(
      new SetUserRolesCommand(userId, dto.roleIds, req.user?.id ?? null),
    );
  }
}
