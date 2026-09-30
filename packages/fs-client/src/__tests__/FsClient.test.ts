import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FsClient, deterministicUuid, encodeMetadata, sha256Hex } from '../FsClient.js';
import { FsError } from '../types.js';

/**
 * Header names fs-core REJECTS on `POST`/`PUT /api/v1/files` (any one present —
 * even empty — is a 400 naming them all). Mirrors `legacyUploadHeaders` in
 * fs-core's `internal/handlers/upload/params.go` / the openapi 400 description.
 * `X-Upload-ID` is legacy on POST/PUT but legitimately still the header of
 * `DELETE /api/v1/files` (cancel), which the fake therefore does not check.
 */
const LEGACY_UPLOAD_HEADERS = [
  'x-virtual-path',
  'x-tags',
  'x-metadata',
  'x-visibility',
  'x-org-unit-id',
  'x-owner-user-id',
  'x-on-behalf-of',
  'x-content-sha256',
  'x-content-length',
  'x-content-type',
  'x-upload-id',
  'x-chunk-sha256',
  'x-comment',
  'content-range',
];

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Multipart part names in wire order, e.g. ['meta', 'file']. Empty for a bodiless request. */
  partOrder: string[];
  /** The decoded `meta` JSON (null when the request had none). */
  meta: Record<string, unknown> | null;
  /** Size of the `file`/`chunk` bytes part, 0 when there is none. */
  partBytes: number;
  /** Which bytes part was sent, if any. */
  partName: 'file' | 'chunk' | null;
}

/**
 * Stands in for the file-service. It enforces the REAL server's upload
 * contract (fs-core openapi.yaml `createFile`/`saveFileVersion`): the body
 * must be `multipart/form-data` with `meta` FIRST, legacy upload headers are a
 * 400, a hand-set Content-Type would break the boundary — so a client that
 * regresses to the old header protocol fails here exactly as it does live.
 * It also tracks how much of each upload session it holds and can be told to
 * drop a connection at a chosen point.
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
    const method = init?.method ?? 'GET';
    const headers = normaliseHeaders(init?.headers);
    const form = init?.body instanceof FormData ? init.body : null;
    const partOrder = form ? [...form.keys()] : [];
    const partName = form ? (partOrder.find((k) => k === 'file' || k === 'chunk') as 'file' | 'chunk' | undefined) ?? null : null;
    const part = partName && form ? (form.get(partName) as Blob) : null;
    const metaRaw = form?.get('meta');
    this.calls.push({
      url: u,
      method,
      headers,
      partOrder,
      meta: typeof metaRaw === 'string' ? (JSON.parse(metaRaw) as Record<string, unknown>) : null,
      partBytes: part?.size ?? 0,
      partName,
    });

    if (u.includes('/api/v1/files/') && method === 'GET') {
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

    if (u.endsWith('/api/v1/files') && method === 'POST') {
      const legacy = LEGACY_UPLOAD_HEADERS.filter((h) => h in headers);
      if (legacy.length > 0) {
        return json(400, {
          error: {
            code: 'BAD_REQUEST',
            message: `Header ${legacy.join(', ')} không còn được hỗ trợ`,
            detail: { headers: legacy },
          },
        });
      }
      const bad = multipartProblem(form, headers);
      if (bad) return json(400, { error: { code: 'BAD_REQUEST', message: bad } });

      const meta = this.calls[this.calls.length - 1].meta!;
      const range = typeof meta.content_range === 'string' ? meta.content_range : undefined;
      const uploadId = typeof meta.upload_id === 'string' ? meta.upload_id : '';

      // No content_range → whole file in one request.
      if (!range) return json(201, result(part?.size ?? 0));

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

/** What the real server checks about the multipart envelope itself (null = fine). */
function multipartProblem(form: FormData | null, headers: Record<string, string>): string | null {
  if (!form) return 'multipart/form-data không hợp lệ';
  // fetch must derive the Content-Type (with boundary) from the FormData; a
  // hand-set one is how a caller ends up with a body the server cannot parse.
  if ('content-type' in headers) return 'Content-Type không được đặt thủ công cho multipart';
  const keys = [...form.keys()];
  if (keys[0] !== 'meta') return 'meta phải là phần đầu tiên';
  if (keys.length > 2) return 'tối đa một phần bytes';
  if (keys.length === 2 && keys[1] !== 'file' && keys[1] !== 'chunk') return 'sai tên phần bytes';
  if (typeof form.get('meta') !== 'string') return 'meta phải là field text';
  return null;
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

const isDataChunk = (c: RecordedCall) =>
  typeof c.meta?.content_range === 'string' && !c.meta.content_range.startsWith('bytes */');
const isProbe = (c: RecordedCall) =>
  typeof c.meta?.content_range === 'string' && c.meta.content_range.startsWith('bytes */');

describe('FsClient — upload wire format (fs-core multipart contract)', () => {
  test('a whole-file upload is multipart: meta FIRST, then the file — and no legacy upload header is sent', async () => {
    const server = new FakeServer();
    const res = await makeClient(server, 1024).uploadRaw(input(100));
    assert.equal(res.fileId, 'file_1');

    const call = server.calls.find((c) => c.method === 'POST')!;
    assert.deepEqual(call.partOrder, ['meta', 'file'], 'meta must come first, then the bytes');
    assert.equal(call.partBytes, 100);

    for (const legacy of LEGACY_UPLOAD_HEADERS) {
      assert.ok(!(legacy in call.headers), `${legacy} is rejected by fs-core and must not be sent`);
    }
    assert.ok(!('content-type' in call.headers), 'Content-Type (with boundary) must come from FormData, not be set by hand');
    assert.equal(call.headers['x-api-key'], 'test-key');
    assert.equal(call.headers['idempotency-key'], 'sess_1:FRONT:1:raw', 'Idempotency-Key is still a real header');
  });

  test('the file attributes travel in meta, with exactly the fields fs-core documents', async () => {
    const server = new FakeServer();
    const data = new Uint8Array(10).fill(7);
    await makeClient(server, 1024).uploadRaw({
      virtualPath: 'students/ZZ001/front.jpg',
      data,
      mimeType: 'image/jpeg',
      idempotencyKey: 'k',
      visibility: 'public',
      tags: ['card', '2026'],
      metadata: { session_id: 'a;b=c', step: 'FRONT' },
    });

    const meta = server.calls.find((c) => c.method === 'POST')!.meta!;
    assert.deepEqual(meta, {
      virtual_path: 'students/ZZ001/front.jpg',
      content_type: 'image/jpeg',
      sha256: sha256Hex(data),
      size: 10,
      visibility: 'public',
      tags: ['card', '2026'],
      // A real JSON object now (was a url-encoded X-Metadata header), reserved characters intact.
      metadata: { session_id: 'a;b=c', step: 'FRONT' },
    });
  });

  test('optional attributes are omitted, never sent as empty/undefined (fs-core rejects unknown or malformed fields)', async () => {
    const server = new FakeServer();
    await makeClient(server, 1024).uploadRaw(input(5));

    const meta = server.calls.find((c) => c.method === 'POST')!.meta!;
    assert.deepEqual(Object.keys(meta).sort(), ['content_type', 'sha256', 'size', 'virtual_path']);
  });

  test('a photo-sized upload is sent in one request', async () => {
    // Chunking a few hundred kilobytes costs an extra round trip and buys
    // nothing; the service documents single-request as the normal path below
    // its ceiling.
    const server = new FakeServer();
    await makeClient(server, 1024).uploadRaw(input(100));

    const usedRange = server.calls.some((c) => c.meta?.content_range !== undefined);
    assert.ok(!usedRange, 'a small upload should not be split');
  });

  test('a small derived artefact goes in a single request', async () => {
    const server = new FakeServer();
    await makeClient(server, 4).uploadDirect({ ...input(100), virtualPath: 'card/3x4.jpg' });

    const single = server.calls.find((c) => c.method === 'POST' && c.meta?.content_range === undefined);
    assert.ok(single, 'expected one request without content_range');
    assert.equal(single!.partName, 'file');
    assert.equal(single!.partBytes, 100);
    assert.equal(single!.meta!.size, 100);
  });

  test('the fake really does reject the old header protocol (guards against this suite silently going soft)', async () => {
    const server = new FakeServer();
    const res = await server.fetch('http://fs-core:8080/api/v1/files', {
      method: 'POST',
      headers: { 'X-Virtual-Path': 'a.jpg', 'X-Content-SHA256': 'x', 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(3) as unknown as BodyInit,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /x-virtual-path, x-content-sha256 không còn được hỗ trợ/);
  });
});

describe('FsClient — chunked upload', () => {
  test('splits the payload and finishes on the last chunk', async () => {
    const server = new FakeServer();
    const client = makeClient(server, 4);

    const res = await client.uploadChunked(input(10));

    assert.equal(res.fileId, 'file_1');
    assert.equal(res.status, 'SCANNING');

    const dataChunks = server.calls.filter(isDataChunk);
    assert.equal(dataChunks.length, 3, '10 bytes at 4 per chunk = 3 chunks');
    assert.equal(dataChunks[0].meta!.content_range, 'bytes 0-3/10');
    assert.equal(dataChunks[2].meta!.content_range, 'bytes 8-9/10');
    for (const c of dataChunks) {
      assert.deepEqual(c.partOrder, ['meta', 'chunk'], 'each chunk is meta first, then a `chunk` part');
    }
    assert.deepEqual(dataChunks.map((c) => c.partBytes), [4, 4, 2]);
  });

  test('every chunk carries its own checksum and the upload id', async () => {
    const server = new FakeServer();
    await makeClient(server, 4).uploadChunked(input(10));

    const dataChunks = server.calls.filter(isDataChunk);
    const uploadIds = new Set(dataChunks.map((c) => c.meta!.upload_id));
    assert.equal(uploadIds.size, 1, 'all chunks belong to one session');
    for (const c of dataChunks) {
      assert.match(String(c.meta!.chunk_sha256), /^[0-9a-f]{64}$/);
      for (const legacy of LEGACY_UPLOAD_HEADERS) assert.ok(!(legacy in c.headers), `${legacy} must not be sent`);
    }
  });

  test('file attributes are sent only on the chunk that OPENS the session; later chunks carry just the session + range + checksum', async () => {
    const server = new FakeServer();
    const data = new Uint8Array(10).fill(7);
    await makeClient(server, 4).uploadChunked({
      virtualPath: 'video/big.mp4',
      data,
      mimeType: 'video/mp4',
      idempotencyKey: 'k',
      visibility: 'private',
    });

    const [first, second, third] = server.calls.filter(isDataChunk);
    assert.equal(first.meta!.virtual_path, 'video/big.mp4');
    assert.equal(first.meta!.content_type, 'video/mp4');
    assert.equal(first.meta!.visibility, 'private');
    assert.equal(first.meta!.sha256, sha256Hex(data), 'the WHOLE-file hash is declared up front');
    for (const later of [second, third]) {
      assert.deepEqual(
        Object.keys(later.meta!).sort(),
        ['chunk_sha256', 'content_range', 'upload_id'],
        'only what fs-core needs to continue a session'
      );
    }
  });

  test('the offset question is a meta-only multipart request: session id + `bytes */total`, no bytes part', async () => {
    const server = new FakeServer();
    await makeClient(server, 4).uploadChunked(input(10));

    const probe = server.calls.find(isProbe)!;
    assert.deepEqual(probe.partOrder, ['meta']);
    assert.deepEqual(Object.keys(probe.meta!).sort(), ['content_range', 'upload_id']);
    assert.equal(probe.meta!.content_range, 'bytes */10');
    for (const legacy of LEGACY_UPLOAD_HEADERS) assert.ok(!(legacy in probe.headers), `${legacy} must not be sent`);
  });

  test('the single-request ceiling is taken from the server, not assumed', async () => {
    // The limit is an operator setting. Rather than hardcoding it, an oversized
    // upload is attempted and the rejection states what the server will accept.
    const ranges: Array<string | undefined> = [];
    let rejectedOnce = false;

    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const meta = JSON.parse(String(form.get('meta'))) as { content_range?: string };
      ranges.push(meta.content_range);

      if (!meta.content_range && !rejectedOnce) {
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

      const range = meta.content_range ?? '';
      if (range.startsWith('bytes */')) {
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '0' } });
      }
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
    const chunked = ranges.filter((r): r is string => !!r && !r.startsWith('bytes */'));
    assert.ok(chunked.length > 1, 'the retry should be split into chunks');
    assert.ok(
      chunked.includes('bytes 0-3/20'),
      `chunks should use the size the server asked for, saw ${chunked.join(', ')}`
    );
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

    const probe = server.calls.find(isProbe);
    assert.ok(probe, 'retry must ask for the current offset first');

    const resent = server.calls.filter(isDataChunk);
    assert.equal(resent[0].meta!.content_range, 'bytes 4-7/12', 'resumes at byte 4, not 0');
    assert.ok(
      !('virtual_path' in resent[0].meta!),
      'a resumed chunk continues a session the server already holds, so it carries no file attributes'
    );
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

describe('FsClient — metadata encoding (deprecated header helper)', () => {
  // `encodeMetadata` built the `X-Metadata` header, which fs-core no longer
  // accepts (metadata is a JSON object inside multipart `meta` now). The
  // helper stays exported for compatibility only; it is no longer called.
  test('still encodes as a url-encoded JSON object', () => {
    const meta = { session_id: 'a;b=c', step: 'FRONT' };
    const encoded = encodeMetadata(meta);
    assert.equal(encoded, encodeURIComponent(JSON.stringify(meta)));
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), meta);
  });

  test('a value containing reserved characters (";", "=", "&") round-trips intact', () => {
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

describe('FsClient — updating content (PUT is multipart too)', () => {
  interface Seen {
    headers: Record<string, string>;
    partOrder: string[];
    meta: Record<string, unknown>;
    partBytes: number;
  }
  const capture = () => {
    const seen: Seen[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      seen.push({
        headers: normaliseHeaders(init.headers),
        partOrder: [...form.keys()],
        meta: JSON.parse(String(form.get('meta'))) as Record<string, unknown>,
        partBytes: (form.get('file') as Blob | null)?.size ?? 0,
      });
      return new Response(
        JSON.stringify({ file_id: 'f1', version: 2, etag: '"e2"', size: 3, unchanged: false }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    return { fetchImpl, seen };
  };

  test('the current etag is sent verbatim as the write condition (the one thing that stays a header)', async () => {
    // Without it the service answers 428 rather than guessing, because a write
    // that does not say which version it edits is the quietest way to lose data.
    const { fetchImpl, seen } = capture();
    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });

    await client.updateContent('f1', {
      etag: '"abc-1"',
      data: new Uint8Array([9, 9, 9]),
      mimeType: 'image/jpeg',
    });

    assert.equal(seen[0].headers['if-match'], '"abc-1"', 'quotes are part of the token');
  });

  test('the content hash, type and size are declared in meta so an identical write is recognised — and no legacy header is sent', async () => {
    // Measured against the running service: without the hash a save that
    // changes nothing still creates a version, and the history fills with
    // entries that differ from their predecessor in nothing at all.
    const { fetchImpl, seen } = capture();
    const client = new FsClient({ baseUrl: 'http://fs:8080', apiKey: 'k', fetchImpl });
    const data = new Uint8Array([9, 9, 9]);

    await client.updateContent('f1', { etag: '"abc-1"', data, mimeType: 'image/jpeg', comment: 'retouched' });

    assert.deepEqual(seen[0].partOrder, ['meta', 'file']);
    assert.deepEqual(seen[0].meta, {
      content_type: 'image/jpeg',
      sha256: sha256Hex(data),
      size: 3,
      comment: 'retouched',
    });
    assert.equal(seen[0].partBytes, 3);
    for (const legacy of LEGACY_UPLOAD_HEADERS) {
      assert.ok(!(legacy in seen[0].headers), `${legacy} is rejected by fs-core and must not be sent`);
    }
    assert.ok(!('content-type' in seen[0].headers), 'Content-Type (with boundary) must come from FormData');
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
