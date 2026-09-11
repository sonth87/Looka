import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
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

  @Get()
  @ApiOperation({
    summary:
      'List capture angle presets — active only by default, all with ?includeInactive=true',
  })
  @ApiResponseArrayDecorator(CaptureAnglePresetDao)
  listPresets(
    @Query() query: ListCaptureAnglePresetsQueryDto,
  ): Promise<CaptureAnglePresetDao[]> {
    return this.presetService.listPresets(query.includeInactive ?? false);
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
