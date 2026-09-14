import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { Pagination } from '@app/shared/http/pagination';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { ListWorkflowsQuery } from '../../application/queries/query/list-workflows.query';
import { GetWorkflowQuery } from '../../application/queries/query/get-workflow.query';
import { ListWorkflowVersionsQuery } from '../../application/queries/query/list-workflow-versions.query';
import { GetWorkflowUsageQuery } from '../../application/queries/query/get-workflow-usage.query';
import { ValidateWorkflowConfigQuery } from '../../application/queries/query/validate-workflow-config.query';
import { ListWorkflowsQueryDto } from '../../application/queries/filter-model/list-workflows-query.dto';
import {
  WorkflowReadModel,
  WorkflowUsageReadModel,
  WorkflowVersionSummary,
} from '../../application/queries/read-model/workflow.read-model';
import { WorkflowConfigCheckResult } from '../../application/validate-workflow-config';

@Controller({ path: 'workflows', version: '1' })
@ApiTags('workflow')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('workflow:read', 'Xem nghiệp vụ')
@ApiBearerAuth('sso')
export class WorkflowQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách nghiệp vụ, lọc theo trạng thái/tên/mã' })
  @ApiResponsePaginatedDecorator(WorkflowReadModel)
  list(
    @Query() query: ListWorkflowsQueryDto,
  ): Promise<Pagination<WorkflowReadModel>> {
    return this.queryBus.execute(
      new ListWorkflowsQuery({
        status: query.status,
        q: query.q,
        page: query.page ?? 1,
        limit: query.limit ?? 10,
      }),
    );
  }

  // No route-shadowing risk here (unlike campaign.controller.ts's own
  // `stats/summary` note): this is `POST`, `getOne` below is `GET` — Nest
  // matches on method+path together, so the two can never collide
  // regardless of declaration order. Kept next to `list()` anyway since
  // it reads naturally as "the other no-:id route".
  @Post('validate')
  @ApiOperation({
    summary: 'Kiểm tra cấu hình theo schema, không lưu (dry-run)',
  })
  @ApiResponseDecorator(Object)
  validate(@Body() config: unknown): Promise<WorkflowConfigCheckResult> {
    return this.queryBus.execute(new ValidateWorkflowConfigQuery(config));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết một nghiệp vụ, kèm cấu hình version hiện tại',
  })
  @ApiResponseDecorator(WorkflowReadModel)
  getOne(@Param('id') id: string): Promise<WorkflowReadModel> {
    return this.queryBus.execute(new GetWorkflowQuery(id));
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Danh sách version của một nghiệp vụ' })
  @ApiResponseArrayDecorator(WorkflowVersionSummary)
  listVersions(@Param('id') id: string): Promise<WorkflowVersionSummary[]> {
    return this.queryBus.execute(new ListWorkflowVersionsQuery(id));
  }

  @Get(':id/usage')
  @ApiOperation({
    summary: 'Đợt chụp nào đang dùng nghiệp vụ này, version nào',
  })
  @ApiResponseArrayDecorator(WorkflowUsageReadModel)
  usage(@Param('id') id: string): Promise<WorkflowUsageReadModel[]> {
    return this.queryBus.execute(new GetWorkflowUsageQuery(id));
  }
}
