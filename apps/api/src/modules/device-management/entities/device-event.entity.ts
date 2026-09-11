import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

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
  // Video-upload-to-file-service (2026-09-08) — mirrors PHOTO_STATUS, one
  // per video per lifecycle milestone. See CaptureReportService.applyVideoStatus
  // and migration 1788000000000-SessionVideos for the enum-rollout ordering
  // this depends on (API must know this value before any kiosk build emits it).
  VIDEO_STATUS = 'VIDEO_STATUS',
  // "Chụp lại sau khi đã lưu" (2026-09-08 post-save retake feature) — a
  // kiosk retake that happens AFTER a session was already approved once
  // sends this to tell the API to drop the stale photos/session_videos row
  // it is replacing. See CaptureReportService.applyAttemptSuperseded and
  // migration 1789000000000-AttemptSuperseded for the same enum-rollout
  // ordering requirement as VIDEO_STATUS above.
  ATTEMPT_SUPERSEDED = 'ATTEMPT_SUPERSEDED',
  // Fired the moment a kiosk/web session actually starts (subject identified,
  // capture screen live) — not when it completes. Purely additive telemetry
  // for the "đang chụp" ("currently being captured") indicator on the CMS
  // students page and the kiosk's own captured-list panel — see
  // docs/plans/campaign-config-sso-card-photo-discussion.md §3.8.2 and
  // ui-redesign-plan.md C1/C4. No handler mutates `sessions`/`photos` off
  // this event; `DeviceEventService.recordBatch` just stores it like any
  // other raw event, and campaign-stats reads recent rows of this type
  // directly (see StatsService).
  SESSION_STARTED = 'SESSION_STARTED',
  // One per actual shutter-fire, auto-vs-manual statistics feature — see
  // the discussion doc §3.7. `metadata` carries
  // `{ sessionId, stepId, attempt, triggerSource, captureMode }` where
  // `triggerSource` is `@face/core`'s `CaptureTriggerSource`
  // ('AUTO'|'GESTURE'|'SHUTTER'|'EXTERNAL'). Counts every attempt, including
  // ones later superseded by a retake (§3.4b keeps only the final photo row,
  // but the trigger-source *count* intentionally still reflects every real
  // shutter-fire) — distinct from `photos.trigger_source`, which reflects
  // only the final kept photo.
  CAPTURE_TRIGGERED = 'CAPTURE_TRIGGERED',
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
