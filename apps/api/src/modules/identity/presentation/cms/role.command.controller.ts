import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../guards/require-permission.decorator';
import { CreateRoleCommand } from '../../application/commands/command/create-role.command';
import { RenameRoleCommand } from '../../application/commands/command/rename-role.command';
import { SetRolePermissionsCommand } from '../../application/commands/command/set-role-permissions.command';
import { DeleteRoleCommand } from '../../application/commands/command/delete-role.command';
import { CreateRoleDto } from '../../application/commands/transfer-model/create-role.dto';
import { UpdateRoleDto } from '../../application/commands/transfer-model/update-role.dto';
import { SetRolePermissionsDto } from '../../application/commands/transfer-model/set-role-permissions.dto';
import { RoleResult } from '../../application/commands/result/role.result';

/**
 * CMS-only write surface for `roles` — cms-8-screens-api-plan.md §2.8.
 * Every handler only calls `CommandBus.execute()` (plan §1 translation
 * table: "Controller chỉ được gọi bus") — no service, no repository, no
 * business logic here.
 */
@Controller({ path: 'roles', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class RoleCommandController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission('role:write', 'Tạo vai trò')
  @ApiOperation({ summary: 'Tạo vai trò mới' })
  @ApiResponseDecorator(RoleResult, { status: 201 })
  create(@Body() dto: CreateRoleDto): Promise<RoleResult> {
    return this.commandBus.execute(
      new CreateRoleCommand(dto.code, dto.name, dto.description),
    );
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission('role:write', 'Sửa vai trò')
  @ApiOperation({ summary: 'Sửa tên/mô tả vai trò' })
  @ApiResponseDecorator(RoleResult)
  rename(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResult> {
    return this.commandBus.execute(
      new RenameRoleCommand(id, dto.name, dto.description),
    );
  }

  @Put(':id/permissions')
  @UseGuards(PermissionsGuard)
  @RequirePermission('role:write', 'Gán quyền cho vai trò')
  @ApiOperation({ summary: 'Thay toàn bộ danh sách quyền của vai trò' })
  @ApiResponseDecorator(RoleResult)
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ): Promise<RoleResult> {
    return this.commandBus.execute(
      new SetRolePermissionsCommand(id, dto.permissionCodes),
    );
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission('role:delete', 'Xóa vai trò')
  @ApiOperation({ summary: 'Xóa vai trò (không xóa được vai trò hệ thống)' })
  delete(@Param('id') id: string): Promise<{ id: string }> {
    return this.commandBus.execute(new DeleteRoleCommand(id));
  }
}
