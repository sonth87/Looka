import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  UserDirectorySyncService,
  UserDirectorySyncStatus,
} from '../../user-directory-sync.service';
import { SyncUsersCommand } from '../command/sync-users.command';

/**
 * Plain `ICommandHandler` — NOT `extends TransactionalCommandHandler` — see
 * `UserDirectorySyncService`'s own doc comment for why (no single DB
 * transaction should wrap an external fetch plus a bulk upsert loop). The
 * controller still only calls `CommandBus.execute()`, same as every other
 * route in this module.
 */
@CommandHandler(SyncUsersCommand)
export class SyncUsersHandler implements ICommandHandler<
  SyncUsersCommand,
  UserDirectorySyncStatus
> {
  constructor(private readonly syncService: UserDirectorySyncService) {}

  execute(): Promise<UserDirectorySyncStatus> {
    return this.syncService.sync();
  }
}
