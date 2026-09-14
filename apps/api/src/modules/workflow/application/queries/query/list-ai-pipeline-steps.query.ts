import { IQuery } from '@nestjs/cqrs';

export class ListAiPipelineStepsQuery implements IQuery {
  constructor(public readonly includeInactive: boolean) {}
}
