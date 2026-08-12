import { SQLiteStorageAdapter } from '../SQLiteStorageAdapter.js';

export interface AttendanceRecordParams {
  id: string;
  personId: string;
  attendanceSessionId: string;
  timestamp: number;
  type?: 'CHECK_IN' | 'CHECK_OUT';
  identityScore: number;
  livenessScore: number;
  qualityScore: number;
  modelVersion: string;
  policyVersion: string;
  deviceId: string;
}

export class AttendanceRepository {
  constructor(private adapter: SQLiteStorageAdapter) {}

  public async recordAttendance(params: AttendanceRecordParams): Promise<void> {
    const type = params.type || 'CHECK_IN';
    const createdAt = Date.now();

    // 1. Insert attendance record
    this.adapter.run(
      `INSERT INTO attendance_records (
        id, person_id, attendance_session_id, timestamp, type,
        identity_score, liveness_score, quality_score, model_version, policy_version, device_id, sync_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
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
        createdAt,
      ]
    );

    // 2. Insert into sync queue
    const syncId = `sync_${createdAt}_${Math.random().toString(36).substring(2, 7)}`;
    this.adapter.run(
      `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, status, retry_count, created_at)
       VALUES (?, 'ATTENDANCE_RECORD', ?, 'CREATE', ?, 'PENDING', 0, ?)`,
      [syncId, params.id, JSON.stringify(params), createdAt]
    );
  }

  public async getLastAttendance(personId: string): Promise<{ timestamp: number; attendanceId: string } | null> {
    const rows = this.adapter.exec(
      'SELECT id, timestamp FROM attendance_records WHERE person_id = ? ORDER BY timestamp DESC LIMIT 1',
      [personId]
    );

    if (rows.length === 0) return null;
    return {
      attendanceId: rows[0].id as string,
      timestamp: rows[0].timestamp as number,
    };
  }
}
