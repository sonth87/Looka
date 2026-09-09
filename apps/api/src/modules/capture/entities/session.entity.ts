import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, OneToMany } from 'typeorm';
import { SessionSource, SessionStatus } from '../capture.constants';
import { Photo } from './photo.entity';

@Entity('sessions')
export class Session extends BaseEntity {
  @Column('varchar', { length: 100, nullable: true, name: 'subject_code' })
  @ApiPropertyOptional({ description: 'Mã định danh người được chụp, nếu có' })
  subjectCode?: string;

  @Column('varchar', { length: 255, nullable: true, name: 'subject_name' })
  @ApiPropertyOptional({ description: 'Tên người được chụp, nếu có' })
  subjectName?: string;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.IN_PROGRESS,
  })
  @ApiProperty({ description: 'Trạng thái phiên chụp', enum: SessionStatus })
  status: SessionStatus;

  @Column('timestamptz', { nullable: true, name: 'completed_at' })
  @ApiPropertyOptional({ description: 'Thời điểm phiên hoàn tất' })
  completedAt?: Date;

  // jsonb rather than dedicated columns: whatever the capturing client wants
  // to remember about the run, without a migration for every new field.
  @Column('jsonb', { default: {} })
  @ApiProperty({ description: 'Dữ liệu bổ sung do client gửi kèm' })
  metadata: Record<string, unknown>;

  /**
   * WEB (`apps/web` -> this API) or KIOSK (`apps/desktop`, reported through
   * the SESSION_REPORT/PHOTO_STATUS device events - see
   * `CaptureReportService`). Both paths share this one table (Phase 11
   * design decision D1) rather than each owning its own.
   */
  @Column({ type: 'enum', enum: SessionSource, default: SessionSource.WEB })
  @ApiProperty({ description: 'WEB hoặc KIOSK', enum: SessionSource })
  source: SessionSource;

  @Column('uuid', { nullable: true, name: 'device_id' })
  @ApiPropertyOptional({
    description: 'Thiết bị kiosk đã tạo phiên này, nếu có',
  })
  deviceId?: string;

  @Column('uuid', { nullable: true, name: 'campaign_id' })
  @ApiPropertyOptional({
    description: 'Campaign chứa phiên này, nếu có (chỉ phiên từ kiosk)',
  })
  campaignId?: string;

  /** The kiosk's own clock when the session started - not when this row was written. */
  @Column('timestamptz', { nullable: true, name: 'captured_at' })
  @ApiPropertyOptional({
    description: 'Thời điểm bắt đầu chụp, theo đồng hồ kiosk',
  })
  capturedAt?: Date;

  /** When the operator approved the session on the kiosk (decision 1: only the final photo of each step survives approval). */
  @Column('timestamptz', { nullable: true, name: 'approved_at' })
  @ApiPropertyOptional({
    description: 'Thời điểm operator duyệt phiên trên kiosk',
  })
  approvedAt?: Date;

  @Column('varchar', { length: 100, nullable: true, name: 'workflow_id' })
  @ApiPropertyOptional({ description: 'Id quy trình chụp đã dùng, nếu có' })
  workflowId?: string;

  /**
   * Người vận hành đã chụp phiên này, nếu có - id trong bảng `users`, không
   * ràng buộc FK (xem doc comment của migration `SessionOperatorUser`). Đến
   * từ `CreateSessionDto.operatorUserId` (web) hoặc `operatorUserId` trong
   * payload SESSION_REPORT (kiosk) - xem `CaptureReportService.applySessionReport()`.
   */
  @Column('uuid', { nullable: true, name: 'operator_user_id' })
  @ApiPropertyOptional({
    description: 'Id người vận hành đã chụp phiên này, nếu có',
  })
  operatorUserId?: string;

  @OneToMany(() => Photo, (photo) => photo.session)
  photos?: Photo[];
}
