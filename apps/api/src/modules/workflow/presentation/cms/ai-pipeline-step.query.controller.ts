import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { ListAiPipelineStepsQuery } from '../../application/queries/query/list-ai-pipeline-steps.query';
import { AiPipelineStepReadModel } from '../../application/queries/read-model/ai-pipeline-step.read-model';

class ListAiPipelineStepsQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

@Controller({ path: 'ai-pipeline-steps', version: '1' })
@ApiTags('workflow')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('ai-pipeline-step:read', 'Xem catalog bước AI')
@ApiBearerAuth('sso')
export class AiPipelineStepQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({
    summary: 'Catalog các bước xử lý AI mà một nghiệp vụ có thể chọn',
  })
  @ApiResponseArrayDecorator(AiPipelineStepReadModel)
  list(
    @Query() query: ListAiPipelineStepsQueryDto,
  ): Promise<AiPipelineStepReadModel[]> {
    return this.queryBus.execute(
      new ListAiPipelineStepsQuery(query.includeInactive ?? false),
    );
  }
}
