import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/common/decorators';
import { SsoAuthGuard } from '@app/common/guards';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CaptureConfigurationDao } from '../dao';
import {
  CreateCaptureConfigurationDto,
  UpdateCaptureConfigurationDto,
} from '../dto';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { CaptureConfigurationService } from '../services/capture-configuration.service';

/**
 * "Capture Configuration" (item 10) — CMS-only reusable capture template
 * management, same admin gating as `CaptureAnglePresetController`. See
 * `CaptureConfiguration`'s own doc comment for what this resource is (a
 * one-time-copy preset for `CampaignForm.tsx`, never a live link).
 */
@Controller({ path: 'capture-configurations', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard, AdminRoleGuard)
@ApiBearerAuth('sso')
export class CaptureConfigurationController {
  constructor(
    private readonly configService: CaptureConfigurationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List every capture configuration' })
  @ApiResponseArrayDecorator(CaptureConfigurationDao)
  listCaptureConfigurations(): Promise<CaptureConfigurationDao[]> {
    return this.configService.listCaptureConfigurations();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one capture configuration' })
  @ApiResponseDecorator(CaptureConfigurationDao)
  getCaptureConfiguration(
    @Param('id') id: string,
  ): Promise<CaptureConfigurationDao> {
    return this.configService.findCaptureConfigOrFail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a capture configuration' })
  @ApiResponseDecorator(CaptureConfigurationDao, { status: 201 })
  createCaptureConfiguration(
    @Body() dto: CreateCaptureConfigurationDto,
  ): Promise<CaptureConfigurationDao> {
    return this.configService.createCaptureConfiguration(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a capture configuration' })
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
  @ApiOperation({ summary: 'Delete a capture configuration' })
  async deleteCaptureConfiguration(
    @Param('id') id: string,
  ): Promise<{ id: string }> {
    await this.configService.deleteCaptureConfiguration(id);
    return { id };
  }
}
