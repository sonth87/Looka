import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { DainamStudentInfoClient } from './services/dainam-student-info.client';

/**
 * Global module for cross-cutting providers shared across feature modules.
 * `CommonService<T>` itself is not registered here - it's an abstract base
 * class each feature module extends with its own repository, not a shared
 * provider.
 *
 * `User` lives here (rather than in `device-management` or a new
 * `photo-review` module) specifically so both can `@InjectRepository(User)`
 * without importing each other — see docs/plans/campaign-config-sso-card-photo-discussion.md
 * §3.2.3 and cms-photo-review-plan.md §7. `SsoAuthGuard` (below) also
 * depends on it directly.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [],
  providers: [DainamStudentInfoClient],
  exports: [TypeOrmModule, DainamStudentInfoClient],
})
export class SharedModule {}
