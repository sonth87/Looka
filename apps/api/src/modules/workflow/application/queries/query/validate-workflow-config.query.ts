import { IQuery } from '@nestjs/cqrs';

export class ValidateWorkflowConfigQuery implements IQuery {
  constructor(public readonly config: unknown) {}
}
