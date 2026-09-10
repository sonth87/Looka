import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingServerClient, EmbeddingServerError } from '../EmbeddingServerClient.js';

/**
 * Stands in for the external Face Enrollment API. Response bodies mirror
 * exactly what the real server returned during this task's live
 * verification pass against `http://10.20.107.17:8000` (health, enroll,
 * listFaces, a live 409 duplicate-identity, a live 422 no-face rejection,
 * deleteAllFaces, and a live 404 for an unknown embeddingId) — see the
 * task's own report for the raw transcripts.
 */
interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

class FakeServer {
  public calls: RecordedCall[] = [];
  public handler: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
    new Response(null, { status: 404 });

  public fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    // Built through a real `Request` (not just `init.headers` verbatim) so a
    // `FormData` body's auto-derived `Content-Type: multipart/form-data;
    // boundary=...` header — set by the fetch machinery during body
    // serialization, never present on `init.headers` itself — is actually
    // observable here, the same way it would be on a real request.
    const headers = normaliseHeaders(new Request(u, init).headers);
    this.calls.push({ url: u, method: init?.method ?? 'GET', headers });
    return this.handler(u, init ?? {});
  };
}

function normaliseHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeClient(server: FakeServer): EmbeddingServerClient {
  return new EmbeddingServerClient({
    baseUrl: 'http://10.20.107.17:8000',
    fetchImpl: server.fetch as unknown as typeof fetch,
  });
}

const jpegBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

describe('EmbeddingServerClient — health', () => {
  test('reports ok + modelsLoaded from a live-shaped 200 response', async () => {
    const server = new FakeServer();
    server.handler = () => json(200, { status: 'ok', models_loaded: true });

    const result = await makeClient(server).health();
    assert.deepEqual(result, { ok: true, modelsLoaded: true });
  });

  test('models_loaded: false means the server is still starting, not down', async () => {
    const server = new FakeServer();
    server.handler = () => json(200, { status: 'ok', models_loaded: false });

    const result = await makeClient(server).health();
    assert.deepEqual(result, { ok: true, modelsLoaded: false });
  });

  test('never throws — an unreachable server just reports ok: false', async () => {
    const server = new FakeServer();
    server.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await makeClient(server).health();
    assert.deepEqual(result, { ok: false, modelsLoaded: false });
  });
});

describe('EmbeddingServerClient — enrollFace', () => {
  test('builds a multipart POST to /users/{user_code}/faces with the image field named "image"', async () => {
    const server = new FakeServer();
    server.handler = () => json(201, { user_code: 'USR047161', embedding_id: 18, source_image_path: 'grace_hopper.jpg' });

    await makeClient(server).enrollFace('USR047161', jpegBlob(), 'grace_hopper.jpg');

    assert.equal(server.calls.length, 1);
    assert.equal(server.calls[0].method, 'POST');
    assert.equal(server.calls[0].url, 'http://10.20.107.17:8000/users/USR047161/faces');
    assert.match(server.calls[0].headers['content-type'] ?? '', /multipart\/form-data/);
  });

  test('URL-encodes a user_code that needs it', async () => {
    const server = new FakeServer();
    server.handler = () => json(201, { user_code: 'a b', embedding_id: 1, source_image_path: 'x.jpg' });
    await makeClient(server).enrollFace('a b', jpegBlob(), 'x.jpg');
    assert.equal(server.calls[0].url, 'http://10.20.107.17:8000/users/a%20b/faces');
  });

  test('a 201 resolves with the server-assigned embeddingId and sourceImagePath — matches the live response shape', async () => {
    const server = new FakeServer();
    server.handler = () => json(201, { user_code: 'USR047161', embedding_id: 18, source_image_path: 'grace_hopper.jpg' });

    const result = await makeClient(server).enrollFace('USR047161', jpegBlob(), 'grace_hopper.jpg');
    assert.deepEqual(result, { userCode: 'USR047161', embeddingId: 18, sourceImagePath: 'grace_hopper.jpg' });
  });

  test('embeddingId: null is handled, not asserted non-null (the server schema marks it optional)', async () => {
    const server = new FakeServer();
    server.handler = () => json(201, { user_code: 'USR047161', embedding_id: null, source_image_path: 'x.jpg' });

    const result = await makeClient(server).enrollFace('USR047161', jpegBlob(), 'x.jpg');
    assert.equal(result.embeddingId, null);
  });

  test('a 409 throws EmbeddingServerError with the live-observed DUPLICATE_IDENTITY shape', async () => {
    const server = new FakeServer();
    server.handler = () =>
      json(409, {
        detail: 'Khuôn mặt này đã được đăng ký cho mã TEST_LOOKA_VERIFY_20260910 (độ giống 1.00).',
        conflict_user_code: 'TEST_LOOKA_VERIFY_20260910',
        conflict_similarity: 1.0,
      });

    await assert.rejects(
      () => makeClient(server).enrollFace('TEST_LOOKA_VERIFY_20260910_DUP', jpegBlob(), 'x.jpg'),
      (err: EmbeddingServerError) => {
        assert.ok(err instanceof EmbeddingServerError);
        assert.equal(err.httpStatus, 409);
        assert.deepEqual(err.detail, {
          kind: 'DUPLICATE_IDENTITY',
          conflictUserCode: 'TEST_LOOKA_VERIFY_20260910',
          conflictSimilarity: 1.0,
        });
        assert.equal(err.retryable, false, '409 must never be auto-retried — see plan §6');
        return true;
      }
    );
  });

  test('a 422 throws IMAGE_REJECTED with the live-observed "no face" detail', async () => {
    const server = new FakeServer();
    server.handler = () => json(422, { detail: 'Không phát hiện khuôn mặt nào trong ảnh.' });

    await assert.rejects(
      () => makeClient(server).enrollFace('USR1', jpegBlob(), 'x.jpg'),
      (err: EmbeddingServerError) => {
        assert.equal(err.httpStatus, 422);
        assert.deepEqual(err.detail, { kind: 'IMAGE_REJECTED', detail: 'Không phát hiện khuôn mặt nào trong ảnh.' });
        assert.equal(err.retryable, false);
        return true;
      }
    );
  });

  test('a 400 throws EMPTY_OR_UNREADABLE', async () => {
    const server = new FakeServer();
    server.handler = () => json(400, { detail: 'Tệp rỗng hoặc không đọc được như một ảnh' });

    await assert.rejects(
      () => makeClient(server).enrollFace('USR1', jpegBlob(), 'x.jpg'),
      (err: EmbeddingServerError) => {
        assert.deepEqual(err.detail, { kind: 'EMPTY_OR_UNREADABLE' });
        assert.equal(err.retryable, false);
        return true;
      }
    );
  });

  test('a 413 throws FILE_TOO_LARGE', async () => {
    const server = new FakeServer();
    server.handler = () => json(413, { detail: 'Tệp vượt quá 15MB' });

    await assert.rejects(
      () => makeClient(server).enrollFace('USR1', jpegBlob(), 'x.jpg'),
      (err: EmbeddingServerError) => {
        assert.deepEqual(err.detail, { kind: 'FILE_TOO_LARGE' });
        assert.equal(err.retryable, false);
        return true;
      }
    );
  });

  test('a transport failure (server down / DNS / timeout) throws a retryable NETWORK_ERROR', async () => {
    const server = new FakeServer();
    server.fetch = async () => {
      throw new Error('fetch failed');
    };

    await assert.rejects(
      () => makeClient(server).enrollFace('USR1', jpegBlob(), 'x.jpg'),
      (err: EmbeddingServerError) => {
        assert.equal(err.httpStatus, 0);
        assert.equal(err.detail.kind, 'NETWORK_ERROR');
        assert.equal(err.retryable, true, 'a transport failure is exactly what the retry queue exists for');
        return true;
      }
    );
  });

  test('an unexpected 5xx is treated the same as a network failure — retryable', async () => {
    const server = new FakeServer();
    server.handler = () => json(503, { detail: 'Service Unavailable' });

    await assert.rejects(
      () => makeClient(server).enrollFace('USR1', jpegBlob(), 'x.jpg'),
      (err: EmbeddingServerError) => {
        assert.equal(err.httpStatus, 503);
        assert.equal(err.detail.kind, 'NETWORK_ERROR');
        assert.equal(err.retryable, true);
        return true;
      }
    );
  });
});

describe('EmbeddingServerClient — listFaces / deleteFace / deleteAllFaces', () => {
  test('listFaces maps the live-observed response shape to camelCase', async () => {
    const server = new FakeServer();
    server.handler = () =>
      json(200, {
        user_code: 'TEST_LOOKA_VERIFY_20260910',
        count: 1,
        images: [{ id: 18, source_image_path: 'grace_hopper.jpg', created_at: '2026-09-10T18:08:37.121010+07:00' }],
      });

    const result = await makeClient(server).listFaces('TEST_LOOKA_VERIFY_20260910');
    assert.deepEqual(result, {
      userCode: 'TEST_LOOKA_VERIFY_20260910',
      count: 1,
      images: [{ id: 18, sourceImagePath: 'grace_hopper.jpg', createdAt: '2026-09-10T18:08:37.121010+07:00' }],
    });
    assert.equal(server.calls[0].method, 'GET');
  });

  test('listFaces for a never-enrolled user_code returns an empty list, not an error', async () => {
    const server = new FakeServer();
    server.handler = () => json(200, { user_code: 'NEVER_SEEN', count: 0, images: [] });

    const result = await makeClient(server).listFaces('NEVER_SEEN');
    assert.equal(result.count, 0);
    assert.deepEqual(result.images, []);
  });

  test('deleteAllFaces reports how many rows were removed — matches the live-observed shape', async () => {
    const server = new FakeServer();
    server.handler = () => json(200, { user_code: 'TEST_LOOKA_VERIFY_20260910', deleted: 1 });

    const result = await makeClient(server).deleteAllFaces('TEST_LOOKA_VERIFY_20260910');
    assert.deepEqual(result, { userCode: 'TEST_LOOKA_VERIFY_20260910', deleted: 1 });
    assert.equal(server.calls[0].method, 'DELETE');
    assert.equal(server.calls[0].url, 'http://10.20.107.17:8000/users/TEST_LOOKA_VERIFY_20260910/faces');
  });

  test('deleteFace targets the specific embedding_id in the path', async () => {
    const server = new FakeServer();
    server.handler = () => json(200, { user_code: 'USR1', deleted: 1 });

    await makeClient(server).deleteFace('USR1', 18);
    assert.equal(server.calls[0].url, 'http://10.20.107.17:8000/users/USR1/faces/18');
  });

  test('deleting an unknown embedding_id throws NOT_FOUND — matches the live-observed 404 shape', async () => {
    const server = new FakeServer();
    server.handler = () => json(404, { detail: 'Không có ảnh id=999999 của USR1.' });

    await assert.rejects(
      () => makeClient(server).deleteFace('USR1', 999_999),
      (err: EmbeddingServerError) => {
        assert.equal(err.httpStatus, 404);
        assert.deepEqual(err.detail, { kind: 'NOT_FOUND' });
        return true;
      }
    );
  });
});

describe('EmbeddingServerClient — search', () => {
  test('maps faces[].matches[] to camelCase and forwards limit/min_similarity as query params', async () => {
    const server = new FakeServer();
    server.handler = () =>
      json(200, {
        face_count: 1,
        faces: [
          {
            bbox: [1204, 380, 1663, 953],
            face_size_px: 459,
            is_live: true,
            matches: [{ user_code: 'USR000051', similarity: 0.6894, embedding_id: 3, source_image_path: 'portrait.jpg' }],
          },
        ],
      });

    const result = await makeClient(server).search(jpegBlob(), { limit: 5, minSimilarity: 0.3 });
    assert.equal(server.calls[0].url, 'http://10.20.107.17:8000/search?limit=5&min_similarity=0.3');
    assert.deepEqual(result, [
      {
        bbox: [1204, 380, 1663, 953],
        faceSizePx: 459,
        isLive: true,
        matches: [{ userCode: 'USR000051', similarity: 0.6894, embeddingId: 3, sourceImagePath: 'portrait.jpg' }],
      },
    ]);
  });

  test('omits query params entirely when no options are passed', async () => {
    const server = new FakeServer();
    server.handler = () => json(200, { face_count: 0, faces: [] });

    await makeClient(server).search(jpegBlob());
    assert.equal(server.calls[0].url, 'http://10.20.107.17:8000/search');
  });
});
