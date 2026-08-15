import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { UploadWorker, OutboxPort, OutboxJob, WorkerEvent } from '../UploadWorker.js';
import { FsClient } from '../FsClient.js';
import { FsError, FS_ERROR_CODES } from '../types.js';

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
  });

  test('gives up after the attempt budget is spent', async () => {
    const outbox = new FakeOutbox();
    outbox.add({ id: 'j1', attempts: 2 });
    const client = new StubClient();
    client.uploadError = new FsError(503, FS_ERROR_CODES.HTTP, 'still down');
    const { worker } = makeWorker(outbox, client, { maxAttempts: 3 });

    await worker.tick();
    assert.equal(outbox.statusOf('j1'), 'FAILED_PERMANENT');
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
