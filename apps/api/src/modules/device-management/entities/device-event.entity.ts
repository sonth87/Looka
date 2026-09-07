import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../shared/common/base.entity';

export enum DeviceEventType {
  SESSION_COMPLETED = 'SESSION_COMPLETED',
  UPLOAD_SUCCESS = 'UPLOAD_SUCCESS',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  RETAKE = 'RETAKE',
  CB_HELP_INTERVENTION = 'CB_HELP_INTERVENTION',
  // Self-sufficient capture records - see CaptureReportService and the
  // plan's §5 kiosk-server contract. Applied (upserted into sessions/photos)
  // by DeviceEventService.recordBatch before the raw event row below is
  // saved, same as every other type here.
  SESSION_REPORT = 'SESSION_REPORT',
  PHOTO_STATUS = 'PHOTO_STATUS',
}

/**
 * One notable thing that happened on a kiosk — see
 * docs/plans/multi-camera-device-management-discussion.md §3.4's "bảng log
 * sự kiện theo thiết bị". `campaignId` is denormalized onto every row
 * (rather than joined through `device_id` at query time) because every
 * stats query in practice groups by campaign first — see
 * `StatsService.campaignStats`.
 *
 * `occurredAt` is the kiosk's own clock at the moment the event happened,
 * not when this row was inserted — a kiosk pushes events in batches after
 * being offline, so "when the server received it" would badly skew any
 * time-based stat. `receivedAt` (inherited `createdAt`) is kept too, purely
 * for operational debugging (how far behind is this kiosk's queue).
 */
@Entity('device_events')
export class DeviceEvent extends BaseEntity {
  @Column('uuid', { name: 'device_id' })
  @Index()
  @ApiProperty()
  deviceId: string;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty()
  campaignId: string;

  @Column({ type: 'enum', enum: DeviceEventType })
  @ApiProperty({ enum: DeviceEventType })
  type: DeviceEventType;

  @Column('timestamptz', { name: 'occurred_at' })
  @ApiProperty({
    description:
      "The kiosk's own clock when this happened, not when the server received it",
  })
  occurredAt: Date;

  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({
    description:
      'Free-form detail, e.g. { stepId, attempt } for a RETAKE event',
  })
  metadata?: Record<string, unknown> | null;
}
