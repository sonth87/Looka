import type { Visibility } from '@face/core';
import { FsClient } from './FsClient.js';
import { FsError, FS_ERROR_CODES, UploadInput, UploadResult } from './types.js';

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
  /**
   * Decided by whoever enqueued the job — the point that actually knows what
   * kind of capture this is — and carried through unchanged. This worker has
   * no basis of its own for choosing public vs. private, so it never
   * substitutes a default; `null`/`undefined` here means the server's own
   * default applies, not "private by omission."
   */
  visibility?: Visibility | null;
}

/** Reads a captured image from local storage. Injected so tests need no disk. */
export interface FileReader {
  read(localPath: string): Promise<Uint8Array>;
}

/**
 * Outcome of ONE input of a batched upload — same order and length as the
 * `inputs` handed to `BatchUploadClient.uploadBatch`. A per-item failure is
 * reported here rather than thrown, so one bad item never fails its siblings.
 */
export type BatchUploadOutcome =
  | { ok: true; result: UploadResult }
  | { ok: false; error: Error };

/**
 * A destination that can take several captures in one request (the kiosk's
 * `ApiPhotoUploadClient`, for `POST /v1/devices/photos`). Opt-in: the worker
 * only batches when `UploadWorkerOptions.batch` is set.
 */
export interface BatchUploadClient {
  /** Whether this particular job may ride in a batch (e.g. videos may not). */
  canBatch(job: OutboxJob): boolean;
  /**
   * Sends every input in ONE request. Resolves with one outcome per input, in
   * order. Throws only when the request as a whole failed (network down, the
   * whole body rejected) — see `UploadWorker.flushChunk` for how each kind of
   * whole-call failure is handled.
   */
  uploadBatch(inputs: UploadInput[]): Promise<BatchUploadOutcome[]>;
}

export interface UploadBatchOptions {
  client: BatchUploadClient;
  /** Most jobs in one request. */
  maxItems: number;
  /** Most raw bytes (sum of the jobs' data) in one request — keep it under the server's body limit after base64 inflation. */
  maxBytes: number;
  /**
   * After a whole-batch 400/404 (an API that predates the batch body shape),
   * how long to stop trying batches and send singly. Default 30 minutes.
   */
  unsupportedCooldownMs?: number;
}

const DEFAULT_BATCH_UNSUPPORTED_COOLDOWN_MS = 30 * 60_000;

export interface UploadWorkerOptions {
  client: FsClient;
  outbox: OutboxPort;
  files: FileReader;
  /**
   * Opt-in 1-n sending: jobs the batch client accepts are grouped (up to
   * `maxItems` / `maxBytes` per request) instead of one request each. Unset =
   * exactly the one-request-per-job behaviour this worker always had.
   */
  batch?: UploadBatchOptions;
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
  private readonly opts: Required<Omit<UploadWorkerOptions, 'onEvent' | 'batch'>> & {
    onEvent?: (e: WorkerEvent) => void;
    batch?: UploadBatchOptions;
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Epoch ms until which batching is switched off after an old-API rejection; 0 = not disabled. */
  private batchDisabledUntil = 0;
  /**
   * Byte budget a batch is held to once a whole-batch 413 has shown that
   * something between here and the API (a reverse proxy's body limit) rejects
   * bodies of that size. Starts unbounded (the configured `maxBytes` alone
   * applies) and only ever shrinks, for the lifetime of the worker.
   */
  private shrunkMaxBytes = Number.POSITIVE_INFINITY;

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
    const batch = this.opts.batch;

    // No batching configured, or switched off after an old-API rejection:
    // exactly the original one-request-per-job loop.
    if (!batch || Date.now() < this.batchDisabledUntil) {
      for (const job of jobs) await this.sendOne(job);
      return;
    }

    let chunk: Array<{ job: OutboxJob; data: Uint8Array }> = [];
    let chunkBytes = 0;
    const flush = async (): Promise<void> => {
      const toSend = chunk;
      chunk = [];
      chunkBytes = 0;
      await this.flushChunk(batch, toSend);
    };

    for (const job of jobs) {
      if (!batch.client.canBatch(job)) {
        await this.sendOne(job);
        continue;
      }

      this.opts.outbox.markSending(job.id);
      let data: Uint8Array;
      try {
        data = await this.opts.files.read(job.localPath);
      } catch (err) {
        // A read failure belongs to this job alone — it must not take the
        // rest of the batch down with it.
        this.handleFailure(job, err as Error);
        continue;
      }

      // Bigger than a whole batch's byte budget: send it alone, on the
      // ordinary single route. The budget is re-read per job because a 413
      // from an earlier chunk of this same pass can shrink it.
      const maxBytes = this.batchMaxBytes(batch);
      if (data.byteLength > maxBytes) {
        await this.sendOneWithData(job, data);
        continue;
      }

      if (
        chunk.length > 0 &&
        (chunk.length + 1 > batch.maxItems || chunkBytes + data.byteLength > maxBytes)
      ) {
        await flush();
      }
      chunk.push({ job, data });
      chunkBytes += data.byteLength;
    }
    await flush();
  }

  /** The byte budget one batch is held to right now: the configured cap, or less after a whole-batch 413. */
  private batchMaxBytes(batch: UploadBatchOptions): number {
    return Math.min(batch.maxBytes, this.shrunkMaxBytes);
  }

  /** The original per-job send: claim it as SENDING, read its bytes, upload, record the outcome. */
  private async sendOne(job: OutboxJob): Promise<void> {
    this.opts.outbox.markSending(job.id);
    let data: Uint8Array;
    try {
      data = await this.opts.files.read(job.localPath);
    } catch (err) {
      this.handleFailure(job, err as Error);
      return;
    }
    await this.sendOneWithData(job, data);
  }

  /** `sendOne`'s upload-and-record half, for a job that is already SENDING and whose bytes are already read. */
  private async sendOneWithData(job: OutboxJob, data: Uint8Array): Promise<void> {
    try {
      const result = await this.upload(job, data);
      this.recordUploaded(job, result);
    } catch (err) {
      this.handleFailure(job, err as Error);
    }
  }

  private recordUploaded(job: OutboxJob, result: UploadResult): void {
    this.opts.outbox.markUploaded(job.id, result.fileId, result.status);
    this.emit({
      type: 'uploaded',
      jobId: job.id,
      fileId: result.fileId,
      dedupHit: result.dedupHit,
    });
  }

  /**
   * Sends one accumulated chunk. A single job (or a chunk that a concurrent
   * old-API detection just made ineligible) goes through the ordinary single
   * route — the same request a kiosk without batching would have made.
   *
   * When the WHOLE batch request throws a non-retryable `FsError`, every job
   * in it falls back to a single send, so one poisonous item can never cost
   * its siblings more than it would have unbatched:
   *  - 400/404: an API that predates the batch body shape (its validation
   *    strips `photos` and 400s, or the route shape is unknown) — batching is
   *    switched off for the cooldown so later ticks do not keep paying for a
   *    doomed batch attempt first;
   *  - 413: the body was over a size limit somewhere between here and the API
   *    (typically a reverse proxy's body cap that sits between one photo and
   *    a full batch). Fall back to single sends, no cooldown — it says nothing
   *    about whether the API supports batches — but halve the byte budget
   *    (`shrunkMaxBytes`) so later batches stop re-hitting the same ceiling.
   *    Each 413 at least halves it, so the wasted doomed requests are
   *    logarithmic in the configured budget, not one per tick; once it drops
   *    below a photo's size every job simply goes on the single route;
   *  - anything else non-retryable: fall back too, no cooldown, no shrink.
   * A retryable failure (network, 5xx, 429) or a non-`FsError` fails every
   * job into the normal retry path, exactly as a single send would.
   */
  private async flushChunk(
    batch: UploadBatchOptions,
    chunk: Array<{ job: OutboxJob; data: Uint8Array }>,
  ): Promise<void> {
    if (chunk.length === 0) return;

    if (chunk.length === 1 || Date.now() < this.batchDisabledUntil) {
      for (const { job, data } of chunk) await this.sendOneWithData(job, data);
      return;
    }

    let outcomes: BatchUploadOutcome[];
    try {
      outcomes = await batch.client.uploadBatch(
        chunk.map(({ job, data }) => this.toUploadInput(job, data)),
      );
    } catch (err) {
      if (err instanceof FsError && !err.retryable) {
        if (err.httpStatus === 400 || err.httpStatus === 404) {
          this.batchDisabledUntil =
            Date.now() + (batch.unsupportedCooldownMs ?? DEFAULT_BATCH_UNSUPPORTED_COOLDOWN_MS);
        } else if (err.httpStatus === 413) {
          const rejectedBytes = chunk.reduce((sum, { data }) => sum + data.byteLength, 0);
          this.shrunkMaxBytes = Math.min(
            this.shrunkMaxBytes,
            Math.max(1, Math.floor(rejectedBytes / 2))
          );
        }
        for (const { job, data } of chunk) await this.sendOneWithData(job, data);
        return;
      }
      for (const { job } of chunk) this.handleFailure(job, err as Error);
      return;
    }

    chunk.forEach(({ job }, i) => {
      const outcome = outcomes[i];
      if (outcome?.ok) {
        try {
          this.recordUploaded(job, outcome.result);
        } catch (err) {
          this.handleFailure(job, err as Error);
        }
        return;
      }
      // A missing outcome is treated as retryable (status 0), never as a
      // silent success or a permanent failure.
      this.handleFailure(
        job,
        outcome
          ? outcome.error
          : new FsError(0, FS_ERROR_CODES.NETWORK, 'missing batch outcome'),
      );
    });
  }

  private toUploadInput(job: OutboxJob, data: Uint8Array): UploadInput {
    return {
      virtualPath: job.virtualPath,
      data,
      mimeType: job.mimeType,
      idempotencyKey: job.idemKey,
      uploadId: job.uploadId,
      metadata: job.metadata ?? undefined,
      // Passed through from whoever enqueued the job, never decided here —
      // see the comment on OutboxJob.visibility.
      visibility: job.visibility ?? undefined,
    };
  }

  private async upload(job: OutboxJob, data: Uint8Array): Promise<UploadResult> {
    const input = this.toUploadInput(job, data);
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
      // Best-effort: release the server-side session/quota hold rather than
      // waiting for it to expire on its own. A cancel failing here (session
      // already gone, network down) must not stop the job from being marked
      // failed — that would leave it stuck SENDING forever.
      void this.opts.client.cancelUpload(job.uploadId).catch(() => {});
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
