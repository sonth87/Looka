import { FsClient } from './FsClient.js';
import { FsError, UploadResult } from './types.js';

/** What the worker needs from the queue. Implemented by UploadOutboxRepository. */
export interface OutboxPort {
  claimDue(now: number, limit?: number): OutboxJob[];
  markSending(id: string): void;
  markUploaded(id: string, fsFileId: string, fsStatus: string): void;
  markDone(id: string, fsStatus?: string): void;
  updateFsStatus(id: string, fsStatus: string): void;
  markRetry(id: string, error: string, delayMs: number): void;
  markFailedPermanent(id: string, error: string): void;
  listAwaitingScan(limit?: number): OutboxJob[];
  recoverInterrupted(): number;
}

export interface OutboxJob {
  id: string;
  kind: string;
  localPath: string;
  virtualPath: string;
  mimeType: string;
  idemKey: string;
  uploadId: string;
  attempts: number;
  metadata: Record<string, string> | null;
  fsFileId: string | null;
}

/** Reads a captured image from local storage. Injected so tests need no disk. */
export interface FileReader {
  read(localPath: string): Promise<Uint8Array>;
}

export interface UploadWorkerOptions {
  client: FsClient;
  outbox: OutboxPort;
  files: FileReader;
  /** How often to look for work. Default 5s. */
  tickMs?: number;
  /** Jobs uploaded per tick. Keep small so the UI thread stays responsive. */
  batchSize?: number;
  /** Give up after this many tries. Default 20 — roughly a day at capped backoff. */
  maxAttempts?: number;
  /** Compute the wait before the next attempt. */
  backoff?: (attempts: number) => number;
  /** Raise a warning when a file has been awaiting a scan this long. Default 10 min. */
  stuckScanWarnMs?: number;
  onEvent?: (event: WorkerEvent) => void;
}

export type WorkerEvent =
  | { type: 'recovered'; count: number }
  | { type: 'uploaded'; jobId: string; fileId: string; dedupHit: boolean }
  | { type: 'ready'; jobId: string; fileId: string }
  | { type: 'retry'; jobId: string; attempts: number; delayMs: number; error: string }
  | { type: 'failed'; jobId: string; error: string }
  | { type: 'quarantined'; jobId: string; fileId: string }
  | { type: 'scan-stuck'; jobId: string; fileId: string; waitingMs: number };

const DEFAULT_BACKOFF = (attempts: number) =>
  Math.max(1_000, Math.min(5_000 * 2 ** attempts, 600_000));

/**
 * Moves queued captures to the file-service in the background.
 *
 * Runs on its own timer, never in the capture path: an operator should never
 * wait on the network, and a server outage should slow nothing down except the
 * queue draining.
 *
 * Two stages, because a completed upload is not yet a usable file:
 *   1. send bytes            → UPLOADED (server is scanning)
 *   2. poll until scanned     → DONE
 */
export class UploadWorker {
  private readonly opts: Required<Omit<UploadWorkerOptions, 'onEvent'>> & {
    onEvent?: (e: WorkerEvent) => void;
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: UploadWorkerOptions) {
    this.opts = {
      tickMs: 5_000,
      batchSize: 2,
      maxAttempts: 20,
      backoff: DEFAULT_BACKOFF,
      stuckScanWarnMs: 600_000,
      ...options,
    };
  }

  /** Recover interrupted jobs, then start the timer. */
  public start(): void {
    if (this.timer) return;
    const recovered = this.opts.outbox.recoverInterrupted();
    if (recovered > 0) this.emit({ type: 'recovered', count: recovered });

    this.timer = setInterval(() => void this.tick(), this.opts.tickMs);
    void this.tick();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Exposed for tests and for a manual "sync now" action. */
  public async tick(): Promise<void> {
    // Overlapping passes would send the same job twice.
    if (this.running) return;
    this.running = true;
    try {
      await this.sendDue();
      await this.pollScans();
    } finally {
      this.running = false;
    }
  }

  private async sendDue(): Promise<void> {
    const jobs = this.opts.outbox.claimDue(Date.now(), this.opts.batchSize);

    for (const job of jobs) {
      this.opts.outbox.markSending(job.id);
      try {
        const data = await this.opts.files.read(job.localPath);
        const result = await this.upload(job, data);
        this.opts.outbox.markUploaded(job.id, result.fileId, result.status);
        this.emit({
          type: 'uploaded',
          jobId: job.id,
          fileId: result.fileId,
          dedupHit: result.dedupHit,
        });
      } catch (err) {
        this.handleFailure(job, err as Error);
      }
    }
  }

  private async upload(job: OutboxJob, data: Uint8Array): Promise<UploadResult> {
    const input = {
      virtualPath: job.virtualPath,
      data,
      mimeType: job.mimeType,
      idempotencyKey: job.idemKey,
      uploadId: job.uploadId,
      metadata: job.metadata ?? undefined,
    };
    // Full-resolution captures always go chunked; derived artefacts are small
    // enough for a single request.
    return job.kind === 'raw'
      ? this.opts.client.uploadRaw(input)
      : this.opts.client.upload(input);
  }

  private handleFailure(job: OutboxJob, err: Error): void {
    const retryable = err instanceof FsError ? err.retryable : true;
    const attempts = job.attempts + 1;

    // A rejected request stays rejected; only give repeated attempts to
    // failures that could plausibly clear on their own.
    if (!retryable || attempts >= this.opts.maxAttempts) {
      this.opts.outbox.markFailedPermanent(job.id, err.message);
      this.emit({ type: 'failed', jobId: job.id, error: err.message });
      return;
    }

    const delayMs = this.opts.backoff(job.attempts);
    this.opts.outbox.markRetry(job.id, err.message, delayMs);
    this.emit({ type: 'retry', jobId: job.id, attempts, delayMs, error: err.message });
  }

  /** Advance UPLOADED jobs once the server has finished scanning them. */
  private async pollScans(): Promise<void> {
    const awaiting = this.opts.outbox.listAwaitingScan();

    for (const job of awaiting) {
      if (!job.fsFileId) continue;
      try {
        const info = await this.opts.client.getFile(job.fsFileId);

        if (info.status === 'READY') {
          this.opts.outbox.markDone(job.id, info.status);
          this.emit({ type: 'ready', jobId: job.id, fileId: job.fsFileId });
          continue;
        }

        if (info.status === 'QUARANTINED' || info.status === 'FAILED') {
          this.opts.outbox.markFailedPermanent(job.id, `Server reported ${info.status}`);
          this.emit({ type: 'quarantined', jobId: job.id, fileId: job.fsFileId });
          continue;
        }

        this.opts.outbox.updateFsStatus(job.id, info.status);
      } catch {
        // Leave the job as-is; the next tick tries again. A scan check failing
        // is not a reason to fail an upload that already succeeded.
      }
    }
  }

  private emit(event: WorkerEvent): void {
    try {
      this.opts.onEvent?.(event);
    } catch {
      /* a listener must not break the queue */
    }
  }
}
