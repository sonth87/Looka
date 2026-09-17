import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { User } from '@app/modules/shared/entities/user.entity';
import { TransactionalCommandHandler } from '@app/shared/cqrs/transactional-command.handler';
import { UnitOfWork } from '@app/shared/database/unit-of-work';
import { USER_PROFILE_REPOSITORY } from '../../../infrastructure/repositories/user-profile.repository.interface';
import type { IUserProfileRepository } from '../../../infrastructure/repositories/user-profile.repository.interface';
import { FindOrCreateUserByEmailCommand } from '../command/find-or-create-user-by-email.command';

export interface FindOrCreateUserByEmailResult {
  id: string;
  email: string;
  displayName: string | null;
  /** `false` when an existing account (any `source`) already matched this email — nothing was created. */
  created: boolean;
}

/**
 * "Gán người vào campaign theo email" (plan item 14, 2026-09-17) —
 * `CampaignAssignmentsPanel.tsx`'s `AssignUserModal` no longer requires
 * picking from a list of already-registered users; the CMS resolves an
 * email to a `userId` here first, then calls the existing kiosk-assignment
 * endpoint with that id, unchanged.
 *
 * Reuses the exact same "MANUAL placeholder, `SsoAuthGuard.upsertUser()`
 * merges it into the real identity on first SSO login" mechanism
 * `CreateUserHandler` already established — this is deliberately NOT a new
 * concept, just a second, idempotent way to reach the same outcome: given
 * only an email (no display name yet), find the existing account
 * (`findByEmail` is case-insensitive, any `source` — an existing SSO/SYNC
 * user's email must resolve to their real account, not a duplicate), or
 * create a MANUAL one exactly like `CreateUserHandler` does, minus the
 * `roleIds`/`code` this call site never has on hand.
 */
@CommandHandler(FindOrCreateUserByEmailCommand)
export class FindOrCreateUserByEmailHandler
  extends TransactionalCommandHandler<
    FindOrCreateUserByEmailCommand,
    FindOrCreateUserByEmailResult
  >
  implements
    ICommandHandler<
      FindOrCreateUserByEmailCommand,
      FindOrCreateUserByEmailResult
    >
{
  constructor(
    unitOfWork: UnitOfWork,
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly users: IUserProfileRepository,
  ) {
    super(unitOfWork);
  }

  protected async handle(
    command: FindOrCreateUserByEmailCommand,
  ): Promise<FindOrCreateUserByEmailResult> {
    const existing = await this.users.findByEmail(command.email);
    if (existing) {
      return {
        id: existing.id,
        email: existing.email,
        displayName: existing.displayName ?? null,
        created: false,
      };
    }

    // Same fallback `sso-auth.guard.ts`'s own bootstrap-admin branch uses
    // when a name isn't known yet — the local part of the email, never left
    // blank (a MANUAL row's displayName is not nullable).
    const displayName =
      command.displayNameHint?.trim() ||
      command.email.split('@')[0] ||
      command.email;

    const user = new User();
    user.ssoUserCode = `MANUAL:${randomUUID()}`;
    user.email = command.email;
    user.displayName = displayName;
    user.title = null;
    user.code = null;
    user.phone = null;
    user.isAdmin = false;
    user.roles = [];
    user.status = 'ACTIVE';
    user.source = 'MANUAL';
    const saved = await this.users.save(user);

    return {
      id: saved.id,
      email: saved.email,
      displayName: saved.displayName ?? null,
      created: true,
    };
  }
}
