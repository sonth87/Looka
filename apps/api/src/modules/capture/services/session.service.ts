import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { CommonService } from '@app/modules/shared/common/common.service';
import { Pagination } from '@app/modules/shared/common/pagination';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SessionListState, SessionStatus } from '../capture.constants';
import { SessionDao, SessionDetailDao, SessionListItemDao } from '../dao';
import { CreateSessionDto, ListSessionsQueryDto } from '../dto';
import { Session } from '../entities/session.entity';

@Injectable()
export class SessionService extends CommonService<Session> {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(Session)
    repository: Repository<Session>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
  ) {
    super(repository);
  }

  async createSession(dto: CreateSessionDto): Promise<SessionDao> {
    const session = await this.create({
      subjectCode: dto.subjectCode,
      subjectName: dto.subjectName,
      status: SessionStatus.IN_PROGRESS,
      metadata: dto.metadata ?? {},
    });

    return toDao(SessionDao, session);
  }

  async findByIdOrFail(id: string): Promise<Session> {
    const session = await this.findById(id);
    if (!session) {
      throw new CustomException(
        'Session not found',
        ERROR_CODE.SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return session;
  }

  /** Used by `CampaignService.deleteCampaign` to refuse deleting a campaign that still has capture history attached — see that method's own doc comment. */
  async countByCampaign(campaignId: string): Promise<number> {
    return this.count({ where: { campaignId } });
  }

  /**
   * Mark a run finished. Idempotent: a browser that retries after a dropped
   * response must not turn an already-completed session into an error.
   *
   * Aligns the web path with decision 1 (A.4): only the highest attempt per
   * step is worth keeping, so completion is also the point where every other
   * attempt's photo - and, if it already reached the file-service, its
   * remote copy too - is removed. Approving here (rather than at capture
   * time) mirrors the kiosk's own review-then-approve flow, and is what
   * `UploadWorkerService.claimNext()` now requires before sending anything.
   */
  async completeSession(id: string): Promise<SessionDao> {
    const session = await this.findByIdOrFail(id);

    let supersededFsFileIds: string[] = [];

    if (session.status !== SessionStatus.COMPLETED) {
      await this.dataSource.transaction(async (manager) => {
        // Approve only the outbox row of the highest attempt per step - the
        // only photo that survives the DELETE right below.
        await manager.query(
          `UPDATE upload_outbox o
              SET approved_at = now()
             FROM (
               SELECT DISTINCT ON (p.step_id) o2.id
                 FROM photos p
                 JOIN upload_outbox o2 ON o2.photo_id = p.id
                WHERE p.session_id = $1
                ORDER BY p.step_id, p.attempt DESC
             ) latest
            WHERE o.id = latest.id`,
          [id],
        );

        // Deletes every attempt except the highest per step; the FK cascade
        // (upload_outbox.photo_id ON DELETE CASCADE) removes their outbox
        // rows too. RETURNING tells us which of the deleted photos had
        // already reached the file-service, for the best-effort cleanup
        // below.
        //
        // TypeORM's query() wraps an UPDATE/DELETE's result as
        // `[rows, rowCount]` regardless of RETURNING and regardless of
        // DataSource vs EntityManager - only INSERT (PhotoService.addPhoto's
        // pattern) gets a flat rows array back. Destructuring straight into
        // a typed rows array here (as if this were an INSERT) silently gave
        // `superseded` the two-element tuple instead, so every
        // `row.fs_file_id` read undefined and the best-effort delete below
        // never fired - caught only by this file's own persistence test.
        const [superseded]: [
          Array<{ id: string; fs_file_id: string | null }>,
          number,
        ] = await manager.query(
          `DELETE FROM photos
               WHERE session_id = $1
                 AND id NOT IN (
                   SELECT DISTINCT ON (step_id) id
                     FROM photos
                    WHERE session_id = $1
                    ORDER BY step_id, attempt DESC
                 )
             RETURNING id, fs_file_id`,
          [id],
        );
        supersededFsFileIds = superseded
          .map((row) => row.fs_file_id)
          .filter((fsFileId): fsFileId is string => !!fsFileId);

        session.status = SessionStatus.COMPLETED;
        session.completedAt = new Date();
        await this.saveWithTransaction(manager, session);
      });

      // Best-effort and outside the transaction on purpose: a file-service
      // hiccup here must not roll back a completion the operator already
      // confirmed - the Postgres row is gone either way, this is only
      // trying not to leave an orphan on the file-service as well.
      for (const fsFileId of supersededFsFileIds) {
        await this.fileStorage.deleteFile(fsFileId).catch((err) => {
          this.logger.warn(
            `best-effort delete failed for superseded photo ${fsFileId}: ${(err as Error).message}`,
          );
        });
      }
    }

    return toDao(SessionDao, session);
  }

  /**
   * `GET /v1/sessions` - paginated, filterable list across both capture
   * paths (A.6). Photo counts are derived at query time rather than stored -
   * see `SessionListItemDao`'s own doc comment for the exact
   * ready/pending/failed definitions this and `getSessionDetail` both use.
   */
  async listSessions(
    query: ListSessionsQueryDto,
  ): Promise<Pagination<SessionListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const { where, params } = this.buildSessionListFilter(query);
    const stateFilter = this.stateFilterClause(query.state);

    // A CTE rather than a plain GROUP BY: `state` filters on the aggregated
    // photo counts (photos_failed/photos_ready/photo_count), and those are
    // not available to a WHERE clause on the same query that computes them -
    // materialising them first lets the state filter read them as plain
    // columns instead of repeating every FILTER expression in a HAVING.
    const cte = `
      WITH agg AS (
        SELECT
          s.id, s.source, s.device_id, d.name AS device_name, s.campaign_id,
          s.subject_code, s.subject_name, s.status,
          s.captured_at, s.completed_at, s.approved_at, s.created_at,
          COUNT(p.id)::int AS photo_count,
          COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS photos_ready,
          COUNT(*) FILTER (
            WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
          )::int AS photos_failed
        FROM sessions s
        LEFT JOIN devices d ON d.id = s.device_id
        LEFT JOIN photos p ON p.session_id = s.id
        ${where}
        GROUP BY s.id, d.name
      )
      SELECT *, (photo_count - photos_ready - photos_failed) AS photos_pending
        FROM agg
      ${stateFilter}
    `;

    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM (${cte}) t`,
      params,
    );
    const totalItems = countRows[0]?.count ?? 0;

    const rows: unknown[] = await this.dataSource.query(
      `${cte} ORDER BY COALESCE(captured_at, created_at) DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const items = toDao(
      SessionListItemDao,
      rows.map((row) => this.mapListRow(row as Record<string, unknown>)),
    );

    return new Pagination(items, {
      itemCount: items.length,
      totalItems,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    });
  }

  /** `GET /v1/sessions/:id` - the list row's fields plus every photo (A.6). */
  async getSessionDetail(id: string): Promise<SessionDetailDao> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT
          s.id, s.source, s.device_id, d.name AS device_name, s.campaign_id,
          s.subject_code, s.subject_name, s.status,
          s.captured_at, s.completed_at, s.approved_at,
          COUNT(p.id)::int AS photo_count,
          COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS photos_ready,
          COUNT(*) FILTER (
            WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
          )::int AS photos_failed
         FROM sessions s
         LEFT JOIN devices d ON d.id = s.device_id
         LEFT JOIN photos p ON p.session_id = s.id
        WHERE s.id = $1
        GROUP BY s.id, d.name`,
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw new CustomException(
        'Session not found',
        ERROR_CODE.SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const photoRows: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT id, step_id, step_type, camera_role, attempt, mime_type, bytes,
              fs_file_id, fs_status, local_status, virtual_path,
              captured_at, uploaded_at, ready_at, upload_error
         FROM photos
        WHERE session_id = $1
        ORDER BY step_id, attempt`,
        [id],
      );

    return toDao(SessionDetailDao, {
      ...this.mapListRow(row),
      photos: photoRows.map((p) => ({
        id: p.id,
        stepId: p.step_id,
        stepType: p.step_type ?? undefined,
        cameraRole: p.camera_role ?? undefined,
        attempt: p.attempt,
        mimeType: p.mime_type,
        bytes: p.bytes,
        fsFileId: p.fs_file_id ?? undefined,
        fsStatus: p.fs_status ?? undefined,
        localStatus: p.local_status ?? undefined,
        virtualPath: p.virtual_path ?? undefined,
        capturedAt: p.captured_at ?? undefined,
        uploadedAt: p.uploaded_at ?? undefined,
        readyAt: p.ready_at ?? undefined,
        uploadError: p.upload_error ?? undefined,
      })),
    });
  }

  private mapListRow(row: Record<string, unknown>) {
    return {
      id: row.id,
      source: row.source,
      deviceId: row.device_id ?? undefined,
      deviceName: row.device_name ?? undefined,
      campaignId: row.campaign_id ?? undefined,
      subjectCode: row.subject_code ?? undefined,
      subjectName: row.subject_name ?? undefined,
      status: row.status,
      capturedAt: row.captured_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      approvedAt: row.approved_at ?? undefined,
      photoCount: row.photo_count,
      photosReady: row.photos_ready,
      photosPending: row.photos_pending,
      photosFailed: row.photos_failed,
    };
  }

  private buildSessionListFilter(query: ListSessionsQueryDto): {
    where: string;
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.campaignId) {
      params.push(query.campaignId);
      conditions.push(`s.campaign_id = $${params.length}`);
    }
    if (query.deviceId) {
      params.push(query.deviceId);
      conditions.push(`s.device_id = $${params.length}`);
    }
    if (query.source) {
      params.push(query.source);
      conditions.push(`s.source = $${params.length}`);
    }
    if (query.from) {
      params.push(new Date(query.from));
      conditions.push(
        `COALESCE(s.captured_at, s.created_at) >= $${params.length}`,
      );
    }
    if (query.to) {
      params.push(new Date(query.to));
      conditions.push(
        `COALESCE(s.captured_at, s.created_at) <= $${params.length}`,
      );
    }

    return {
      where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * `state` is not stored - it is derived from the same photo counts the
   * list already computes (A.5/A.6): "failed" wins if any photo failed,
   * "completed" needs every photo ready, everything else is "pending".
   */
  private stateFilterClause(state?: SessionListState): string {
    switch (state) {
      case SessionListState.FAILED:
        return 'WHERE photos_failed > 0';
      case SessionListState.COMPLETED:
        return 'WHERE photos_failed = 0 AND photo_count > 0 AND photos_ready = photo_count';
      case SessionListState.PENDING:
        return 'WHERE photos_failed = 0 AND NOT (photo_count > 0 AND photos_ready = photo_count)';
      default:
        return '';
    }
  }
}
