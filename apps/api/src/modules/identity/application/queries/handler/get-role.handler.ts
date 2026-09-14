import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { RoleCatalogReadRepository } from '../../../infrastructure/read/role-catalog.read-repository';
import { RoleReadModel } from '../read-model/role.read-model';
import { GetRoleQuery } from '../query/get-role.query';

@QueryHandler(GetRoleQuery)
export class GetRoleHandler implements IQueryHandler<
  GetRoleQuery,
  RoleReadModel
> {
  constructor(private readonly repository: RoleCatalogReadRepository) {}

  async execute(query: GetRoleQuery): Promise<RoleReadModel> {
    const role = await this.repository.getById(query.roleId);
    if (!role) {
      // Plain NestJS HttpException here (not ApplicationException) — this is
      // the query side, which has no ConstraintErrorTranslator involvement;
      // AllExceptionsFilter passes through ordinary HttpExceptions untouched.
      throw new NotFoundException('Không tìm thấy vai trò.');
    }
    return role;
  }
}
