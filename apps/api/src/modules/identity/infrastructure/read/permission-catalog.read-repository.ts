import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PermissionEntity } from '../persistence/permission.entity';
import { PermissionReadModel } from '../../application/queries/read-model/permission.read-model';

export interface DiscoveredPermission {
  code: string;
  group: string;
  method: string | null;
  path: string | null;
  description: string | null;
}

/**
 * Backs both the `GET /v1/permissions` query and `PermissionCatalogService`'s
 * boot-time upsert (application/permission-catalog.service.ts) — the
 * latter is infrastructure bootstrap, not a business use case, so it
 * writes directly through this repository rather than a command/UnitOfWork
 * (cms-8-screens-api-plan.md §1.1 E1: the catalog is data the system
 * derives from code, not something a user transacts on).
 */
@Injectable()
export class PermissionCatalogReadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(): Promise<PermissionReadModel[]> {
    const entities = await this.dataSource.manager.find(PermissionEntity, {
      order: { group: 'ASC', code: 'ASC' },
    });
    return entities.map((e) => ({
      id: e.id,
      code: e.code,
      group: e.group,
      method: e.method,
      path: e.path,
      description: e.description,
    }));
  }

  async upsertMany(discovered: DiscoveredPermission[]): Promise<void> {
    for (const perm of discovered) {
      const existing = await this.dataSource.manager.findOneBy(
        PermissionEntity,
        {
          code: perm.code,
        },
      );
      const entity = existing ?? new PermissionEntity();
      entity.code = perm.code;
      entity.group = perm.group;
      entity.method = perm.method;
      entity.path = perm.path;
      entity.description = perm.description;
      await this.dataSource.manager.save(PermissionEntity, entity);
    }
  }

  async findIdsByCode(codes: readonly string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    const rows = await this.dataSource.manager
      .createQueryBuilder(PermissionEntity, 'p')
      .where('p.code IN (:...codes)', { codes: [...codes] })
      .getMany();
    return rows.map((r) => r.id);
  }
}
