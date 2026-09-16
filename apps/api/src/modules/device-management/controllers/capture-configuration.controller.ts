import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { Pagination } from '@app/shared/http/pagination';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaptureConfigurationDao } from '../dao';
import {
  CreateCaptureConfigurationDto,
  ListCaptureConfigurationsQueryDto,
  UpdateCaptureConfigurationDto,
} from '../dto';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { CaptureConfigurationService } from '../services/capture-configuration.service';

/**
 * "Capture Configuration" (item 10) — CMS-only reusable capture template
 * management, same admin gating as `CaptureAnglePresetController`. See
 * `CaptureConfiguration`'s own doc comment for what this resource is (a
 * one-time-copy preset for `CampaignForm.tsx`, never a live link).
 *
 * **Deprecated 2026-09-14** (cms-8-screens-api-plan.md §2.2/P2, §9.1 rule
 * 5): superseded by `modules/workflow` (`/v1/workflows` — immutable
 * versions, a live campaign reference instead of a one-time copy, plus
 * identification/eligibility/AI/printing config this table never had).
 * Every existing `capture_configurations` row was migrated into a
 * matching `workflows`/`workflow_versions` row by migration
 * `1814000000000-CampaignWorkflowRef.ts`. Every route here stays fully
 * functional for one phase (`Deprecation: true` response header, RFC
 * 8594) — the CMS has not switched to `/v1/workflows` yet — then this
 * whole controller/table is removed once it has.
 */
@Controller({ path: 'capture-configurations', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard, AdminRoleGuard)
@ApiBearerAuth('sso')
export class CaptureConfigurationController {
  constructor(private readonly configService: CaptureConfigurationService) {}

  /**
   * Same §9.1 backward-compat rule 6 as `CampaignController.listCampaigns`
   * — plain array (legacy) when `page` is omitted (the `CampaignForm.tsx`
   * picker), paginated+searchable `{items, meta}` once a caller opts in by
   * passing `page` (`CaptureConfigurationsPage.tsx`'s own management list).
   */
  @Get()
  @Header('Deprecation', 'true')
  @ApiOperation({
    summary:
      'List capture configurations — plain array if `page` is omitted (legacy), paginated+searchable otherwise',
    deprecated: true,
  })
  @ApiResponseArrayDecorator(CaptureConfigurationDao)
  listCaptureConfigurations(
    @Query() query: ListCaptureConfigurationsQueryDto,
  ): Promise<CaptureConfigurationDao[] | Pagination<CaptureConfigurationDao>> {
    if (query.page === undefined) {
      return this.configService.listCaptureConfigurations();
    }
    return this.configService.listCaptureConfigurationsPaginated(query);
  }

  @Get(':id')
  @Header('Deprecation', 'true')
  @ApiOperation({ summary: 'Get one capture configuration', deprecated: true })
  @ApiResponseDecorator(CaptureConfigurationDao)
  getCaptureConfiguration(
    @Param('id') id: string,
  ): Promise<CaptureConfigurationDao> {
    return this.configService.findCaptureConfigOrFail(id);
  }

  @Post()
  @Header('Deprecation', 'true')
  @ApiOperation({ summary: 'Create a capture configuration', deprecated: true })
  @ApiResponseDecorator(CaptureConfigurationDao, { status: 201 })
  createCaptureConfiguration(
    @Body() dto: CreateCaptureConfigurationDto,
  ): Promise<CaptureConfigurationDao> {
    return this.configService.createCaptureConfiguration(dto);
  }

  @Patch(':id')
  @Header('Deprecation', 'true')
  @ApiOperation({ summary: 'Edit a capture configuration', deprecated: true })
  @ApiResponseDecorator(CaptureConfigurationDao)
  updateCaptureConfiguration(
    @Param('id') id: string,
    @Body() dto: UpdateCaptureConfigurationDto,
  ): Promise<CaptureConfigurationDao> {
    return this.configService.updateCaptureConfiguration(id, dto);
  }

  /**
   * Hard delete — see `CaptureConfigurationService.deleteCaptureConfiguration`'s
   * own doc comment for why this table needs no "still in use" guard the
   * way `DELETE /v1/campaigns/:id` does.
   */
  @Delete(':id')
  @Header('Deprecation', 'true')
  @ApiOperation({ summary: 'Delete a capture configuration', deprecated: true })
  async deleteCaptureConfiguration(
    @Param('id') id: string,
  ): Promise<{ id: string }> {
    await this.configService.deleteCaptureConfiguration(id);
    return { id };
  }
}
