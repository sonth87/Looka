import { SqlExecutor } from '../sql/SqlDriver.js';

export interface AttendanceRecordParams {
  id: string;
  personId: string;
  attendanceSessionId: string;
  timestamp: number;
  type?: 'CHECK_IN' | 'CHECK_OUT';
  identityScore: number;
  /** null when liveness was not evaluated. Never fabricate a passing score. */
  livenessScore: number | null;
  /** null when quality was not measured for this frame. */
  qualityScore: number | null;
  modelVersion: string;
  policyVersion: string;
  deviceId: string;
  /** 'YYYY-MM-DD'. Computed by the caller via businessDayOf(). */
  businessDay: string;
}

export interface LastAttendance {
  attendanceId: string;
  timestamp: number;
  type: string;
}

/** Pinned per FIX-PLAN.md step 16 — business-day boundaries must not depend on host OS timezone. */
const BUSINESS_DAY_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Working day of a timestamp.
 *
 * A shift ending at 02:00 belongs to the previous working day, so the day
 * boundary is not midnight. Default 4am covers typical night shifts; make it
 * configurable per deployment if a site runs a different roster.
 */
export function businessDayOf(timestamp: number, dayStartHour = 4): string {
  // Explicit IANA zone, not the host process's local time — a kiosk with its
  // OS clock set to the wrong timezone (or a build running in CI/dev on a
  // developer's machine) must still bucket attendance the same way
  // production does. See FIX-PLAN.md step 16.
  const shifted = new Date(timestamp - dayStartHour * 3600_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_DAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export class AttendanceRepository {
  constructor(private db: SqlExecutor) {}

  /**
   * Insert the attendance record and its sync queue item atomically.
   *
   * Both or neither: a record written without its queue item would never reach
   * the server and nothing would report it as missing.
   */
  public recordAttendance(params: AttendanceRecordParams): void {
    const type = params.type ?? 'CHECK_IN';
    const createdAt = Date.now();

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO attendance_records (
           id, person_id, attendance_session_id, timestamp, type,
           identity_score, liveness_score, quality_score,
           model_version, policy_version, device_id, sync_status, business_day, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        [
          params.id,
          params.personId,
          params.attendanceSessionId,
          params.timestamp,
          type,
          params.identityScore,
          params.livenessScore,
          params.qualityScore,
          params.modelVersion,
          params.policyVersion,
          params.deviceId,
          params.businessDay,
          createdAt,
        ]
      );

      // Queue id derives from the attendance id so a retry after a crash cannot
      // enqueue the same event twice.
      this.db.run(
        `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, status, retry_count, created_at)
         VALUES (?, 'ATTENDANCE_RECORD', ?, 'CREATE', ?, 'PENDING', 0, ?)`,
        [`sync_${params.id}`, params.id, JSON.stringify({ ...params, type }), createdAt]
      );
    });
  }

  /** Most recent event for a person, optionally restricted to one type. */
  public getLastAttendance(personId: string, type?: 'CHECK_IN' | 'CHECK_OUT'): LastAttendance | null {
    const rows = type
      ? this.db.exec<{ id: string; timestamp: number; type: string }>(
          'SELECT id, timestamp, type FROM attendance_records WHERE person_id = ? AND type = ? ORDER BY timestamp DESC LIMIT 1',
          [personId, type]
        )
      : this.db.exec<{ id: string; timestamp: number; type: string }>(
          'SELECT id, timestamp, type FROM attendance_records WHERE person_id = ? ORDER BY timestamp DESC LIMIT 1',
          [personId]
        );

    if (rows.length === 0) return null;
    return { attendanceId: rows[0].id, timestamp: rows[0].timestamp, type: rows[0].type };
  }

  /** Existing event for this person/type on a given working day, if any. */
  public findByBusinessDay(
    personId: string,
    type: 'CHECK_IN' | 'CHECK_OUT',
    businessDay: string
  ): LastAttendance | null {
    const rows = this.db.exec<{ id: string; timestamp: number; type: string }>(
      'SELECT id, timestamp, type FROM attendance_records WHERE person_id = ? AND type = ? AND business_day = ? LIMIT 1',
      [personId, type, businessDay]
    );
    if (rows.length === 0) return null;
    return { attendanceId: rows[0].id, timestamp: rows[0].timestamp, type: rows[0].type };
  }

  public countPendingSync(): number {
    const rows = this.db.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'PENDING'"
    );
    return Number(rows[0]?.n ?? 0);
  }
}
