import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/base.entity';

/**
 * A person who has logged into the CMS or a kiosk/web client via the
 * external SSO backend (see docs/LOGIN.md, `SsoAuthGuard`). This table is
 * an upsert cache of the SSO's own identity, not a source of truth for
 * who a person is — `ssoUserCode`/`email`/`displayName` are refreshed from
 * the SSO's `/auth/profile` response on every successful login
 * (`SsoAuthGuard.canActivate`), never edited here directly.
 *
 * `isAdmin`/`roles` ARE this API's own source of truth (the SSO has no
 * concept of "admin of this app" or "photo reviewer") — see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.2.3 and
 * cms-photo-review-plan.md §7. Bootstrap: on upsert, if no row in this
 * table has `isAdmin = true` yet, a login whose email appears in the
 * `ADMIN_EMAILS` env var (comma-separated) is granted `isAdmin = true`
 * automatically — see `SsoAuthGuard`'s own doc comment for why this exists
 * (otherwise nobody could ever grant the first admin).
 */
@Entity('users')
export class User extends BaseEntity {
  @Column('varchar', { length: 100, name: 'sso_user_code', unique: true })
  @Index()
  @ApiProperty({ description: 'Mã người dùng theo SSO (user_code)' })
  ssoUserCode: string;

  @Column('varchar', { length: 255 })
  @Index()
  @ApiProperty({ description: 'Email' })
  email: string;

  @Column('varchar', { length: 255, nullable: true, name: 'display_name' })
  @ApiPropertyOptional({ description: 'Tên hiển thị' })
  displayName?: string | null;

  @Column('boolean', { default: false, name: 'is_admin' })
  @ApiProperty({ description: 'Có quyền quản trị CMS (campaign/thiết bị/duyệt tài khoản) hay không' })
  isAdmin: boolean;

  /**
   * Free-form role tags this API controls itself — currently only
   * `'REVIEWER'` (photo-review CMS area, see cms-photo-review-plan.md §7)
   * is read anywhere. Kept as a string array rather than a fixed enum
   * column since more app-specific roles are expected (§7's `ADMIN`/
   * `REVIEWER` split is deliberately not the same as `isAdmin`, which
   * gates the *campaign/device* CMS area specifically).
   */
  @Column('jsonb', { default: () => "'[]'", name: 'roles' })
  @ApiProperty({ description: 'Vai trò ứng dụng (VD: REVIEWER)', type: [String] })
  roles: string[];

  @Column('timestamptz', { nullable: true, name: 'last_login_at' })
  @ApiPropertyOptional({ description: 'Lần đăng nhập gần nhất' })
  lastLoginAt?: Date | null;
}
