import { IQuery } from '@nestjs/cqrs';

export class ListRoleUsersQuery implements IQuery {
  constructor(
    public readonly roleId: string,
    public readonly page: number,
    public readonly limit: number,
  ) {}
}
