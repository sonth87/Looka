import { PhotoReviewSidecarService } from '@app/modules/photo-review/services/photo-review-sidecar.service';
import { StatsJobService } from '@app/modules/stats/services/stats-job.service';
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

const REACHABILITY_TIMEOUT_MS = 3_000;
/** Outbox rows in these states are still work-in-progress, not yet drained — `DONE`/`UPLOADED`/`FAILED` don't count toward backlog (a stuck `FAILED` row is a different, already-visible-elsewhere problem, not backlog). */
const OUTBOX_PENDING_STATUSES = ['PENDING', 'SENDING'];

@Controller()
export class AppController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly sidecar: PhotoReviewSidecarService,
    private readonly statsJobService: StatsJobService,
  ) {}

  /**
   * Consolidated health (plan §8 I-Q9 — "Health tổng hợp {db, fileService,
   * sidecar, sso, statsLag, outboxBacklog} + trạng thái DEGRADED có lý do").
   * Every dependency check is a real network/DB probe, never a constant —
   * same "answer honestly, not ONLINE-by-default" principle this endpoint
   * already followed for `database` alone before this pass. `fileService`/
   * `sso` are bare reachability pings (no valid request exists to make
   * without a real file id/user token at hand) — a 4xx/5xx still counts as
   * "reachable" (the process answered), only a connection-level failure
   * (timeout, refused, DNS) counts as down; `sidecar` reuses its own real
   * `/health` route via `PhotoReviewSidecarService.health()`; `statsLag`
   * reuses `StatsJobService.health()` (already built in P4, not
   * reimplemented here); `outboxBacklog` is a real `COUNT` across the three
   * outbox tables, not an estimate.
   *
   * `status` is `DEGRADED` (with each failing check named in `reasons`)
   * whenever ANY dependency is down or health data is stale — never a
   * single boolean hiding which one broke.
   */
  @Get('health')
  async health() {
    const [database, fileService, sso, sidecar, statsJobHealth, outboxBacklog] =
      await Promise.all([
        this.checkDatabase(),
        this.checkReachable(
          this.configService.get<string>('fileService.baseUrl'),
        ),
        this.checkReachable(
          this.configService.get<string>('security.ssoBaseUrl'),
        ),
        this.sidecar.health(),
        this.statsJobService.health(),
        this.outboxBacklog(),
      ]);

    const reasons: string[] = [];
    if (!database) reasons.push('database unreachable');
    if (fileService.status === 'DOWN') reasons.push('fileService unreachable');
    if (sso.status === 'DOWN') reasons.push('sso unreachable');
    if (!sidecar.reachable) reasons.push('sidecar unreachable');
    if (statsJobHealth.snapshotRefresh.overdue)
      reasons.push('stats snapshotRefresh overdue');
    if (statsJobHealth.dailyRecompute.overdue)
      reasons.push('stats dailyRecompute overdue');

    return {
      status: reasons.length === 0 ? 'ONLINE' : 'DEGRADED',
      reasons,
      database,
      fileService,
      sso,
      sidecar,
      statsLag: statsJobHealth,
      outboxBacklog,
      appName: this.configService.get<string>('app.appName'),
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    if (!this.dataSource.isInitialized) return false;
    return this.dataSource.query('SELECT 1').then(
      () => true,
      () => false,
    );
  }

  /** No valid unauthenticated request exists against either dependency, so this only asks "did the process answer at all" — `configured: false` when the base URL itself is unset (a deployment choice, not a failure). */
  private async checkReachable(
    baseUrl: string | undefined,
  ): Promise<{ status: 'UP' | 'DOWN' | 'UNCONFIGURED'; error?: string }> {
    if (!baseUrl) return { status: 'UNCONFIGURED' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    try {
      await fetch(baseUrl, { signal: controller.signal });
      return { status: 'UP' };
    } catch (error) {
      return { status: 'DOWN', error: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  private async outboxBacklog(): Promise<{
    photo: number;
    video: number;
    variant: number;
    total: number;
  }> {
    const [photoRows, videoRows, variantRows] = (await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) FROM upload_outbox WHERE status = ANY($1)`,
        [OUTBOX_PENDING_STATUSES],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) FROM video_upload_outbox WHERE status = ANY($1)`,
        [OUTBOX_PENDING_STATUSES],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) FROM variant_upload_outbox WHERE status = ANY($1)`,
        [OUTBOX_PENDING_STATUSES],
      ),
    ])) as Array<Array<{ count: string }>>;
    const photo = Number(photoRows[0]?.count ?? 0);
    const video = Number(videoRows[0]?.count ?? 0);
    const variant = Number(variantRows[0]?.count ?? 0);
    return { photo, video, variant, total: photo + video + variant };
  }
}
