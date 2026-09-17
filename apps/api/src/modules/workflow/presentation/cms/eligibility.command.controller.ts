import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { TestEligibilityLookupCommand } from '../../application/commands/command/test-eligibility-lookup.command';
import { TestEligibilityLookupDto } from '../../application/commands/transfer-model/test-eligibility-lookup.dto';
import { TestLookupResult } from '../../application/commands/handler/test-eligibility-lookup.handler';

/**
 * `POST /v1/eligibility/test-lookup` only (2026-09-17 redo of plan item 7)
 * — the `api-clients` CRUD routes this controller briefly had are gone:
 * there is no more shared catalog to manage (see this module's own
 * `eligibility-http.client.ts` doc comment). A workflow's own eligibility
 * API config lives inline in `config.eligibility.api`, edited/saved through
 * the normal `PUT /v1/workflows/:id/config` path — this route only ever
 * TRIES an ad-hoc config, it never persists one.
 */
@Controller({ path: 'eligibility', version: '1' })
@ApiTags('workflow')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('workflow:read', 'Thử tra cứu điều kiện tiếp nhận')
@ApiBearerAuth('sso')
export class EligibilityCommandController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('test-lookup')
  @ApiOperation({
    summary:
      'Thử tra cứu một mã qua API ngoài (config gửi trực tiếp, không qua catalog) — để tác giả nghiệp vụ xem field thật trước khi lưu workflow',
  })
  @ApiResponseDecorator(Object)
  testLookup(@Body() dto: TestEligibilityLookupDto): Promise<TestLookupResult> {
    return this.commandBus.execute(new TestEligibilityLookupCommand(dto));
  }
}
