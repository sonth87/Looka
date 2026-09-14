import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  EligibilityCatalogService,
  TestLookupResult,
} from '../../eligibility-catalog.service';
import { TestEligibilityLookupCommand } from '../command/test-eligibility-lookup.command';

/** Plain `ICommandHandler` — calls an external API, no DB write, so no `UnitOfWork` (same reasoning `sync-users.handler.ts` documents). */
@CommandHandler(TestEligibilityLookupCommand)
export class TestEligibilityLookupHandler implements ICommandHandler<
  TestEligibilityLookupCommand,
  TestLookupResult
> {
  constructor(private readonly catalog: EligibilityCatalogService) {}

  execute(command: TestEligibilityLookupCommand): Promise<TestLookupResult> {
    return this.catalog.testLookup(command.clientCode, command.key);
  }
}
