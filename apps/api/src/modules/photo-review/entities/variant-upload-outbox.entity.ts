import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { VariantOutboxStatus } from '../photo-review.constants';
import { PhotoVariant } from './photo-variant.entity';

/**
 * Local-first bytes for a `photo_variants` row — this module's own
 * counterpart to the `capture` module's `UploadOutboxEntry`
 * (`upload_outbox`), NOT a reuse of that table. See the migration
 * (`1803000000000-VariantUploadOutbox.ts`) for why a parallel table, not an
 * extension of `upload_outbox`.
 *
 * Bytes land here in the SAME transaction as the `PhotoVariant` row they
 * belong to (`PhotoReviewService.storeVariantBytesLocalFirst`) — the variant
 * image is durably stored and immediately viewable
 * (`PhotoReviewService.resolveVariantViewSource` /
 * `VariantContentController`) before, and regardless of whether, the push to
 * fs-core (`VariantUploadWorkerService`) ever succeeds.
 *
 * Not registered in this module's own `TypeOrmModule.forFeature` for
 * repository injection — every read/write against it in this codebase goes
 * through raw SQL (`dataSource.query`/`manager.query`), the same convention
 * `UploadOutboxEntry` itself is actually used under (its own `@Entity` class
 * is likewise never injected as a `Repository` anywhere). Kept as a real
 * entity class purely so this table's shape is documented next to the code
 * that reads it, and so it participates in schema tooling the same way
 * every other table in this app does.
 */
@Entity('variant_upload_outbox')
export class VariantUploadOutboxEntry extends BaseEntity {
  @Column('uuid', { name: 'variant_id' })
  variantId: string;

  @ManyToOne(() => PhotoVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variant_id' })
  variant?: PhotoVariant;

  // Same string across every retry of one variant's upload, so a reply lost
  // on the way back cannot become a second file on the file-service — same
  // reasoning as `UploadOutboxEntry.idemKey`.
  @Column('varchar', { length: 255, unique: true, name: 'idem_key' })
  idemKey: string;

  @Column('text', { name: 'virtual_path' })
  virtualPath: string;

  @Column('varchar', { length: 100, name: 'mime_type' })
  mimeType: string;

  @Column('bytea')
  content: Buffer;

  /**
   * A kiosk session's variant uploads to its device's own tenant
   * (`FileStorageService.clientForTenant`) — recorded per row since the
   * cron has no other way to know a queued job's target tenant. `null` for
   * a web-session variant, which uses the API's own default tenant.
   */
  @Column('varchar', { length: 255, nullable: true, name: 'tenant_name' })
  tenantName?: string | null;

  @Column({ type: 'enum', enum: VariantOutboxStatus, default: VariantOutboxStatus.PENDING })
  @Index()
  status: VariantOutboxStatus;

  @Column('int', { default: 0 })
  attempts: number;

  @Column('text', { nullable: true, name: 'last_error' })
  lastError?: string;

  @Column('timestamptz', { default: () => 'now()', name: 'next_retry_at' })
  nextRetryAt: Date;
}
