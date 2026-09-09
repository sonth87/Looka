import { CustomException, ERROR_CODE } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import { Pagination } from '@app/modules/shared/common/pagination';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SessionSource } from '../capture.constants';
import {
  StudentDetailDao,
  StudentListItemDao,
  StudentSessionPhotoDao,
  StudentSessionSummaryDao,
  StudentSessionVideoDao,
} from '../dao';
import { ListStudentsQueryDto } from '../dto';

/**
 * "Sinh viên đã chụp" (2026-09-08 feature) — groups the same `sessions`/
 * `photos`/`session_videos` tables `SessionService` already reads, by
 * `subject_code` instead of by session id. See that service's
 * `listSessions()`/`getSessionDetail()` for the raw-SQL/CTE style this
 * mirrors.
 */
@Injectable()
export class StudentService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
  ) {}

  /**
   * Paginated, one row per distinct `subject_code` — sessions with no
   * subject at all (nobody looked up an identity for that run) are excluded
   * entirely, since there is nothing to group them under.
   *
   * When `campaignId` is supplied, the aggregates (`sessionCount`,
   * `totalPhotos`, `lastCapturedAt`, `campaignIds`) are computed only over
   * that campaign's sessions for the student — narrowing the underlying set,
   * not "global stats with a filtered view" — mirroring how `deviceId`
   * already narrows `SessionService.listSessions()`.
   */
  async listStudents(
    query: ListStudentsQueryDto,
  ): Promise<Pagination<StudentListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['s.subject_code IS NOT NULL'];
    const params: unknown[] = [];

    if (query.campaignId) {
      params.push(query.campaignId);
      conditions.push(`s.campaign_id = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(
        `(s.subject_code ILIKE $${params.length} OR s.subject_name ILIKE $${params.length})`,
      );
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    // `last_session`/`last_session_photos` add the per-student "most recent
    // session" (§3.8.2/Q19 of the discussion doc) on top of the existing
    // `agg` grouping, applying the exact same `${where}` filter so a
    // campaign-scoped list only ever surfaces a last session within that
    // campaign. `last_session` is DISTINCT ON (subject_code) - one row per
    // student, same cardinality as `agg` - so joining it in does not change
    // how many rows either the count or the paginated query returns; the
    // `deviceName` join mirrors `StudentService.getStudentDetail()`'s own
    // per-session `devices` join exactly, just narrowed to one session.
    const cte = `
      WITH agg AS (
        SELECT
          s.subject_code,
          (ARRAY_AGG(s.subject_name ORDER BY COALESCE(s.captured_at, s.created_at) DESC)
            FILTER (WHERE s.subject_name IS NOT NULL))[1] AS subject_name,
          COUNT(DISTINCT s.id)::int AS session_count,
          COUNT(p.id)::int AS total_photos,
          MAX(COALESCE(s.captured_at, s.created_at)) AS last_captured_at,
          ARRAY_AGG(DISTINCT s.campaign_id) FILTER (WHERE s.campaign_id IS NOT NULL) AS campaign_ids
        FROM sessions s
        LEFT JOIN photos p ON p.session_id = s.id
        ${where}
        GROUP BY s.subject_code
      ),
      last_session AS (
        SELECT DISTINCT ON (s.subject_code)
          s.subject_code,
          s.id AS session_id,
          d.name AS device_name,
          COALESCE(s.captured_at, s.created_at) AS captured_at
        FROM sessions s
        LEFT JOIN devices d ON d.id = s.device_id
        ${where}
        ORDER BY s.subject_code, COALESCE(s.captured_at, s.created_at) DESC
      ),
      last_session_photos AS (
        SELECT p.session_id, COUNT(*)::int AS photo_count
        FROM photos p
        WHERE p.session_id IN (SELECT session_id FROM last_session)
        GROUP BY p.session_id
      )
      SELECT
        agg.*,
        last_session.device_name AS last_session_device_name,
        last_session.captured_at AS last_session_captured_at,
        COALESCE(last_session_photos.photo_count, 0) AS last_session_photo_count
      FROM agg
      LEFT JOIN last_session ON last_session.subject_code = agg.subject_code
      LEFT JOIN last_session_photos ON last_session_photos.session_id = last_session.session_id
    `;

    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM (${cte}) t`,
      params,
    );
    const totalItems = countRows[0]?.count ?? 0;

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `${cte} ORDER BY last_captured_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const items = toDao(
      StudentListItemDao,
      rows.map((row) => ({
        subjectCode: row.subject_code,
        subjectName: row.subject_name ?? undefined,
        sessionCount: row.session_count,
        totalPhotos: row.total_photos,
        lastCapturedAt: row.last_captured_at ?? undefined,
        campaignIds: (row.campaign_ids as string[] | null) ?? [],
        lastSession: {
          deviceName:
            (row.last_session_device_name as string | null) ?? undefined,
          capturedAt:
            (row.last_session_captured_at as Date | null) ?? undefined,
          photoCount: (row.last_session_photo_count as number | null) ?? 0,
        },
      })),
    );

    return new Pagination(items, {
      itemCount: items.length,
      totalItems,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    });
  }

  /**
   * Every session this student has, on every campaign — deliberately ignores
   * whatever campaign filter the caller used to reach the list page, since
   * grouping by student exists specifically to show their full history.
   *
   * Photos/videos are embedded with a `viewUrl` already resolved (best
   * effort — a failed link issue just leaves that one `viewUrl` empty
   * instead of failing the whole request), because the two callers this
   * endpoint serves are the CMS (which could reach the existing per-photo
   * view-link routes itself, but doesn't need a second round trip) and
   * apps/web (which has no SSO token and would otherwise have no authorized
   * way to reach `POST /v1/photos/:id/view-link`/`POST /v1/videos/:id/view-link`
   * at all — see `StudentController`'s own doc comment). Resolving here, at
   * the service layer, means neither of those existing routes needs to
   * widen its own guard to accommodate apps/web.
   */
  async getStudentDetail(subjectCode: string): Promise<StudentDetailDao> {
    const sessionRows: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT
          s.id, s.source, s.device_id, d.name AS device_name, s.campaign_id,
          s.subject_code, s.subject_name, s.status,
          s.captured_at, s.completed_at, s.approved_at
         FROM sessions s
         LEFT JOIN devices d ON d.id = s.device_id
        WHERE s.subject_code = $1
        ORDER BY COALESCE(s.captured_at, s.created_at) DESC`,
        [subjectCode],
      );

    if (sessionRows.length === 0) {
      throw new CustomException(
        'Student not found',
        ERROR_CODE.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const sessionIds = sessionRows.map((r) => r.id as string);

    const photoRows: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT id, session_id, camera_role, mime_type, fs_file_id, fs_status
         FROM photos WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );
    const videoRows: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT id, session_id, camera_role, mime_type, duration_ms, fs_file_id, fs_status
         FROM session_videos WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      );

    const tenantForSession = (
      row: Record<string, unknown>,
    ): string | undefined =>
      row.source === SessionSource.KIOSK && row.device_id
        ? (row.device_id as string)
        : undefined;
    const tenantBySessionId = new Map(
      sessionRows.map((r) => [r.id as string, tenantForSession(r)]),
    );

    const resolveLink = async (
      fsFileId: string | null,
      tenantName: string | undefined,
    ) => {
      if (!fsFileId) return null;
      try {
        return await this.fileStorage.issueViewLink(
          fsFileId,
          'students-gallery',
          tenantName,
        );
      } catch {
        // Best-effort — see this method's own doc comment. A photo/video
        // that isn't ready or whose file-service call fails just shows with
        // no viewUrl, same as SessionDetailDrawer's own `not_ready`/`error`
        // states on the CMS side.
        return null;
      }
    };

    const photoLinks = await Promise.all(
      photoRows.map((p) =>
        resolveLink(
          p.fs_file_id as string | null,
          tenantBySessionId.get(p.session_id as string),
        ),
      ),
    );
    const videoLinks = await Promise.all(
      videoRows.map((v) =>
        resolveLink(
          v.fs_file_id as string | null,
          tenantBySessionId.get(v.session_id as string),
        ),
      ),
    );

    const photosBySession = new Map<string, StudentSessionPhotoDao[]>();
    photoRows.forEach((p, i) => {
      const list = photosBySession.get(p.session_id as string) ?? [];
      const link = photoLinks[i];
      list.push({
        id: p.id as string,
        cameraRole: (p.camera_role as string | null) ?? undefined,
        mimeType: p.mime_type as string,
        fsStatus: (p.fs_status as string | null) ?? undefined,
        viewUrl: link?.url,
        viewUrlExpiresAt: link?.expiresAt,
      });
      photosBySession.set(p.session_id as string, list);
    });

    const videosBySession = new Map<string, StudentSessionVideoDao[]>();
    videoRows.forEach((v, i) => {
      const list = videosBySession.get(v.session_id as string) ?? [];
      const link = videoLinks[i];
      list.push({
        id: v.id as string,
        cameraRole: (v.camera_role as string | null) ?? undefined,
        mimeType: v.mime_type as string,
        durationMs: (v.duration_ms as number | null) ?? undefined,
        fsStatus: (v.fs_status as string | null) ?? undefined,
        viewUrl: link?.url,
        viewUrlExpiresAt: link?.expiresAt,
      });
      videosBySession.set(v.session_id as string, list);
    });

    const sessions: StudentSessionSummaryDao[] = sessionRows.map((row) =>
      toDao(StudentSessionSummaryDao, {
        id: row.id,
        source: row.source,
        deviceId: row.device_id ?? undefined,
        deviceName: row.device_name ?? undefined,
        campaignId: row.campaign_id ?? undefined,
        status: row.status,
        capturedAt: row.captured_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
        approvedAt: row.approved_at ?? undefined,
        photos: photosBySession.get(row.id as string) ?? [],
        videos: videosBySession.get(row.id as string) ?? [],
      }),
    );

    return toDao(StudentDetailDao, {
      subjectCode,
      subjectName:
        (sessionRows.find((r) => r.subject_name)?.subject_name as
          string | undefined) ?? undefined,
      sessions,
    });
  }
}
