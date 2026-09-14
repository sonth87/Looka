import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import type { Request } from 'express';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { CreateWorkflowCommand } from '../../application/commands/command/create-workflow.command';
import { RenameWorkflowCommand } from '../../application/commands/command/rename-workflow.command';
import { UpdateWorkflowVersionConfigCommand } from '../../application/commands/command/update-workflow-version-config.command';
import { PublishWorkflowCommand } from '../../application/commands/command/publish-workflow.command';
import { CreateWorkflowDraftVersionCommand } from '../../application/commands/command/create-workflow-draft-version.command';
import { ArchiveWorkflowCommand } from '../../application/commands/command/archive-workflow.command';
import { DeleteWorkflowCommand } from '../../application/commands/command/delete-workflow.command';
import { CreateWorkflowDto } from '../../application/commands/transfer-model/create-workflow.dto';
import { UpdateWorkflowDto } from '../../application/commands/transfer-model/update-workflow.dto';
import { UpdateWorkflowVersionConfigDto } from '../../application/commands/transfer-model/update-workflow-version-config.dto';
import {
  WorkflowResult,
  WorkflowVersionResult,
} from '../../application/commands/result/workflow.result';

@Controller({ path: 'workflows', version: '1' })
@ApiTags('workflow')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@ApiBearerAuth('sso')
export class WorkflowCommandController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  @RequirePermission('workflow:write', 'Tạo nghiệp vụ')
  @ApiOperation({ summary: 'Tạo nghiệp vụ mới — DRAFT, version 1 nháp' })
  @ApiResponseDecorator(WorkflowResult, { status: 201 })
  create(
    @Body() dto: CreateWorkflowDto,
    @Req() req: Request,
  ): Promise<WorkflowResult> {
    return this.commandBus.execute(
      new CreateWorkflowCommand(
        dto.code,
        dto.name,
        dto.description,
        dto.config,
        req.user?.id ?? null,
      ),
    );
  }

  @Patch(':id')
  @RequirePermission('workflow:write', 'Sửa tên/mô tả nghiệp vụ')
  @ApiOperation({
    summary: 'Sửa tên/mô tả nghiệp vụ (không đổi mã, không đổi cấu hình)',
  })
  @ApiResponseDecorator(WorkflowResult)
  rename(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ): Promise<WorkflowResult> {
    return this.commandBus.execute(
      new RenameWorkflowCommand(id, dto.name, dto.description),
    );
  }

  @Put(':id/config')
  @RequirePermission('workflow:write', 'Sửa cấu hình nghiệp vụ')
  @ApiOperation({
    summary: 'Sửa cấu hình của version đang nháp (chỉ khi chưa publish)',
  })
  @ApiResponseDecorator(WorkflowVersionResult)
  updateConfig(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowVersionConfigDto,
  ): Promise<WorkflowVersionResult> {
    return this.commandBus.execute(
      new UpdateWorkflowVersionConfigCommand(id, dto.config, dto.note),
    );
  }

  @Post(':id/publish')
  @RequirePermission('workflow:write', 'Publish nghiệp vụ')
  @ApiOperation({
    summary:
      'Publish version nháp hiện tại — đóng băng, campaign mới chọn được',
  })
  @ApiResponseDecorator(WorkflowResult)
  publish(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<WorkflowResult> {
    return this.commandBus.execute(
      new PublishWorkflowCommand(id, req.user?.id ?? null),
    );
  }

  @Post(':id/versions')
  @RequirePermission('workflow:write', 'Tạo version nháp mới')
  @ApiOperation({
    summary: 'Tạo version nháp mới (nhân bản từ version hiện tại) để sửa tiếp',
  })
  @ApiResponseDecorator(WorkflowVersionResult, { status: 201 })
  createDraftVersion(@Param('id') id: string): Promise<WorkflowVersionResult> {
    return this.commandBus.execute(new CreateWorkflowDraftVersionCommand(id));
  }

  @Post(':id/archive')
  @RequirePermission('workflow:write', 'Lưu trữ nghiệp vụ')
  @ApiOperation({
    summary:
      'Lưu trữ nghiệp vụ — campaign mới không chọn được, campaign cũ vẫn chạy',
  })
  @ApiResponseDecorator(WorkflowResult)
  archive(@Param('id') id: string): Promise<WorkflowResult> {
    return this.commandBus.execute(new ArchiveWorkflowCommand(id));
  }

  @Delete(':id')
  @RequirePermission('workflow:delete', 'Xóa nghiệp vụ')
  @ApiOperation({
    summary: 'Xóa nghiệp vụ — chỉ khi còn DRAFT và chưa đợt nào dùng',
  })
  delete(@Param('id') id: string): Promise<{ id: string }> {
    return this.commandBus.execute(new DeleteWorkflowCommand(id));
  }
}
