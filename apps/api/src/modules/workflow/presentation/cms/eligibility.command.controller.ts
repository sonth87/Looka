import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { TestEligibilityLookupCommand } from '../../application/commands/command/test-eligibility-lookup.command';
import { TestEligibilityLookupDto } from '../../application/commands/transfer-model/test-eligibility-lookup.dto';
import { TestLookupResult } from '../../application/eligibility-catalog.service';

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
      'Thử tra cứu một mã qua API ngoài — để tác giả nghiệp vụ xem field thật trước khi cấu hình rule',
  })
  @ApiResponseDecorator(Object)
  testLookup(@Body() dto: TestEligibilityLookupDto): Promise<TestLookupResult> {
    return this.commandBus.execute(
      new TestEligibilityLookupCommand(dto.clientCode, dto.key),
    );
  }
}
