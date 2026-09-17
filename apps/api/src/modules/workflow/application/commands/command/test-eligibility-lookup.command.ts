import { ICommand } from '@nestjs/cqrs';
import { TestEligibilityLookupDto } from '../transfer-model/test-eligibility-lookup.dto';

export class TestEligibilityLookupCommand implements ICommand {
  constructor(public readonly dto: TestEligibilityLookupDto) {}
}
