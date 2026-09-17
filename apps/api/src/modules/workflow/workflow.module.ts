import { Module, OnModuleInit } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '@app/modules/identity/identity.module';
import { ConstraintErrorTranslator } from '@app/shared/database/constraint-error.translator';
import { ErrorCodeRegistry } from '@app/shared/errors/error-code.registry';
import { ConflictException } from '@app/shared/errors/application.exception';
import { WorkflowEntity } from './infrastructure/persistence/workflow.entity';
import { WorkflowVersionEntity } from './infrastructure/persistence/workflow-version.entity';
import { AiPipelineStepEntity } from './infrastructure/persistence/ai-pipeline-step.entity';
import { WORKFLOW_REPOSITORY } from './infrastructure/repositories/workflow.repository.interface';
import { WorkflowRepository } from './infrastructure/repositories/workflow.repository';
import { WORKFLOW_VERSION_REPOSITORY } from './infrastructure/repositories/workflow-version.repository.interface';
import { WorkflowVersionRepository } from './infrastructure/repositories/workflow-version.repository';
import { AI_PIPELINE_STEP_REPOSITORY } from './infrastructure/repositories/ai-pipeline-step.repository.interface';
import { AiPipelineStepRepository } from './infrastructure/repositories/ai-pipeline-step.repository';
import { WorkflowCatalogReadRepository } from './infrastructure/read/workflow-catalog.read-repository';
import { AiPipelineStepReadRepository } from './infrastructure/read/ai-pipeline-step.read-repository';
import { EligibilityHttpClient } from './infrastructure/integrations/eligibility-http.client';
import { CreateWorkflowHandler } from './application/commands/handler/create-workflow.handler';
import { RenameWorkflowHandler } from './application/commands/handler/rename-workflow.handler';
import { UpdateWorkflowVersionConfigHandler } from './application/commands/handler/update-workflow-version-config.handler';
import { PublishWorkflowHandler } from './application/commands/handler/publish-workflow.handler';
import { CreateWorkflowDraftVersionHandler } from './application/commands/handler/create-workflow-draft-version.handler';
import { ArchiveWorkflowHandler } from './application/commands/handler/archive-workflow.handler';
import { DeleteWorkflowHandler } from './application/commands/handler/delete-workflow.handler';
import { CreateAiPipelineStepHandler } from './application/commands/handler/create-ai-pipeline-step.handler';
import { UpdateAiPipelineStepHandler } from './application/commands/handler/update-ai-pipeline-step.handler';
import { TestEligibilityLookupHandler } from './application/commands/handler/test-eligibility-lookup.handler';
import { ListWorkflowsHandler } from './application/queries/handler/list-workflows.handler';
import { GetWorkflowHandler } from './application/queries/handler/get-workflow.handler';
import { ListWorkflowVersionsHandler } from './application/queries/handler/list-workflow-versions.handler';
import { GetWorkflowUsageHandler } from './application/queries/handler/get-workflow-usage.handler';
import { ValidateWorkflowConfigHandler } from './application/queries/handler/validate-workflow-config.handler';
import { ListAiPipelineStepsHandler } from './application/queries/handler/list-ai-pipeline-steps.handler';
import { WorkflowCommandController } from './presentation/cms/workflow.command.controller';
import { WorkflowQueryController } from './presentation/cms/workflow.query.controller';
import { AiPipelineStepCommandController } from './presentation/cms/ai-pipeline-step.command.controller';
import { AiPipelineStepQueryController } from './presentation/cms/ai-pipeline-step.query.controller';
import { EligibilityCommandController } from './presentation/cms/eligibility.command.controller';
import {
  WORKFLOW_CONSTRAINTS,
  WORKFLOW_ERROR_CODES,
} from './workflow.error-codes';

const COMMAND_HANDLERS = [
  CreateWorkflowHandler,
  RenameWorkflowHandler,
  UpdateWorkflowVersionConfigHandler,
  PublishWorkflowHandler,
  CreateWorkflowDraftVersionHandler,
  ArchiveWorkflowHandler,
  DeleteWorkflowHandler,
  CreateAiPipelineStepHandler,
  UpdateAiPipelineStepHandler,
  TestEligibilityLookupHandler,
];

const QUERY_HANDLERS = [
  ListWorkflowsHandler,
  GetWorkflowHandler,
  ListWorkflowVersionsHandler,
  GetWorkflowUsageHandler,
  ValidateWorkflowConfigHandler,
  ListAiPipelineStepsHandler,
];

/**
 * "Nghiệp vụ" — cms-8-screens-api-plan.md §2.2/P2, second module built
 * under the target structure (after `modules/identity` in P1). Imports
 * `IdentityModule` for `PermissionsGuard`/`RequirePermission` (same
 * one-directional dependency `DeviceManagementModule` already
 * establishes — `identity` never imports back). `device-management`
 * imports THIS module in turn (P2's "gộp config cho devices/config và
 * campaigns/:id/config"), so the dependency chain is
 * `device-management → workflow → identity`, never circular.
 *
 * No more `eligibility_api_clients` catalog/repository here (2026-09-17
 * redo of plan item 7) — `EligibilityHttpClient` is still exported for
 * `device-management`'s `CampaignSubjectService` to execute a workflow's
 * OWN inline `config.eligibility.api`, but there is no longer a shared
 * catalog table for it to read from; see that class' own doc comment.
 */
@Module({
  imports: [
    CqrsModule,
    IdentityModule,
    TypeOrmModule.forFeature([
      WorkflowEntity,
      WorkflowVersionEntity,
      AiPipelineStepEntity,
    ]),
  ],
  controllers: [
    WorkflowCommandController,
    WorkflowQueryController,
    AiPipelineStepCommandController,
    AiPipelineStepQueryController,
    EligibilityCommandController,
  ],
  providers: [
    { provide: WORKFLOW_REPOSITORY, useClass: WorkflowRepository },
    {
      provide: WORKFLOW_VERSION_REPOSITORY,
      useClass: WorkflowVersionRepository,
    },
    {
      provide: AI_PIPELINE_STEP_REPOSITORY,
      useClass: AiPipelineStepRepository,
    },
    WorkflowCatalogReadRepository,
    AiPipelineStepReadRepository,
    EligibilityHttpClient,
    ...COMMAND_HANDLERS,
    ...QUERY_HANDLERS,
  ],
  // `WorkflowCatalogReadRepository` is exported so `device-management` can
  // resolve a campaign's pinned workflow version's config — see
  // `campaign.service.ts`'s `toCampaignResponse()`. Same export-the-
  // transitive-dependency lesson `identity.module.ts` documents: a module
  // consuming this via `@UseGuards`-style raw injection would need it
  // exported too, but `device-management` injects it as a normal
  // constructor dependency (through `WorkflowModule` import), which only
  // needs the export, not anything extra.
  //
  // `EligibilityHttpClient` exported for the same reason (plan item 7,
  // 2026-09-17): `CampaignSubjectService.lookupSubject` (device-management)
  // reads a workflow's pinned version's own `eligibility.api` config
  // (already has it via `WorkflowCatalogReadRepository`) and executes the
  // lookup directly — no separate catalog lookup needed anymore.
  exports: [WorkflowCatalogReadRepository, EligibilityHttpClient],
})
export class WorkflowModule implements OnModuleInit {
  constructor(
    private readonly errorCodes: ErrorCodeRegistry,
    private readonly constraintTranslator: ConstraintErrorTranslator,
  ) {}

  onModuleInit(): void {
    this.errorCodes.register('workflow', WORKFLOW_ERROR_CODES);
    this.constraintTranslator.register(
      WORKFLOW_CONSTRAINTS.WORKFLOW_CODE_UNIQUE,
      () =>
        new ConflictException(
          WORKFLOW_ERROR_CODES.WORKFLOW_CODE_TAKEN,
          'Mã nghiệp vụ đã tồn tại.',
        ),
    );
    this.constraintTranslator.register(
      WORKFLOW_CONSTRAINTS.AI_STEP_CODE_UNIQUE,
      () =>
        new ConflictException(
          WORKFLOW_ERROR_CODES.AI_STEP_CODE_TAKEN,
          'Mã bước AI đã tồn tại.',
        ),
    );
  }
}
