import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

export type EligibilityMode =
  'NONE' | 'ROSTER' | 'EXTERNAL_API' | 'ROSTER_AND_API';
export type EligibilitySource = 'NONE' | 'ROSTER' | 'EXTERNAL_API';

/** Audit trail for `GET /v1/campaigns/:id/subjects/lookup` (plan §2.3) — see the migration's own doc comment for why this exists and what `context` holds. */
@Entity('eligibility_check_logs')
export class EligibilityCheckLog extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty()
  campaignId: string;

  @Column('varchar', { length: 100 })
  @ApiProperty({ description: 'Mã SV hoặc CCCD dùng để tra' })
  key: string;

  @Column('varchar', { length: 20 })
  @ApiProperty({
    description: 'Chế độ điều kiện tiếp nhận của workflow tại thời điểm tra',
  })
  mode: EligibilityMode;

  @Column('varchar', { length: 20 })
  @ApiProperty({
    description: 'Nguồn thực sự quyết định kết quả (NONE|ROSTER|EXTERNAL_API)',
  })
  source: EligibilitySource;

  @Column('boolean')
  @ApiProperty()
  eligible: boolean;

  @Column('text', { nullable: true })
  @ApiPropertyOptional()
  reason?: string | null;

  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({
    description: 'Dữ liệu (roster + API, tùy mode) dùng để đánh giá rule',
  })
  context?: Record<string, unknown> | null;

  @Column('timestamptz', { name: 'checked_at' })
  @ApiProperty()
  checkedAt: Date;
}
