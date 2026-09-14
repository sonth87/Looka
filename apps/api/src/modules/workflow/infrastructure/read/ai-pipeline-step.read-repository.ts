import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiPipelineStepEntity } from '../persistence/ai-pipeline-step.entity';
import { AiPipelineStepReadModel } from '../../application/queries/read-model/ai-pipeline-step.read-model';

@Injectable()
export class AiPipelineStepReadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(includeInactive = false): Promise<AiPipelineStepReadModel[]> {
    const where = includeInactive ? {} : { active: true };
    const entities = await this.dataSource.manager.find(AiPipelineStepEntity, {
      where,
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
    return entities.map((e) => this.toReadModel(e));
  }

  async findByCodes(
    codes: readonly string[],
  ): Promise<AiPipelineStepReadModel[]> {
    if (codes.length === 0) return [];
    const entities = await this.dataSource.manager
      .createQueryBuilder(AiPipelineStepEntity, 's')
      .where('s.code IN (:...codes)', { codes: [...codes] })
      .getMany();
    return entities.map((e) => this.toReadModel(e));
  }

  private toReadModel(e: AiPipelineStepEntity): AiPipelineStepReadModel {
    return {
      id: e.id,
      code: e.code,
      nameVi: e.nameVi,
      description: e.description,
      sidecarEndpoint: e.sidecarEndpoint,
      paramsSchema: e.paramsSchema,
      defaultParams: e.defaultParams,
      active: e.active,
      sortOrder: e.sortOrder,
      isSystem: e.isSystem,
    };
  }
}
