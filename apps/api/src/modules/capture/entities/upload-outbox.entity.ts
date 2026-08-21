import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { OutboxStatus } from '../capture.constants';
import { Photo } from './photo.entity';

/**
 * Bytes land here in the same transaction as the `Photo` row (see
 * `PhotoService.addPhoto`). The upload to the file-service happens
 * afterwards and can fail - the network drops, the service is restarting, a
 * scan queue is backed up. Recording the intent first means a failure delays
 * the upload instead of losing the photo, and a restart picks up where it
 * stopped.
 */
@Entity('upload_outbox')
export class UploadOutboxEntry extends BaseEntity {
  @Column('uuid', { name: 'photo_id' })
  photoId: string;

  @ManyToOne(() => Photo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'photo_id' })
  photo?: Photo;

  // Same string across every retry of one photo, so a reply lost on the way
  // back cannot become a second file on the file-service.
  @Column('varchar', { length: 255, unique: true, name: 'idem_key' })
  idemKey: string;

  @Column('text', { name: 'virtual_path' })
  virtualPath: string;

  @Column('varchar', { length: 100, name: 'mime_type' })
  mimeType: string;

  @Column('bytea')
  content: Buffer;

  @Column({ type: 'enum', enum: OutboxStatus, default: OutboxStatus.PENDING })
  @Index()
  status: OutboxStatus;

  @Column('int', { default: 0 })
  attempts: number;

  @Column('text', { nullable: true, name: 'last_error' })
  lastError?: string;

  @Column('timestamptz', { default: () => 'now()', name: 'next_retry_at' })
  nextRetryAt: Date;
}
