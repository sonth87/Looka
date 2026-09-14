import { Injectable } from '@nestjs/common';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { AiPipelineStepEntity } from '../persistence/ai-pipeline-step.entity';
import { IAiPipelineStepRepository } from './ai-pipeline-step.repository.interface';

@Injectable()
export class AiPipelineStepRepository implements IAiPipelineStepRepository {
  constructor(private readonly context: TransactionContext) {}

  findById(id: string): Promise<AiPipelineStepEntity | null> {
    return this.context.manager().findOneBy(AiPipelineStepEntity, { id });
  }

  findByCode(code: string): Promise<AiPipelineStepEntity | null> {
    return this.context.manager().findOneBy(AiPipelineStepEntity, { code });
  }

  save(entity: AiPipelineStepEntity): Promise<AiPipelineStepEntity> {
    return this.context.manager().save(AiPipelineStepEntity, entity);
  }
}
