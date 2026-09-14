import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  UserDirectorySyncService,
  UserDirectorySyncStatus,
} from '../../user-directory-sync.service';
import { GetUserSyncStatusQuery } from '../query/get-user-sync-status.query';

@QueryHandler(GetUserSyncStatusQuery)
export class GetUserSyncStatusHandler implements IQueryHandler<
  GetUserSyncStatusQuery,
  UserDirectorySyncStatus
> {
  constructor(private readonly syncService: UserDirectorySyncService) {}

  execute(): Promise<UserDirectorySyncStatus> {
    return Promise.resolve(this.syncService.getStatus());
  }
}
