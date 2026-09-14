import { IQuery } from '@nestjs/cqrs';
import { ListUsersFilter } from '../../../infrastructure/read/user-directory.read-repository';

export class ListUsersQuery implements IQuery {
  constructor(public readonly filter: ListUsersFilter) {}
}
