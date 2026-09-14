import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { CreateAiPipelineStepCommand } from '../../application/commands/command/create-ai-pipeline-step.command';
import { UpdateAiPipelineStepCommand } from '../../application/commands/command/update-ai-pipeline-step.command';
import { CreateAiPipelineStepDto } from '../../application/commands/transfer-model/create-ai-pipeline-step.dto';
import { UpdateAiPipelineStepDto } from '../../application/commands/transfer-model/update-ai-pipeline-step.dto';

@Controller({ path: 'ai-pipeline-steps', version: '1' })
@ApiTags('workflow')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('ai-pipeline-step:write', 'Quản lý bước AI')
@ApiBearerAuth('sso')
export class AiPipelineStepCommandController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  @ApiOperation({ summary: 'Thêm bước xử lý AI mới vào catalog' })
  @ApiResponseDecorator(Object, { status: 201 })
  create(@Body() dto: CreateAiPipelineStepDto): Promise<{ id: string }> {
    return this.commandBus.execute(new CreateAiPipelineStepCommand(dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa bước xử lý AI (không đổi mã)' })
  @ApiResponseDecorator(Object)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAiPipelineStepDto,
  ): Promise<{ id: string }> {
    return this.commandBus.execute(new UpdateAiPipelineStepCommand(id, dto));
  }
}
