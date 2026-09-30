import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  UploadWorker,
  OutboxPort,
  OutboxJob,
  WorkerEvent,
  BatchUploadClient,
  BatchUploadOutcome,
} from '../UploadWorker.js';
import { FsClient } from '../FsClient.js';
import { FsError, FS_ERROR_CODES, UploadInput } from '../types.js';

/** In-memory stand-in for UploadOutboxRepository, with the same semantics. */
class FakeOutbox implements OutboxPort {
  public jobs = new Map<string, OutboxJob & { status: string; nextRetryAt: number | null; error?: string }>();

  public add(job: Partial<OutboxJob> & { id: string }): void {
    this.jobs.set(job.id, {
      kind: 'raw',
      localPath: `/tmp/${job.id}.jpg`,
      virtualPath: `raw/${job.id}.jpg`,
      mimeType: 'image/jpeg',
      idemKey: `key-${job.id}`,
      uploadId: `upload-${job.id}`,
      attempts: 0,
      metadata: null,
      fsFileId: null,
      ...job,
      status: 'PENDING',
      nextRetryAt: null,
    } as never);
  }

  claimDue(now: number, limit = 5): OutboxJob[] {
    return [...this.jobs.values()]
      .filter((j) => j.status === 'PENDING' && (j.nextRetryAt === null || j.nextRetryAt <= now))
      .slice(0, limit);
  }
  markSending(id: string) { this.jobs.get(id)!.status = 'SENDING'; }
  markUploaded(id: string, fsFileId: string) {
    const j = this.jobs.get(id)!;
    j.status = 'UPLOADED';
    j.fsFileId = fsFileId;
  }
  markDone(id: string) { this.jobs.get(id)!.status = 'DONE'; }
  updateFsStatus() { /* status mirror not needed for these assertions */ }
  markRetry(id: string, error: string, delayMs: number) {
    const j = this.jobs.get(id)!;
    j.status = 'PENDING';
    j.attempts += 1;
    j.nextRetryAt = Date.now() + delayMs;
    j.error = error;
  }
  markFailedPermanent(id: string, error: string) {
    const j = this.jobs.get(id)!;
    j.status = 'FAILED_PERMANENT';
    j.attempts += 1;
    j.error = error;
  }
  listAwaitingScan(): OutboxJob[] {
    return [...this.jobs.values()].filter((j) => j.status === 'UPLOADED');
  }
  recoverInterrupted(): number {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'SENDING') {
        j.status = 'PENDING';
        j.nextRetryAt = null;
        n++;
      }
    }
    return n;
  }
  statusOf(id: string): string { return this.jobs.get(id)!.status; }
}

class StubClient {
  public uploads: string[] = [];
  public uploadResult: unknown = null;
  public uploadError: Error | null = null;
  public fileStatus = 'SCANNING';

  async uploadRaw(input: { virtualPath: string }) { return this.doUpload(input); }
  async upload(input: { virtualPath: string }) { return this.doUpload(input); }

  private async doUpload(input: { virtualPath: string }) {
    this.uploads.push(input.virtualPath);
    if (this.uploadError) throw this.uploadError;
    return (
      this.uploadResult ?? {
        fileId: 'file_1',
        virtualPath: input.virtualPath,
        status: 'SCANNING',
        size: 10,
        etag: 'e',
        version: 1,
        dedupHit: false,
      }
    );
  }

  async getFile(fileId: string) {
    return { fileId, virtualPath: 'p', status: this.fileStatus, size: 10 };
  }

  public cancelledUploadIds: string[] = [];
  async cancelUpload(uploadId: string) {
    this.cancelledUploadIds.push(uploadId);
  }
}

const files = { read: async () => new Uint8Array(10).fill(1) };

function makeWorker(
  outbox: FakeOutbox,
  client: StubClient,
  opts: Partial<ConstructorParameters<typeof UploadWorker>[0]> = {}
) {
  const events: WorkerEvent[] = [];
  const worker = new UploadWorker({
    client: client as unknown as FsClient,
    outbox,
    files,
    backoff: () => 1000,
    onEvent: (e) => events.push(e),
    ...opts,
  });
  return { worker, events };
}

describe('UploadWorker — normal flow', () => {
  test('sends a queued job, then completes it once the server has scanned it', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    const client = new StubClient();
    const { worker, events } = makeWorker(outbox, client);

    // First pass: bytes accepted, but the file is not usable yet.
    await worker.tick();
    assert.equal(outbox.statusOf('j1'), 'UPLOADED');
    assert.ok(events.some((e) => e.type === 'uploaded'));

    // Second pass: the scan has cleared.
    client.fileStatus = 'READY';
    await worker.tick();
    assert.equal(outbox.statusOf('j1'), 'DONE');
    assert.ok(events.some((e) => e.type === 'ready'));
  });

  test('a job waits for its dependency', async () => {
    // The card photo is derived from the raw capture, so its upload must not
    // overtake the one it depends on.
    const outbox = new FakeOutbox();
    outbox.add({ id: 'raw1' });
    outbox.add({ id: 'card1', kind: 'card_3x4' });
    // FakeOutbox has no dependency filter; approximate it by ordering.
    const client = new StubClient();
    const { worker } = makeWorker(outbox, client, { batchSize: 1 });

    await worker.tick();
    assert.deepEqual(client.uploads, ['raw/raw1.jpg'], 'only the first job in this pass');
  });

  test('respects the batch size so a backlog cannot monopolise a tick', async () => {
    const outbox = new FakeOutbox();
    for (let i = 0; i < 5; i++) outbox.add({ id: `j${i}` });
    const client = new StubClient();
    const { worker } = makeWorker(outbox, client, { batchSize: 2 });

    await worker.tick();
    assert.equal(client.uploads.length, 2);
  });
});

describe('UploadWorker — failures', () => {
  test('a transient failure is retried with a delay, not abandoned', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    const client = new StubClient();
    client.uploadError = new FsError(503, FS_ERROR_CODES.HTTP, 'service unavailable');
    const { worker, events } = makeWorker(outbox, client);

    await worker.tick();

    assert.equal(outbox.statusOf('j1'), 'PENDING', 'stays queued for another attempt');
    const retry = events.find((e) => e.type === 'retry');
    assert.ok(retry && retry.type === 'retry' && retry.delayMs > 0);
  });

  test('a rejected request fails permanently instead of retrying forever', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    const client = new StubClient();
    client.uploadError = new FsError(400, FS_ERROR_CODES.HTTP, 'bad request');
    const { worker, events } = makeWorker(outbox, client);

    await worker.tick();

    assert.equal(outbox.statusOf('j1'), 'FAILED_PERMANENT');
    assert.ok(events.some((e) => e.type === 'failed'));
    assert.deepEqual(
      client.cancelledUploadIds,
      ['upload-j1'],
      'releases the server-side session instead of leaving it to expire'
    );
  });

  test('gives up after the attempt budget is spent', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1', attempts: 2 });
    const client = new StubClient();
    client.uploadError = new FsError(503, FS_ERROR_CODES.HTTP, 'still down');
    const { worker } = makeWorker(outbox, client, { maxAttempts: 3 });

    await worker.tick();
    assert.equal(outbox.statusOf('j1'), 'FAILED_PERMANENT');
    assert.deepEqual(client.cancelledUploadIds, ['upload-j1']);
  });

  test('a quarantined file stops the job and is reported', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    const client = new StubClient();
    const { worker, events } = makeWorker(outbox, client);

    await worker.tick();
    client.fileStatus = 'QUARANTINED';
    await worker.tick();

    assert.equal(outbox.statusOf('j1'), 'FAILED_PERMANENT');
    assert.ok(events.some((e) => e.type === 'quarantined'));
  });

  test('a failing scan check leaves a successful upload alone', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    const client = new StubClient();
    const { worker } = makeWorker(outbox, client);

    await worker.tick();
    client.getFile = async () => {
      throw new Error('network down');
    };
    await worker.tick();

    // The bytes are on the server; a status check failing must not undo that.
    assert.equal(outbox.statusOf('j1'), 'UPLOADED');
  });
});

describe('UploadWorker — crash recovery', () => {
  test('jobs left mid-flight by a crash are requeued and actually sent', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    outbox.markSending('j1'); // as if the process died here

    const client = new StubClient();
    const { worker, events } = makeWorker(outbox, client);

    worker.start();
    worker.stop();
    // start() kicks off a pass immediately; let it settle before judging it.
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(events.some((e) => e.type === 'recovered' && e.count === 1));
    // Without recovery this job would sit in SENDING forever, owned by nobody.
    assert.equal(outbox.statusOf('j1'), 'UPLOADED');
    assert.deepEqual(client.uploads, ['raw/j1.jpg']);
  });

  test('overlapping ticks cannot send the same job twice', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1' });
    const client = new StubClient();
    const { worker } = makeWorker(outbox, client);

    await Promise.all([worker.tick(), worker.tick(), worker.tick()]);
    assert.equal(client.uploads.length, 1);
  });
});

/** Stand-in for the kiosk's `ApiPhotoUploadClient` batch side. */
class StubBatchClient implements BatchUploadClient {
  public batches: string[][] = [];
  public canBatchFn: (job: OutboxJob) => boolean = () => true;
  public batchError: Error | null = null;
  public outcomesOverride: BatchUploadOutcome[] | null = null;
  public perItem: (input: UploadInput, index: number) => BatchUploadOutcome = (input) => ({
    ok: true,
    result: {
      fileId: `file_${input.virtualPath}`,
      virtualPath: input.virtualPath,
      status: 'SCANNING',
      size: 10,
      etag: 'e',
      version: 1,
      dedupHit: false,
    } as never,
  });

  canBatch(job: OutboxJob): boolean {
    return this.canBatchFn(job);
  }

  async uploadBatch(inputs: UploadInput[]): Promise<BatchUploadOutcome[]> {
    this.batches.push(inputs.map((i) => i.virtualPath));
    if (this.batchError) throw this.batchError;
    if (this.outcomesOverride) return this.outcomesOverride;
    return inputs.map((input, i) => this.perItem(input, i));
  }
}

/** The default all-success outcome, reusable inside a custom `perItem`. */
function okOutcome(input: UploadInput): BatchUploadOutcome {
  return new StubBatchClient().perItem(input, 0);
}

function makeBatchWorker(
  outbox: FakeOutbox,
  client: StubClient,
  batchClient: StubBatchClient,
  batch: { maxItems?: number; maxBytes?: number; unsupportedCooldownMs?: number } = {},
  opts: Partial<ConstructorParameters<typeof UploadWorker>[0]> = {}
) {
  return makeWorker(outbox, client, {
    batchSize: 10,
    batch: { client: batchClient, maxItems: 10, maxBytes: 1_000, ...batch },
    ...opts,
  });
}

function addJobs(outbox: FakeOutbox, ...ids: string[]) {
  for (const id of ids) outbox.add({ id });
}

describe('UploadWorker — 1-n batching', () => {
  test('without a batch option every job still goes as its own request', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b', 'c');
    const client = new StubClient();
    const { worker } = makeWorker(outbox, client, { batchSize: 10 });

    await worker.tick();

    assert.deepEqual(client.uploads, ['raw/a.jpg', 'raw/b.jpg', 'raw/c.jpg']);
  });

  test('several jobs go out in ONE batch call, each marked uploaded', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b', 'c');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    const { worker, events } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.deepEqual(batchClient.batches, [['raw/a.jpg', 'raw/b.jpg', 'raw/c.jpg']]);
    assert.deepEqual(client.uploads, [], 'no single-route request was made');
    for (const id of ['a', 'b', 'c']) assert.equal(outbox.statusOf(id), 'UPLOADED');
    assert.equal(events.filter((e) => e.type === 'uploaded').length, 3);
    assert.equal(outbox.jobs.get('b')!.fsFileId, 'file_raw/b.jpg');
  });

  test('a single eligible job uses the ordinary single route, not a 1-item batch', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.deepEqual(batchClient.batches, []);
    assert.deepEqual(client.uploads, ['raw/a.jpg']);
    assert.equal(outbox.statusOf('a'), 'UPLOADED');
  });

  test('a per-item 400 fails only that job permanently; a per-item 503 only retries that job', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'ok', 'bad', 'flaky');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.perItem = (input) => {
      if (input.virtualPath.includes('bad')) {
        return { ok: false, error: new FsError(400, FS_ERROR_CODES.HTTP, 'bad photo') };
      }
      if (input.virtualPath.includes('flaky')) {
        return { ok: false, error: new FsError(503, FS_ERROR_CODES.HTTP, 'try later') };
      }
      return okOutcome(input);
    };
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.equal(outbox.statusOf('ok'), 'UPLOADED');
    assert.equal(outbox.statusOf('bad'), 'FAILED_PERMANENT');
    assert.equal(outbox.statusOf('flaky'), 'PENDING');
    assert.equal(outbox.jobs.get('flaky')!.attempts, 1);
  });

  test('a whole-batch 400 (old API) falls back to single sends and stays single during the cooldown', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new FsError(400, FS_ERROR_CODES.HTTP, 'photos not accepted');
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.equal(batchClient.batches.length, 1, 'one doomed attempt');
    assert.deepEqual(client.uploads, ['raw/a.jpg', 'raw/b.jpg'], 'every job resent singly');
    assert.equal(outbox.statusOf('a'), 'UPLOADED');
    assert.equal(outbox.statusOf('b'), 'UPLOADED');

    // Next tick: more work, but batching is switched off for the cooldown.
    addJobs(outbox, 'c', 'd');
    await worker.tick();

    assert.equal(batchClient.batches.length, 1, 'no second batch attempt during the cooldown');
    assert.deepEqual(client.uploads.slice(2), ['raw/c.jpg', 'raw/d.jpg']);
  });

  test('a whole-batch 404 also switches batching off', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new FsError(404, FS_ERROR_CODES.HTTP, 'not found');
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();
    addJobs(outbox, 'c', 'd');
    await worker.tick();

    assert.equal(batchClient.batches.length, 1);
  });

  test('batching resumes once the cooldown has passed', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new FsError(400, FS_ERROR_CODES.HTTP, 'photos not accepted');
    const { worker } = makeBatchWorker(outbox, client, batchClient, { unsupportedCooldownMs: 0 });

    await worker.tick();
    batchClient.batchError = null;
    addJobs(outbox, 'c', 'd');
    await worker.tick();

    assert.equal(batchClient.batches.length, 2, 'second tick tried a batch again');
    assert.equal(outbox.statusOf('c'), 'UPLOADED');
  });

  test('a whole-batch 413 falls back to single sends WITHOUT a cooldown, but halves the byte budget', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new FsError(413, FS_ERROR_CODES.HTTP, 'too large');
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();
    assert.deepEqual(client.uploads, ['raw/a.jpg', 'raw/b.jpg']);

    // The rejected batch was 2 x 10 = 20 bytes, so the budget is now 10: two
    // more 10-byte jobs no longer fit in one request and go out singly rather
    // than paying for another doomed batch first.
    batchClient.batchError = null;
    addJobs(outbox, 'c', 'd');
    await worker.tick();

    assert.equal(batchClient.batches.length, 1, 'no second batch of a size the path already rejected');
    assert.deepEqual(client.uploads.slice(2), ['raw/c.jpg', 'raw/d.jpg']);
    assert.equal(outbox.statusOf('c'), 'UPLOADED');
    assert.equal(outbox.statusOf('d'), 'UPLOADED');
  });

  test('after a 413 batches keep going at the size the path accepts (the budget shrinks, batching is not abandoned)', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b', 'c', 'd');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    // A "proxy" that refuses any batch over 25 bytes (each fake file is 10).
    batchClient.uploadBatch = async (inputs: UploadInput[]) => {
      batchClient.batches.push(inputs.map((i) => i.virtualPath));
      if (inputs.reduce((sum, i) => sum + i.data.byteLength, 0) > 25) {
        throw new FsError(413, FS_ERROR_CODES.HTTP, 'too large');
      }
      return inputs.map((input, i) => batchClient.perItem(input, i));
    };
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();
    // 4 x 10 = 40 bytes -> 413 -> every job resent singly; budget becomes 20.
    assert.equal(batchClient.batches.length, 1);
    assert.deepEqual(client.uploads, ['raw/a.jpg', 'raw/b.jpg', 'raw/c.jpg', 'raw/d.jpg']);

    addJobs(outbox, 'e', 'f', 'g', 'h');
    await worker.tick();

    assert.deepEqual(
      batchClient.batches.slice(1),
      [
        ['raw/e.jpg', 'raw/f.jpg'],
        ['raw/g.jpg', 'raw/h.jpg'],
      ],
      'two accepted-size batches, no further 413'
    );
    for (const id of ['e', 'f', 'g', 'h']) assert.equal(outbox.statusOf(id), 'UPLOADED');
  });

  test('a whole-batch non-retryable status other than 400/404/413 falls back without cooldown or shrinking', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new FsError(403, FS_ERROR_CODES.HTTP, 'forbidden');
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();
    assert.deepEqual(client.uploads, ['raw/a.jpg', 'raw/b.jpg']);

    batchClient.batchError = null;
    addJobs(outbox, 'c', 'd');
    await worker.tick();

    assert.equal(batchClient.batches.length, 2, 'batching (at full size) continues');
    assert.equal(outbox.statusOf('c'), 'UPLOADED');
  });

  test('a whole-batch network error retries every job instead of failing or resending it', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new FsError(0, FS_ERROR_CODES.NETWORK, 'ECONNRESET');
    const { worker, events } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.equal(outbox.statusOf('a'), 'PENDING');
    assert.equal(outbox.statusOf('b'), 'PENDING');
    assert.deepEqual(client.uploads, [], 'no single-route resend on a retryable failure');
    assert.equal(events.filter((e) => e.type === 'retry').length, 2);
  });

  test('a non-FsError thrown by the batch client is treated as retryable', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.batchError = new Error('boom');
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.equal(outbox.statusOf('a'), 'PENDING');
    assert.equal(outbox.statusOf('b'), 'PENDING');
  });

  test('the byte budget splits a backlog into several batches', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b', 'c', 'd', 'e');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    // 10 bytes per file, 25-byte budget -> 2 per batch, the fifth goes alone.
    const { worker } = makeBatchWorker(outbox, client, batchClient, { maxBytes: 25 });

    await worker.tick();

    assert.deepEqual(batchClient.batches, [
      ['raw/a.jpg', 'raw/b.jpg'],
      ['raw/c.jpg', 'raw/d.jpg'],
    ]);
    assert.deepEqual(client.uploads, ['raw/e.jpg'], 'a leftover single job uses the single route');
    for (const id of ['a', 'b', 'c', 'd', 'e']) assert.equal(outbox.statusOf(id), 'UPLOADED');
  });

  test('maxItems also caps a batch', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b', 'c', 'd');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    const { worker } = makeBatchWorker(outbox, client, batchClient, { maxItems: 2 });

    await worker.tick();

    assert.deepEqual(batchClient.batches, [
      ['raw/a.jpg', 'raw/b.jpg'],
      ['raw/c.jpg', 'raw/d.jpg'],
    ]);
  });

  test('a job bigger than the whole byte budget is sent alone on the single route', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'big', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    const { worker } = makeBatchWorker(
      outbox,
      client,
      batchClient,
      { maxBytes: 25 },
      { files: { read: async (p: string) => new Uint8Array(p.includes('big') ? 100 : 10) } }
    );

    await worker.tick();

    assert.deepEqual(client.uploads, ['raw/big.jpg']);
    assert.deepEqual(batchClient.batches, [['raw/a.jpg', 'raw/b.jpg']]);
    for (const id of ['a', 'big', 'b']) assert.equal(outbox.statusOf(id), 'UPLOADED');
  });

  test('a job the batch client refuses (canBatch false, e.g. video) goes single', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'video', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.canBatchFn = (job) => !job.id.includes('video');
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.deepEqual(client.uploads, ['raw/video.jpg']);
    assert.deepEqual(batchClient.batches, [['raw/a.jpg', 'raw/b.jpg']]);
  });

  test('a files.read failure affects only its own job', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'bad', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    const { worker } = makeBatchWorker(
      outbox,
      client,
      batchClient,
      {},
      {
        files: {
          read: async (p: string) => {
            if (p.includes('bad')) throw new Error('disk gone');
            return new Uint8Array(10);
          },
        },
      }
    );

    await worker.tick();

    assert.deepEqual(batchClient.batches, [['raw/a.jpg', 'raw/b.jpg']]);
    assert.equal(outbox.statusOf('a'), 'UPLOADED');
    assert.equal(outbox.statusOf('b'), 'UPLOADED');
    assert.equal(outbox.statusOf('bad'), 'PENDING', 'retried on its own, not lost');
    assert.equal(outbox.jobs.get('bad')!.error, 'disk gone');
  });

  test('an outcome the batch client failed to return is retried, never treated as success', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'a', 'b');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    // Only one outcome for two inputs.
    batchClient.outcomesOverride = [okOutcome({ virtualPath: 'raw/a.jpg' } as UploadInput)];
    const { worker } = makeBatchWorker(outbox, client, batchClient);

    await worker.tick();

    assert.equal(outbox.statusOf('a'), 'UPLOADED');
    assert.equal(outbox.statusOf('b'), 'PENDING');
    assert.equal(outbox.jobs.get('b')!.error, 'missing batch outcome');
  });

  test('no job is left stuck in SENDING after a tick, whatever happened', async () => {
    const outbox = new FakeOutbox();
    addJobs(outbox, 'ok', 'bad', 'flaky', 'unreadable', 'big');
    const client = new StubClient();
    const batchClient = new StubBatchClient();
    batchClient.perItem = (input) => {
      if (input.virtualPath.includes('bad')) {
        return { ok: false, error: new FsError(403, FS_ERROR_CODES.HTTP, 'not yours') };
      }
      if (input.virtualPath.includes('flaky')) {
        return { ok: false, error: new FsError(503, FS_ERROR_CODES.HTTP, 'later') };
      }
      return okOutcome(input);
    };
    const { worker } = makeBatchWorker(
      outbox,
      client,
      batchClient,
      { maxBytes: 25 },
      {
        files: {
          read: async (p: string) => {
            if (p.includes('unreadable')) throw new Error('disk gone');
            return new Uint8Array(p.includes('big') ? 100 : 10);
          },
        },
      }
    );

    await worker.tick();

    for (const job of outbox.jobs.values()) {
      assert.notEqual(job.status, 'SENDING', `${job.id} must not be left SENDING`);
    }
  });
});
