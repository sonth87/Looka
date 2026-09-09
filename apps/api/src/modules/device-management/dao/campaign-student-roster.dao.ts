import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/** `GET /v1/campaigns/:id/roster` (list, admin/CMS) — one roster row. */
export class CampaignStudentRosterDao {
  @ApiProperty({ description: 'Roster row id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  studentCode: string;

  @ApiProperty()
  @Expose()
  studentName: string;

  @ApiProperty({ description: 'Số CCCD — khoá đối chiếu khi quét thẻ' })
  @Expose()
  citizenId: string;

  @ApiPropertyOptional()
  @Expose()
  className?: string | null;

  @ApiPropertyOptional()
  @Expose()
  major?: string | null;

  @ApiPropertyOptional()
  @Expose()
  academicYear?: string | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}

/**
 * One row's outcome from `POST /v1/campaigns/:id/roster/import` — surfaced
 * so the CMS import screen can point out which lines of the uploaded CSV
 * were skipped and why, without a second round trip.
 */
export class RosterImportRowErrorDao {
  @ApiProperty({ description: 'CSV line number (1 = the header row)' })
  @Expose()
  line: number;

  @ApiProperty()
  @Expose()
  reason: string;
}

/** Result of a CSV roster import — see `CampaignStudentRosterService.importRoster`'s own doc comment for exactly what counts as "imported" vs an error row. */
export class RosterImportResultDao {
  @ApiProperty({ description: 'Data rows found in the CSV (header excluded)' })
  @Expose()
  totalRows: number;

  @ApiProperty({ description: 'Rows successfully inserted or updated (upserted by citizenId within this campaign)' })
  @Expose()
  imported: number;

  @ApiProperty({ type: [RosterImportRowErrorDao] })
  @Expose()
  errors: RosterImportRowErrorDao[];
}

/**
 * `GET /v1/campaigns/:id/roster/lookup?citizenId=...` — the kiosk's own
 * call, made the moment `apps/desktop/src/main/cccdWatcher.ts` reports a
 * freshly scanned CCCD number. `found: false` is a normal, expected result
 * (not an error/404) — a scan simply not matching anyone on this campaign's
 * roster — so the kiosk can branch on it directly without parsing an
 * exception.
 */
export class RosterLookupResultDao {
  @ApiProperty()
  @Expose()
  found: boolean;

  @ApiPropertyOptional()
  @Expose()
  studentCode?: string;

  @ApiPropertyOptional()
  @Expose()
  studentName?: string;

  @ApiPropertyOptional()
  @Expose()
  className?: string;

  @ApiPropertyOptional()
  @Expose()
  major?: string;

  @ApiPropertyOptional()
  @Expose()
  academicYear?: string;

  @ApiPropertyOptional()
  @Expose()
  citizenId?: string;
}
