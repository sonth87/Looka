import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import { ListEligibilityApiClientsQuery } from '../../application/queries/query/list-eligibility-api-clients.query';
import { EligibilityApiClientReadModel } from '../../application/queries/read-model/eligibility-api-client.read-model';

@Controller({ path: 'eligibility', version: '1' })
@ApiTags('workflow')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('workflow:read', 'Xem client điều kiện tiếp nhận')
@ApiBearerAuth('sso')
export class EligibilityQueryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('api-clients')
  @ApiOperation({
    summary:
      'Danh sách API ngoài có thể dùng cho điều kiện tiếp nhận, kèm field có sẵn',
  })
  @ApiResponseArrayDecorator(EligibilityApiClientReadModel)
  listClients(): Promise<EligibilityApiClientReadModel[]> {
    return this.queryBus.execute(new ListEligibilityApiClientsQuery());
  }
}
