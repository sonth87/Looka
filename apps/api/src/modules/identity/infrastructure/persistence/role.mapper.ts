import { Role } from '../../domain/aggregate/role.aggregate';
import { RoleEntity } from './role.entity';

export class RoleMapper {
  /** `permissionCodes` comes from a separate join query — see role.repository.ts. */
  static toDomain(entity: RoleEntity, permissionCodes: string[]): Role {
    return Role.reconstruct({
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      isSystem: entity.isSystem,
      permissionCodes,
    });
  }

  static toEntity(role: Role, existing?: RoleEntity): RoleEntity {
    const entity = existing ?? new RoleEntity();
    entity.id = role.id;
    entity.code = role.code;
    entity.name = role.name;
    entity.description = role.description;
    entity.isSystem = role.isSystem;
    return entity;
  }
}
