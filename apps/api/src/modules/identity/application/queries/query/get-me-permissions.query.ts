import { IQuery } from '@nestjs/cqrs';

export class GetMePermissionsQuery implements IQuery {
  constructor(
    public readonly userId: string,
    public readonly isAdmin: boolean,
  ) {}
}
