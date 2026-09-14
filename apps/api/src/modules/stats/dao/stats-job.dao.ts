import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { StatsJobKind, StatsJobStatus } from '../stats.constants';

export class StatsJobDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty({ enum: ['SNAPSHOT_REFRESH', 'DAILY_RECOMPUTE', 'REBUILD'] })
  @Expose()
  kind: StatsJobKind;

  @ApiPropertyOptional()
  @Expose()
  rangeFrom?: string | null;

  @ApiPropertyOptional()
  @Expose()
  rangeTo?: string | null;

  @ApiPropertyOptional()
  @Expose()
  scope?: Record<string, unknown> | null;

  @ApiProperty({ enum: ['RUNNING', 'DONE', 'FAILED'] })
  @Expose()
  status: StatsJobStatus;

  @ApiProperty()
  @Expose()
  startedAt: Date;

  @ApiPropertyOptional()
  @Expose()
  finishedAt?: Date | null;

  @ApiProperty()
  @Expose()
  rowsWritten: number;

  @ApiPropertyOptional()
  @Expose()
  error?: string | null;

  @ApiPropertyOptional()
  @Expose()
  triggeredByUserId?: string | null;
}

export class StatsJobStatusDao {
  @ApiPropertyOptional()
  lastRunAt: Date | null;

  @ApiPropertyOptional()
  lastStatus: string | null;

  @ApiProperty()
  overdue: boolean;
}

export class StatsHealthDao {
  @ApiProperty({ type: StatsJobStatusDao })
  snapshotRefresh: StatsJobStatusDao;

  @ApiProperty({ type: StatsJobStatusDao })
  dailyRecompute: StatsJobStatusDao;
}
