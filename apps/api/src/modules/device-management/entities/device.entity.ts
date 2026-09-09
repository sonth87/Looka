import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../shared/common/base.entity';
import { Campaign } from './campaign.entity';

export enum DeviceStatus {
  /** Registered on the CMS, but the kiosk has not loaded its activation file yet. */
  REGISTERED = 'REGISTERED',
  /** The kiosk has loaded its activation file and is operating. */
  ACTIVATED = 'ACTIVATED',
  /**
   * Explicitly revoked from the CMS (2026-09-08 "Thu hồi" action) — every
   * secret this device ever had (current + previous) is dead immediately,
   * no overlap. Distinct from just rotating the secret via `reissueDevice`,
   * which deliberately keeps the kiosk's currently-running secret alive
   * until the new one is used — see this entity's `previousSecretHash` doc
   * comment below for why that overlap exists and REVOKED bypasses it.
   */
  REVOKED = 'REVOKED',
}

/**
 * One physical kiosk. `id` (inherited uuid) is the device_id handed to the
 * kiosk in its activation file — see docs/plans/multi-camera-device-management-discussion.md
 * §3.2. Registration always happens under a `Campaign`, which is where
 * expiry, consent, and capture configuration actually live; nothing here
 * duplicates those.
 */
@Entity('devices')
export class Device extends BaseEntity {
  /**
   * Nullable since 2026-09-08 (§3.3): a self-enrolled device
   * (`POST /v1/devices/self-enroll`) has no campaign at registration time —
   * campaign is picked per login/session instead (§3.9's "campaign chọn lúc
   * đăng nhập"). The FK changed from `ON DELETE CASCADE` to `ON DELETE
   * SET NULL` at the same time: a campaign delete detaching a self-enrolled
   * device (which isn't really "that campaign's" device) should never
   * destroy the device row itself. Admin-registered devices
   * (`POST /v1/campaigns/:campaignId/devices`, unchanged this pass) still
   * always get one at creation.
   */
  @Column('uuid', { name: 'campaign_id', nullable: true })
  @Index()
  @ApiPropertyOptional({
    description:
      'Campaign chứa thiết bị này — null nếu tự đăng ký và chưa chọn campaign',
  })
  campaignId?: string | null;

  @ManyToOne(() => Campaign, (campaign) => campaign.devices, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign | null;

  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên thiết bị' })
  name: string;

  /** Self-enroll only (§3.3) — the machine's own hostname, as reported by the app. Null for admin-registered devices. */
  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({
    description: 'Tên máy (hostname) — chỉ có khi tự đăng ký',
  })
  hostname?: string | null;

  /**
   * Self-enroll only (§3.3) — a stable hash of machine id + OS, used to
   * recognize "this is the same physical machine logging in again" across
   * different users/reinstalls without ever exposing raw machine
   * identifiers. Indexed since `DeviceService.selfEnroll` looks devices up
   * by this column on every self-enroll call.
   */
  @Column('varchar', { length: 255, nullable: true })
  @Index()
  @ApiPropertyOptional({
    description:
      'Fingerprint máy (hash machine id + OS) — chỉ có khi tự đăng ký',
  })
  fingerprint?: string | null;

  /** Self-enroll only (§3.3) — the user whose login first created this device row. Never changes after creation. */
  @Column('uuid', { nullable: true, name: 'enrolled_by_user_id' })
  @ApiPropertyOptional({ description: 'Người tự đăng ký thiết bị này lần đầu' })
  enrolledByUserId?: string | null;

  /** Self-enroll only (§3.3) — updated to the current user on every self-enroll call against an existing fingerprint (i.e. every login on this machine). */
  @Column('uuid', { nullable: true, name: 'last_user_id' })
  @ApiPropertyOptional({
    description: 'Người đăng nhập gần nhất trên thiết bị này',
  })
  lastUserId?: string | null;

  @Column('varchar', { length: 500, nullable: true, name: 'auth_api_endpoint' })
  @ApiPropertyOptional({
    description: 'API endpoint lấy thông tin xác thực cho thiết bị này',
  })
  authApiEndpoint?: string;

  /**
   * SHA-256 of the device_secret, never the secret itself — the plaintext
   * is handed to the kiosk exactly once, inside the activation file, and is
   * not retrievable afterwards. Verified with a constant-time compare, the
   * same reasoning as `ApiKeyMiddleware`'s `timingSafeEqual` use.
   */
  @Column('varchar', { length: 64, name: 'device_secret_hash', select: false })
  deviceSecretHash: string;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    default: DeviceStatus.REGISTERED,
  })
  @ApiProperty({ description: 'Trạng thái thiết bị', enum: DeviceStatus })
  status: DeviceStatus;

  @Column('timestamptz', { nullable: true, name: 'activated_at' })
  @ApiPropertyOptional({ description: 'Thời điểm kiosk nạp mã kích hoạt' })
  activatedAt?: Date | null;

  /**
   * "Secret rotation with overlap" (2026-09-08 fix for the "kiosk 3"
   * incident — see docs/ROADMAP.md's dated entry): when `reissueDevice`
   * rotates `deviceSecretHash`, the secret the kiosk is *actually running*
   * moves here instead of being killed outright, so a second accidental
   * "Tải gói kích hoạt" click (or any reissue before the new package is
   * loaded) no longer 401-locks a live kiosk. Server-side, "the old secret
   * is still alive" ⇔ this column is non-null — there is no separate boolean
   * flag to drift out of sync with it. Cleared (set back to null) the moment
   * the *new* secret is used successfully once (`verifyCredentials`), or
   * immediately on `revokeDevice` (revocation has no overlap by design).
   * `select: false` for the same reason as `deviceSecretHash` — it's still a
   * live credential, never handed to the CMS.
   */
  @Column('varchar', {
    length: 64,
    nullable: true,
    name: 'previous_secret_hash',
    select: false,
  })
  previousSecretHash?: string | null;

  /**
   * Set the moment `reissueDevice` rotates the secret; cleared (back to
   * null) at the exact same time as `previousSecretHash` above — "kiosk
   * hasn't loaded its new package yet" and "an old secret is still alive"
   * are one fact, not two, so this column is the CMS-visible half of that
   * same fact (`previousSecretHash` itself is `select: false` and never
   * reaches the CMS). The CMS shows its "chưa nạp gói mới" chip purely off
   * `secretRotatedAt != null`.
   */
  @Column('timestamptz', { nullable: true, name: 'secret_rotated_at' })
  @ApiPropertyOptional({
    description:
      'Thời điểm cấp lại mã gần nhất, còn đang chờ kiosk nạp gói mới',
  })
  secretRotatedAt?: Date | null;

  /** Last time `verifyCredentials` accepted this device's secret — CMS-visible "xác thực gần nhất" for spotting a kiosk that's gone quiet. */
  @Column('timestamptz', { nullable: true, name: 'last_auth_at' })
  @ApiPropertyOptional({ description: 'Lần xác thực thành công gần nhất' })
  lastAuthAt?: Date | null;

  /** Last time `verifyCredentials` rejected this device — paired with `lastAuthFailReason` below so the CMS can show *why*, not just *that* a kiosk got rejected. */
  @Column('timestamptz', { nullable: true, name: 'last_auth_failed_at' })
  @ApiPropertyOptional({ description: 'Lần xác thực thất bại gần nhất' })
  lastAuthFailedAt?: Date | null;

  /** Reason for the failure recorded at `lastAuthFailedAt` — one of `INVALID_SECRET`/`EXPIRED`/`REVOKED` (`DeviceCredentialCheck['reason']`, minus `NOT_FOUND` which has no row to update). */
  @Column('varchar', {
    length: 20,
    nullable: true,
    name: 'last_auth_fail_reason',
  })
  @ApiPropertyOptional({ description: 'Lý do xác thực thất bại gần nhất' })
  lastAuthFailReason?: string | null;

  /** Set by `revokeDevice`; display-only — the actual source of truth for "is this device revoked" is `status === REVOKED`, never this column alone (mirrors `activatedAt`'s relationship to `status === ACTIVATED`). */
  @Column('timestamptz', { nullable: true, name: 'revoked_at' })
  @ApiPropertyOptional({ description: 'Thời điểm thiết bị bị thu hồi' })
  revokedAt?: Date | null;
}
