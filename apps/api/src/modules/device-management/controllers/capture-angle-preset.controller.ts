import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { Pagination } from '@app/shared/http/pagination';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaptureAnglePresetDao } from '../dao';
import {
  CreateCaptureAnglePresetDto,
  ListCaptureAnglePresetsQueryDto,
  UpdateCaptureAnglePresetDto,
} from '../dto';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { CaptureAnglePresetService } from '../services/capture-angle-preset.service';

/**
 * The dynamic capture-angle catalog (§3.1.6) — CMS-only, every route needs
 * `users.is_admin`. See `AdminRoleGuard`'s own doc comment for why it is
 * always stacked after `SsoAuthGuard`, never used alone.
 */
@Controller({ path: 'capture-angle-presets', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard, AdminRoleGuard)
@ApiBearerAuth('sso')
export class CaptureAnglePresetController {
  constructor(private readonly presetService: CaptureAnglePresetService) {}

  /**
   * Same §9.1 backward-compat rule 6 as `CampaignController.listCampaigns`:
   * plain array (legacy) when `page` is omitted — e.g. `CaptureAnglesTable`'s
   * picker, which needs every preset in one call — paginated+searchable
   * `{items, meta}` once a caller opts in by passing `page` (the CMS's own
   * "Góc chụp" management list).
   */
  @Get()
  @ApiOperation({
    summary:
      'List capture angle presets — plain array if `page` is omitted (legacy), paginated+searchable otherwise',
  })
  @ApiResponseArrayDecorator(CaptureAnglePresetDao)
  listPresets(
    @Query() query: ListCaptureAnglePresetsQueryDto,
  ): Promise<CaptureAnglePresetDao[] | Pagination<CaptureAnglePresetDao>> {
    if (query.page === undefined) {
      return this.presetService.listPresets(query.includeInactive ?? false);
    }
    return this.presetService.listPresetsPaginated(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a capture angle preset (always isSystem: false)',
  })
  @ApiResponseDecorator(CaptureAnglePresetDao, { status: 201 })
  createPreset(
    @Body() dto: CreateCaptureAnglePresetDto,
  ): Promise<CaptureAnglePresetDao> {
    return this.presetService.createPreset(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a preset (label/instruction/pose/active/sortOrder) — code is immutable, "delete" is active=false',
  })
  @ApiResponseDecorator(CaptureAnglePresetDao)
  updatePreset(
    @Param('id') id: string,
    @Body() dto: UpdateCaptureAnglePresetDto,
  ): Promise<CaptureAnglePresetDao> {
    return this.presetService.updatePreset(id, dto);
  }
}
