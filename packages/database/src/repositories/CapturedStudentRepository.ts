import { SqlExecutor } from '../sql/SqlDriver.js';

export interface CapturedStudentItem {
  sessionId: string;
  subjectCode: string;
  subjectName: string | null;
  className: string | null;
  major: string | null;
  academicYear: string | null;
  workflowId: string | null;
  photoCount: number;
  approvedAt: number;
  createdAt: number;
}

export interface RecordApprovalInput {
  sessionId: string;
  subjectCode: string;
  subjectName?: string | null;
  className?: string | null;
  major?: string | null;
  academicYear?: string | null;
  workflowId?: string | null;
  photoCount: number;
  approvedAt: number;
}

function toItem(r: Record<string, unknown>): CapturedStudentItem {
  return {
    sessionId: String(r.session_id),
    subjectCode: String(r.subject_code),
    subjectName: r.subject_name ? String(r.subject_name) : null,
    className: r.class_name ? String(r.class_name) : null,
    major: r.major ? String(r.major) : null,
    academicYear: r.academic_year ? String(r.academic_year) : null,
    workflowId: r.workflow_id ? String(r.workflow_id) : null,
    photoCount: Number(r.photo_count ?? 0),
    approvedAt: Number(r.approved_at),
    createdAt: Number(r.created_at),
  };
}

/**
 * Local "sinh viên đã chụp" index backing the kiosk's own hidden
 * `#recent-students` screen — see migration 010's own doc comment for why
 * this exists as a table of its own rather than reusing `upload_outbox` or
 * `SessionRepository`'s KV store. Read-only from the API's point of view:
 * nothing here is ever reported centrally — it exists purely so the kiosk
 * can show "recent students" and "this student's sessions" without any
 * network round trip.
 */
export class CapturedStudentRepository {
  constructor(private db: SqlExecutor) {}

  /**
   * Called once per successful approval (`approveSessionUpload()` in
   * apps/desktop's uploads.ts), only when the session actually carries a
   * subjectCode. `ON CONFLICT(session_id) DO UPDATE` rather than
   * `DO NOTHING`: a session can only be approved with a given identity once
   * in practice (the caller's own `result.approved > 0` gate already makes a
   * repeat approve a no-op upstream of this), but upserting is free
   * insurance against ever double-recording a stale row if that gate is
   * ever relaxed.
   */
  public recordApproval(input: RecordApprovalInput): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO captured_students (
         session_id, subject_code, subject_name, class_name, major, academic_year,
         workflow_id, photo_count, approved_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         subject_code = excluded.subject_code,
         subject_name = excluded.subject_name,
         class_name = excluded.class_name,
         major = excluded.major,
         academic_year = excluded.academic_year,
         workflow_id = excluded.workflow_id,
         photo_count = excluded.photo_count,
         approved_at = excluded.approved_at`,
      [
        input.sessionId,
        input.subjectCode,
        input.subjectName ?? null,
        input.className ?? null,
        input.major ?? null,
        input.academicYear ?? null,
        input.workflowId ?? null,
        input.photoCount,
        input.approvedAt,
        now,
      ]
    );
  }

  /**
   * One row per distinct student — their single most recently approved
   * session — newest first. The correlated subquery (rather than a plain
   * `GROUP BY subject_code`) is what lets every other column come from that
   * specific latest row instead of an arbitrary/aggregated one, since SQLite
   * (unlike Postgres) has no `DISTINCT ON`.
   */
  public listRecentStudents(limit = 50): CapturedStudentItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT * FROM captured_students o
        WHERE o.approved_at = (
          SELECT MAX(i.approved_at) FROM captured_students i WHERE i.subject_code = o.subject_code
        )
        ORDER BY o.approved_at DESC
        LIMIT ?`,
      [limit]
    );
    return rows.map(toItem);
  }

  /** Every local session for one student, newest first — surfaces retakes across days, not just their latest run. */
  public listByStudent(subjectCode: string): CapturedStudentItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT * FROM captured_students WHERE subject_code = ? ORDER BY approved_at DESC`,
      [subjectCode]
    );
    return rows.map(toItem);
  }

  /**
   * Case-insensitive match on code or name, for the recent-students screen's
   * own search box — mirrors `lookupStudent()`'s case/whitespace-insensitive
   * matching rule (packages/ui's studentLookup.ts) so a search here behaves
   * the same way the ID-entry screen's own lookup does.
   */
  public search(query: string, limit = 20): CapturedStudentItem[] {
    const needle = `%${query.trim()}%`;
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT * FROM captured_students o
        WHERE o.approved_at = (
          SELECT MAX(i.approved_at) FROM captured_students i WHERE i.subject_code = o.subject_code
        )
        AND (o.subject_code LIKE ? COLLATE NOCASE OR o.subject_name LIKE ? COLLATE NOCASE)
        ORDER BY o.approved_at DESC
        LIMIT ?`,
      [needle, needle, limit]
    );
    return rows.map(toItem);
  }
}
