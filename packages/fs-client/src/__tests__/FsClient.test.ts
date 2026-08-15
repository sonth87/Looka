import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FsClient, deterministicUuid, encodeMetadata } from '../FsClient.js';
import { FsError } from '../types.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyLength: number;
}

/**
 * Stands in for the file-service: accepts chunks, tracks how much of each upload
 * session it holds, and can be told to drop a connection at a chosen point.
 */
class FakeServer {
  public calls: RecordedCall[] = [];
  private received = new Map<string, number>();
  private failAt: { chunkIndex: number; kind: 'network' | 'server' | 'client' } | null = null;
  private chunkCount = 0;
  public fileStatus: string = 'SCANNING';

  public failOnChunk(chunkIndex: number, kind: 'network' | 'server' | 'client' = 'network'): void {
    this.failAt = { chunkIndex, kind };
  }

  public fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const headers = normaliseHeaders(init?.headers);
    const body = init?.body as Uint8Array | undefined;
    this.calls.push({
      url: u,
      method: init?.method ?? 'GET',
      headers,
      bodyLength: body?.byteLength ?? 0,
    });

    if (u.includes('/api/v1/files/') && init?.method === 'GET') {
      return json(200, { file_id: 'file_1', virtual_path: 'p', status: this.fileStatus, size: 10 });
    }

    if (u.endsWith('/api/v1/files') && init?.method === 'POST') {
      const range = headers['content-range'];
      const uploadId = headers['x-upload-id'];

      // No Content-Range → whole file in one request.
      if (!range) return json(201, result(body?.byteLength ?? 0));

      const total = Number(range.split('/')[1]);

      // `bytes */total` is a question, not data.
      if (range.startsWith('bytes */')) {
        const have = this.received.get(uploadId) ?? 0;
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(have) } });
      }

      if (this.failAt && this.chunkCount === this.failAt.chunkIndex) {
        const kind = this.failAt.kind;
        this.failAt = null;
        this.chunkCount++;
        if (kind === 'network') throw new Error('socket hang up');
        return new Response('boom', { status: kind === 'server' ? 503 : 400 });
      }
      this.chunkCount++;

      const [, endStr] = range.replace('bytes ', '').split('/')[0].split('-');
      const end = Number(endStr);
      const nextOffset = end + 1;
      this.received.set(uploadId, nextOffset);

      if (nextOffset >= total) return json(201, result(total));
      return new Response(null, { status: 204, headers: { 'Upload-Offset': String(nextOffset) } });
    }

    return new Response(null, { status: 404 });
  };
}

function result(size: number) {
  return {
    file_id: 'file_1',
    virtual_path: 'raw/sess_1/FRONT-1.jpg',
    status: 'SCANNING',
    size,
    etag: 'etag-1',
    version: 1,
    dedup_hit: false,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normaliseHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h as Record<string, string>)) out[k.toLowerCase()] = v;
  return out;
}

function makeClient(server: FakeServer, chunkSize = 4) {
  return new FsClient({
    baseUrl: 'http://fs-core:8080',
    apiKey: 'test-key',
    chunkSize,
    fetchImpl: server.fetch as unknown as typeof fetch,
  });
}

const input = (bytes: number) => ({
  virtualPath: 'raw/sess_1/FRONT-1.jpg',
  data: new Uint8Array(bytes).fill(7),
  mimeType: 'image/jpeg',
  idempotencyKey: 'sess_1:FRONT:1:raw',
});

describe('FsClient — chunked upload', () => {
  test('splits the payload and finishes on the last chunk', async () => {
    const server = new FakeServer();
    const client = makeClient(server, 4);

    const res = await client.uploadRaw(input(10));

    assert.equal(res.fileId, 'file_1');
    assert.equal(res.status, 'SCANNING');

    const dataChunks = server.calls.filter(
      (c) => c.headers['content-range'] && !c.headers['content-range'].startsWith('bytes */')
    );
    assert.equal(dataChunks.length, 3, '10 bytes at 4 per chunk = 3 chunks');
    assert.equal(dataChunks[0].headers['content-range'], 'bytes 0-3/10');
    assert.equal(dataChunks[2].headers['content-range'], 'bytes 8-9/10');
  });

  test('every chunk carries its own checksum and the upload id', async () => {
    const server = new FakeServer();
    await makeClient(server, 4).uploadRaw(input(10));

    const dataChunks = server.calls.filter(
      (c) => c.headers['content-range'] && !c.headers['content-range'].startsWith('bytes */')
    );
    const uploadIds = new Set(dataChunks.map((c) => c.headers['x-upload-id']));
    assert.equal(uploadIds.size, 1, 'all chunks belong to one session');
    for (const c of dataChunks) {
      assert.match(c.headers['x-chunk-sha256'], /^[0-9a-f]{64}$/);
      assert.equal(c.headers['idempotency-key'], 'sess_1:FRONT:1:raw');
    }
  });

  test('raw uploads stay chunked even when small enough for one request', async () => {
    // Full-resolution captures sit right at the single-request ceiling, so the
    // path must not depend on the size of any particular image.
    const server = new FakeServer();
    await makeClient(server, 1024).uploadRaw(input(100));

    const usedRange = server.calls.some((c) => c.headers['content-range']);
    assert.ok(usedRange, 'raw upload must use the chunked path');
  });

  test('a small derived artefact goes in a single request', async () => {
    const server = new FakeServer();
    await makeClient(server, 4).uploadDirect({ ...input(100), virtualPath: 'card/3x4.jpg' });

    const single = server.calls.find((c) => c.method === 'POST' && !c.headers['content-range']);
    assert.ok(single, 'expected one request without Content-Range');
    assert.equal(single!.headers['content-length'], '100');
  });
});

describe('FsClient — resume after interruption', () => {
  test('a dropped connection resumes from the server offset instead of restarting', async () => {
    const server = new FakeServer();
    const client = makeClient(server, 4);

    server.failOnChunk(1); // fails partway through
    await assert.rejects(() => client.uploadRaw(input(12)), FsError);

    const beforeRetry = server.calls.length;
    server.calls = [];

    // Same idempotency key → same upload session → server reports what it has.
    const res = await client.uploadRaw(input(12));
    assert.equal(res.fileId, 'file_1');

    const probe = server.calls.find((c) => c.headers['content-range']?.startsWith('bytes */'));
    assert.ok(probe, 'retry must ask for the current offset first');

    const resent = server.calls.filter(
      (c) => c.headers['content-range'] && !c.headers['content-range'].startsWith('bytes */')
    );
    assert.equal(resent[0].headers['content-range'], 'bytes 4-7/12', 'resumes at byte 4, not 0');
    assert.ok(beforeRetry > 0);
  });

  test('the upload id is stable so a crash does not orphan the session', () => {
    const a = deterministicUuid('sess_1:FRONT:1:raw');
    const b = deterministicUuid('sess_1:FRONT:1:raw');
    const other = deterministicUuid('sess_1:FRONT:2:raw');

    assert.equal(a, b, 'same key must always produce the same id');
    assert.notEqual(a, other);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('FsClient — error classification', () => {
  test('a server fault is retryable; a rejected request is not', async () => {
    const serverFault = new FakeServer();
    serverFault.failOnChunk(0, 'server');
    await assert.rejects(
      () => makeClient(serverFault, 4).uploadRaw(input(8)),
      (err: FsError) => {
        assert.equal(err.httpStatus, 503);
        assert.equal(err.retryable, true, '503 should be retried');
        return true;
      }
    );

    const clientFault = new FakeServer();
    clientFault.failOnChunk(0, 'client');
    await assert.rejects(
      () => makeClient(clientFault, 4).uploadRaw(input(8)),
      (err: FsError) => {
        assert.equal(err.httpStatus, 400);
        assert.equal(err.retryable, false, 'a 400 will be rejected identically forever');
        return true;
      }
    );
  });

  test('a transport failure is retryable', async () => {
    const server = new FakeServer();
    server.failOnChunk(0, 'network');
    await assert.rejects(
      () => makeClient(server, 4).uploadRaw(input(8)),
      (err: FsError) => {
        assert.equal(err.httpStatus, 0);
        assert.equal(err.retryable, true);
        return true;
      }
    );
  });
});

describe('FsClient — scan state', () => {
  test('waitUntilReady returns once the server has scanned the file', async () => {
    const server = new FakeServer();
    const client = makeClient(server);
    server.fileStatus = 'READY';

    const info = await client.waitUntilReady('file_1', { pollMs: 1, timeoutMs: 100 });
    assert.equal(info.status, 'READY');
  });

  test('a quarantined file fails immediately rather than waiting out the timeout', async () => {
    const server = new FakeServer();
    server.fileStatus = 'QUARANTINED';

    await assert.rejects(
      () => makeClient(server).waitUntilReady('file_1', { pollMs: 1, timeoutMs: 500 }),
      /QUARANTINED/
    );
  });

  test('a file stuck in scanning times out with the state named', async () => {
    const server = new FakeServer();
    server.fileStatus = 'SCAN_PENDING';

    await assert.rejects(
      () => makeClient(server).waitUntilReady('file_1', { pollMs: 1, timeoutMs: 20 }),
      /SCAN_PENDING/
    );
  });
});

describe('FsClient — metadata encoding', () => {
  test('separators inside values cannot split a field', () => {
    const encoded = encodeMetadata({ sessionId: 'a;b=c', step: 'FRONT' });
    assert.equal(encoded, 'sessionId=a_b_c;step=FRONT');
    assert.equal(encoded.split(';').length, 2);
  });
});
