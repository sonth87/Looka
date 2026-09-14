import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { EligibilityCatalogService } from '../../eligibility-catalog.service';
import { EligibilityApiClientReadModel } from '../read-model/eligibility-api-client.read-model';
import { ListEligibilityApiClientsQuery } from '../query/list-eligibility-api-clients.query';

@QueryHandler(ListEligibilityApiClientsQuery)
export class ListEligibilityApiClientsHandler implements IQueryHandler<
  ListEligibilityApiClientsQuery,
  EligibilityApiClientReadModel[]
> {
  constructor(private readonly catalog: EligibilityCatalogService) {}

  execute(): Promise<EligibilityApiClientReadModel[]> {
    return Promise.resolve(this.catalog.listClients());
  }
}
