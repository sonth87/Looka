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
  /**
   * Mirrors the real server's live-confirmed (2026-09-09) behaviour for the
   * plain metadata GET, NOT what the integration guide/this fake originally
   * assumed (a flat 200 + status body at every stage): while a file is not
   * yet READY, `GET /api/v1/files/:id` itself answers 423 SCAN_PENDING —
   * the same status code documented for the byte-fetching `/download`
   * route — rather than 200 with a `status` field. See `FsClient.getFile`'s
   * own doc comment.
   */
  public scanPendingAs423 = false;

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
      if (this.scanPendingAs423 && this.fileStatus !== 'READY') {
        return json(423, {
          error: {
            code: 'SCAN_PENDING',
            message: 'File đang chờ quét virus, chưa thể tải về',
            detail: { status: this.fileStatus },
          },
        });
      }
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

    const res = await client.uploadChunked(input(10));

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
    await makeClient(server, 4).uploadChunked(input(10));

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

  test('a photo-sized upload is sent in one request', async () => {
    // Chunking a few hundred kilobytes costs an extra round trip and buys
    // nothing; the service documents single-request as the normal path below
    // its ceiling.
    const server = new FakeServer();
    await makeClient(server, 1024).uploadRaw(input(100));

    const usedRange = server.calls.some((c) => c.headers['content-range']);
    assert.ok(!usedRange, 'a small upload should not be split');
  });

  test('the single-request ceiling is taken from the server, not assumed', async () => {
    // The limit is an operator setting. Rather than hardcoding it, an oversized
    // upload is attempted and the rejection states what the server will accept.
    const calls: Array<Record<string, string>> = [];
    let rejectedOnce = false;

    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ])
      );
      calls.push(headers);

      if (!headers['content-range'] && !rejectedOnce) {
        rejectedOnce = true;
        return new Response(
          JSON.stringify({
            error: {
              code: 'BAD_REQUEST',
              message: 'payload above the single-request limit',
              detail: { max_single_request: 8, chunk_size: 4 },
            },
          }),
          { status: 400 }
        );
      }

      const range = headers['content-range'] ?? '';
      const end = Number(range.replace(/^bytes \d+-/, '').split('/')[0]);
      if (end < 19) {
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(end + 1) } });
      }
      return new Response(
        JSON.stringify({ file_id: 'file_1', status: 'SCANNING', size: 20, etag: 'e', version: 1 }),
        { status: 201 }
      );
    }) as unknown as typeof fetch;

    const client = new FsClient({
      baseUrl: 'http://fs-core:8080',
      apiKey: 'test-key',
      fetchImpl,
    });

    await client.upload(input(20));

    assert.ok(rejectedOnce, 'the single request should have been attempted first');
    const chunked = calls.filter((c) => c['content-range']);
    assert.ok(chunked.length > 1, 'the retry should be split into chunks');
    assert.ok(
      chunked.some((c) => c['content-range'] === 'bytes 0-3/20'),
      `chunks should use the size the server asked for, saw ${chunked
        .map((c) => c['content-range'])
        .join(', ')}`
    );
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
    await assert.rejects(() => client.uploadChunked(input(12)), FsError);

    const beforeRetry = server.calls.length;
    server.calls = [];

    // Same idempotency key → same upload session → server reports what it has.
    const res = await client.uploadChunked(input(12));
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

  test('the upload id is a real UUID (version+variant nibbles), not just UUID-shaped hex', () => {
    // 2026-09-09 field bug: a raw hash slice satisfies the shape regex above
    // but not this stricter one — apps/api's `@IsUUID()` DTO validators use
    // the strict check, which only ~7.8% of raw hash slices pass by chance,
    // so most kiosk photo uploads were permanently rejected with "photoId
    // must be a UUID". Every key here is chosen so a pre-fix run would have
    // failed at least one of them.
    for (const key of ['sess_1:FRONT:1:raw', 'sess_1:LEFT:2:face', 'sess_1:RIGHT:2:face', 'x', 'y', 'z']) {
      assert.match(
        deterministicUuid(key),
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        `deterministicUuid(${key}) must be a syntactically valid v4-shaped UUID`
      );
    }
  });
});

describe('FsClient — error classification', () => {
  test('a server fault is retryable; a rejected request is not', async () => {
    const serverFault = new FakeServer();
    serverFault.failOnChunk(0, 'server');
    await assert.rejects(
      () => makeClient(serverFault, 4).uploadChunked(input(8)),
      (err: FsError) => {
        assert.equal(err.httpStatus, 503);
        assert.equal(err.retryable, true, '503 should be retried');
        return true;
      }
    );

    const clientFault = new FakeServer();
    clientFault.failOnChunk(0, 'client');
    await assert.rejects(
      () => makeClient(clientFault, 4).uploadChunked(input(8)),
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
      () => makeClient(server, 4).uploadChunked(input(8)),
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

  // Confirmed live against a real fs-core deployment (2026-09-09): the plain
  // metadata `getFile` answers 423 SCAN_PENDING while a file is mid-scan,
  // not 200 + a status body — see FakeServer.scanPendingAs423 and
  // FsClient.getFile's own doc comment. Before this fix, that 423 propagated
  // straight out of getFile as a thrown FsError, which waitUntilReady's poll
  // loop never got a chance to treat as "still working" (the throw happens
  // before its own allowlist check runs) — every wait for a real, currently
  // still-scanning file failed immediately instead of polling it out.
  test('getFile recovers a SCAN_PENDING status from a 423, instead of throwing', async () => {
    const server = new FakeServer();
    server.scanPendingAs423 = true;
    server.fileStatus = 'SCAN_PENDING';

    const info = await makeClient(server).getFile('file_1');
    assert.equal(info.status, 'SCAN_PENDING');
  });

  test('waitUntilReady polls through a real server\'s 423-for-SCAN_PENDING and returns once READY', async () => {
    const server = new FakeServer();
    server.scanPendingAs423 = true;
    server.fileStatus = 'SCAN_PENDING';

    const wait = makeClient(server).waitUntilReady('file_1', { pollMs: 5, timeoutMs: 200 });
    // Flips to READY after the first poll has definitely happened — proving
    // this is an actual retry loop reaching a real resolution, not just a
    // one-shot translation that happens to look fine on the first call.
    setTimeout(() => {
      server.fileStatus = 'READY';
    }, 20);

    const info = await wait;
    assert.equal(info.status, 'READY');
  });

  // A file that is genuinely gone (deleted, or purged by the server's own
  // retention/scan pipeline before ever reaching READY — exactly what the
  // live 2026-09-09 check against a real fs-core instance saw a few seconds
  // after SCAN_PENDING) must still fail rather than being mistaken for a
  // pending scan: only the SCAN_PENDING code is translated, every other
  // error still propagates.
  test('a genuinely missing file still throws NOT_FOUND, not a fabricated pending state', async () => {
    const server = new FakeServer();
    server.fetch = async () => json(404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });

    await assert.rejects(() => makeClient(server).getFile('file_1'), /NOT_FOUND/);
  });
});

describe('FsClient — metadata encoding', () => {
  // fs-engine v0.2.10 (2026-09-09): X-Metadata is encodeURIComponent(JSON.stringify(obj)),
  // not the old `k1=v1;k2=v2` string join — see encodeMetadata's own doc comment.
  test('encodes as a url-encoded JSON object', () => {
    const meta = { session_id: 'a;b=c', step: 'FRONT' };
    const encoded = encodeMetadata(meta);
    assert.equal(encoded, encodeURIComponent(JSON.stringify(meta)));
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), meta);
  });

  test('a value containing reserved characters (";", "=", "&") round-trips intact', () => {
    // The old format silently mangled these by replacing them with "_"; JSON
    // encoding must preserve them exactly.
    const meta = { ref_id: 'a;b=c&d' };
    const encoded = encodeMetadata(meta);
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), meta);
  });
});

describe('FsClient — cold storage', () => {
  const thawingThenBytes = () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ status: 'THAWING', detail: { retry_after: 0 } }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  };

  test('a thaw notice is not returned as file content', async () => {
    // 202 carries JSON explaining the file is being restored. Treating every
    // sub-400 status as content hands that notice back as if it were the image:
    // nothing throws and the bytes are simply wrong.
    const { fetchImpl } = thawingThenBytes();
    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });

    await assert.rejects(
      () => client.download('file_1'),
      (err: FsError) => {
        assert.equal(err.httpStatus, 202);
        assert.equal(err.code, 'THAWING');
        return true;
      }
    );
  });

  test('downloadWhenWarm waits out the thaw and returns the bytes', async () => {
    const { fetchImpl, calls } = thawingThenBytes();
    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });

    const bytes = await client.downloadWhenWarm('file_1', { timeoutMs: 5_000 });
    assert.deepEqual([...bytes], [1, 2, 3]);
    assert.equal(calls(), 2, 'should have retried once after the notice');
  });
});

describe('FsClient — updating content', () => {
  const captureHeaders = () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(
        Object.fromEntries(
          Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ])
        )
      );
      return new Response(
        JSON.stringify({ file_id: 'f1', version: 2, etag: '"e2"', size: 3, unchanged: false }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    return { fetchImpl, seen };
  };

  test('the current etag is sent verbatim as the write condition', async () => {
    // Without it the service answers 428 rather than guessing, because a write
    // that does not say which version it edits is the quietest way to lose data.
    const { fetchImpl, seen } = captureHeaders();
    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });

    await client.updateContent('f1', {
      etag: '"abc-1"',
      data: new Uint8Array([9, 9, 9]),
      mimeType: 'image/jpeg',
    });

    assert.equal(seen[0]['if-match'], '"abc-1"', 'quotes are part of the token');
  });

  test('the content hash is sent so an identical write is recognised', async () => {
    // Measured against the running service: without this header a save that
    // changes nothing still creates a version, and the history fills with
    // entries that differ from their predecessor in nothing at all.
    const { fetchImpl, seen } = captureHeaders();
    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });

    await client.updateContent('f1', {
      etag: '"abc-1"',
      data: new Uint8Array([9, 9, 9]),
      mimeType: 'image/jpeg',
    });

    assert.match(seen[0]['x-content-sha256'], /^[0-9a-f]{64}$/);
  });

  test('a losing write reports the conflict rather than overwriting', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: { code: 'VERSION_CONFLICT', message: 'stale', detail: { latest_etag: '"e9"' } },
        }),
        { status: 409 }
      )) as unknown as typeof fetch;

    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });

    await assert.rejects(
      () =>
        client.updateContent('f1', {
          etag: '"stale"',
          data: new Uint8Array([1]),
          mimeType: 'image/jpeg',
        }),
      (err: FsError) => {
        assert.equal(err.httpStatus, 409);
        assert.equal(err.code, 'VERSION_CONFLICT');
        assert.equal(err.retryable, false, 'retrying the same stale etag cannot succeed');
        return true;
      }
    );
  });
});
