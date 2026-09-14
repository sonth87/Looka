import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { User } from '@app/modules/shared/entities/user.entity';
import { USER_DIRECTORY_CLIENT } from './ports/user-directory.port';
import type { IUserDirectoryClient } from './ports/user-directory.port';

export interface UserDirectorySyncStatus {
  status: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: Date | null;
  finishedAt: Date | null;
  upsertedCount: number;
  error: string | null;
}

/**
 * Deliberately NOT a `TransactionalCommandHandler` command — a directory
 * sync is an infrequent, admin-triggered bulk operation (call an external
 * API, then upsert N rows), closer in shape to the outbox workers
 * elsewhere in this codebase than to a single-aggregate business command;
 * wrapping the whole loop plus the network call in one `UnitOfWork.run()`
 * transaction would hold a DB transaction open for however long the
 * external fetch and every row upsert take. `SyncUsersHandler` is a plain
 * `@CommandHandler` (no `extends TransactionalCommandHandler`) that
 * delegates here.
 *
 * Status is kept in-memory only, on purpose — this is a stub with no real
 * caller yet (D-Q10); a dedicated `user_directory_sync_runs` table for a
 * feature nothing calls today would be exactly the kind of premature
 * schema Phase 0's own `background_jobs` deferral already argued against.
 * Add persistence once a real sync actually runs on a schedule.
 */
@Injectable()
export class UserDirectorySyncService {
  private readonly logger = new Logger(UserDirectorySyncService.name);
  private status: UserDirectorySyncStatus = {
    status: 'IDLE',
    startedAt: null,
    finishedAt: null,
    upsertedCount: 0,
    error: null,
  };

  constructor(
    @Inject(USER_DIRECTORY_CLIENT)
    private readonly client: IUserDirectoryClient,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  getStatus(): UserDirectorySyncStatus {
    return { ...this.status };
  }

  async sync(): Promise<UserDirectorySyncStatus> {
    this.status = {
      status: 'RUNNING',
      startedAt: new Date(),
      finishedAt: null,
      upsertedCount: 0,
      error: null,
    };

    try {
      const records = await this.client.fetchAll();
      let upsertedCount = 0;

      for (const record of records) {
        // Only classify a brand-new row as `SYNC` — an existing row's
        // `source` (SSO/MANUAL) is never overwritten, so a sync run cannot
        // silently reclassify someone who already logged in or was added
        // by hand; their profile fields still get refreshed either way.
        const existing = await this.dataSource.manager.findOneBy(User, {
          email: record.email,
        });
        const user = existing ?? new User();
        if (!existing) {
          user.ssoUserCode = `SYNC:${randomUUID()}`;
          user.email = record.email;
          user.isAdmin = false;
          user.roles = [];
          user.status = 'ACTIVE';
          user.source = 'SYNC';
        }
        user.displayName = record.displayName;
        if (record.title !== undefined) user.title = record.title;
        if (record.code !== undefined) user.code = record.code;
        if (record.phone !== undefined) user.phone = record.phone;

        await this.dataSource.manager.save(User, user);
        upsertedCount += 1;
      }

      this.status = {
        status: 'SUCCESS',
        startedAt: this.status.startedAt,
        finishedAt: new Date(),
        upsertedCount,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`User directory sync failed: ${message}`);
      this.status = {
        status: 'FAILED',
        startedAt: this.status.startedAt,
        finishedAt: new Date(),
        upsertedCount: 0,
        error: message,
      };
    }

    return this.getStatus();
  }
}
