import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
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
import { IdentificationMethodDao } from '../dao';
import {
  CreateIdentificationMethodDto,
  UpdateIdentificationMethodDto,
} from '../dto';
import { IdentificationMethodService } from '../services/identification-method.service';

/**
 * `identification_methods` catalog (plan §2.2/E1). Plain `GET` (no
 * permission beyond SSO, same as P3 left it) lists active-only, for any
 * authenticated caller (e.g. a workflow-config form); `?includeInactive=
 * true` is additive and left ungated too — method codes/names carry no PII
 * or business-sensitive content, same low-stakes-read reasoning
 * `GET /v1/permissions` (catalog, not data) already uses elsewhere. Only
 * the WRITE routes are gated, by `identification-method:write` (matches
 * every other catalog-write controller's permission-gating pattern, e.g.
 * `ai-pipeline-steps`).
 */
@Controller({ path: 'identification-methods', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class IdentificationMethodController {
  constructor(private readonly service: IdentificationMethodService) {}

  @Get()
  @ApiOperation({
    summary:
      'List identification methods (active only, unless ?includeInactive=true and caller has identification-method:write)',
  })
  @ApiResponseArrayDecorator(IdentificationMethodDao)
  list(
    @Query('includeInactive') includeInactive?: string,
  ): Promise<IdentificationMethodDao[]> {
    return includeInactive === 'true'
      ? this.service.listAll()
      : this.service.listActive();
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    'identification-method:write',
    'Thêm phương thức định danh',
  )
  @ApiOperation({ summary: 'Create an identification method' })
  @ApiResponseDecorator(IdentificationMethodDao, { status: 201 })
  create(
    @Body() dto: CreateIdentificationMethodDto,
  ): Promise<IdentificationMethodDao> {
    return this.service.createMethod(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission('identification-method:write', 'Sửa phương thức định danh')
  @ApiOperation({
    summary:
      'Update an identification method (retire via {active: false}, not delete)',
  })
  @ApiResponseDecorator(IdentificationMethodDao)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIdentificationMethodDto,
  ): Promise<IdentificationMethodDao> {
    return this.service.updateMethod(id, dto);
  }
}
