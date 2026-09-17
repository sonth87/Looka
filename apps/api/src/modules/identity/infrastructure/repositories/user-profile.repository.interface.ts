import { User } from '@app/modules/shared/entities/user.entity';

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');

/**
 * CRUD over the EXISTING `User` entity (`modules/shared/entities`) — not
 * an aggregate repository. `User` has no domain aggregate yet
 * (backend-layering-plan.md §6 Giai đoạn 3 is where that extraction
 * happens); until then this is a deliberately plain wrapper, consistent
 * with how `campaign.service.ts` etc. still work today for
 * not-yet-migrated modules. Still routed through `TransactionContext` (not
 * a directly-injected `Repository<User>`) so writes participate in
 * whatever `UnitOfWork.run()` transaction the calling command handler is
 * inside.
 */
export interface IUserProfileRepository {
  findById(id: string): Promise<User | null>;
  findByCode(code: string): Promise<User | null>;
  /** Case-insensitive, any `source` — same matching rule `SsoAuthGuard.upsertUser()` already uses for its own MANUAL-row merge (plan item 14, 2026-09-17). */
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<User>;
}
