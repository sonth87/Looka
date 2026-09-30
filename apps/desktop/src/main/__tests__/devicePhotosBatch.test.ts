import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FsError, FS_ERROR_CODES, deterministicUuid } from '@face/fs-client';
import type { BatchUploadOutcome, UploadInput } from '@face/fs-client';
import { DeviceApiClient } from '../deviceApi.js';
import type { DevicePhotoInput, DevicePhotoPushResult } from '../deviceApi.js';
import { ApiPhotoUploadClient, mapDevicePhotoBatchResults } from '../uploads.js';

/**
 * 1-n photo upload, kiosk side: `DeviceApiClient.pushDevicePhotos` (the HTTP
 * call), `mapDevicePhotoBatchResults` (per-photo server result -> retryable
 * vs permanent), and `ApiPhotoUploadClient.uploadBatch` (the `UploadWorker`
 * adapter). Same "no Electron needed" approach as the other suites here —
 * the device identity and `fetch` are both injected.
 */

const CREDS = {
  deviceId: 'dev-1',
  deviceSecret: 'secret-1',
  campaignId: 'camp-1',
  apiBaseUrl: 'https://api.example.test',
};

function photo(n: number): DevicePhotoInput {
  return {
    photoId: `00000000-0000-4000-8000-00000000000${n}`,
    sessionId: 'sess-1',
    stepId: `step-${n}`,
    attempt: 1,
    dataUrl: 'data:image/jpeg;base64,AAAA',
  };
}

interface FakeCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DeviceApiClient.pushDevicePhotos', () => {
  test('POSTs { photos } to /v1/devices/photos with the device headers, and returns the per-photo results', async () => {
    const results: DevicePhotoPushResult[] = [
      { photoId: photo(1).photoId, ok: true },
      { photoId: photo(2).photoId, ok: false, statusCode: 403, message: 'nope' },
    ];
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ statusCode: 201, message: 'ok', data: { requested: 2, succeeded: 1, failed: 1, results } })
    );
    const client = new DeviceApiClient(impl, () => CREDS);

    const got = await client.pushDevicePhotos([photo(1), photo(2)]);

    assert.deepEqual(got, results);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/devices/photos');
    assert.equal(calls[0].init.method, 'POST');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers['x-device-id'], 'dev-1');
    assert.equal(headers['x-device-secret'], 'secret-1');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body as string), { photos: [photo(1), photo(2)] });
  });

  test('no device credentials -> retryable FsError(0), and no request is made', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({}));
    const client = new DeviceApiClient(impl, () => null);

    await assert.rejects(
      () => client.pushDevicePhotos([photo(1)]),
      (err: unknown) => err instanceof FsError && err.httpStatus === 0 && err.retryable
    );
    assert.equal(calls.length, 0);
  });

  test('a network error -> retryable FsError(0, NETWORK)', async () => {
    const impl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const client = new DeviceApiClient(impl, () => CREDS);

    await assert.rejects(
      () => client.pushDevicePhotos([photo(1)]),
      (err: unknown) =>
        err instanceof FsError &&
        err.httpStatus === 0 &&
        err.code === FS_ERROR_CODES.NETWORK &&
        err.retryable &&
        /ECONNRESET/.test(err.message)
    );
  });

  test('a whole-request 400 -> non-retryable FsError(400) carrying the server text', async () => {
    const { impl } = fakeFetch(() => new Response('photos must be an array', { status: 400 }));
    const client = new DeviceApiClient(impl, () => CREDS);

    await assert.rejects(
      () => client.pushDevicePhotos([photo(1), photo(2)]),
      (err: unknown) =>
        err instanceof FsError &&
        err.httpStatus === 400 &&
        !err.retryable &&
        /devices\/photos batch 400/.test(err.message) &&
        /photos must be an array/.test(err.message)
    );
  });

  test('a whole-request 503 -> retryable FsError(503)', async () => {
    const { impl } = fakeFetch(() => new Response('down', { status: 503 }));
    const client = new DeviceApiClient(impl, () => CREDS);

    await assert.rejects(
      () => client.pushDevicePhotos([photo(1)]),
      (err: unknown) => err instanceof FsError && err.httpStatus === 503 && err.retryable
    );
  });

  test('a 2xx whose data has no results array -> retryable FsError, never a fabricated success', async () => {
    // e.g. an old API that answered the legacy `{ photoId }` shape.
    const { impl } = fakeFetch(() => jsonResponse({ statusCode: 201, message: 'ok', data: { photoId: 'x' } }));
    const client = new DeviceApiClient(impl, () => CREDS);

    await assert.rejects(
      () => client.pushDevicePhotos([photo(1), photo(2)]),
      (err: unknown) => err instanceof FsError && err.httpStatus === 0 && err.retryable
    );
  });

  test('a 2xx with an unparseable body -> retryable FsError', async () => {
    const { impl } = fakeFetch(() => new Response('<html>', { status: 201 }));
    const client = new DeviceApiClient(impl, () => CREDS);

    await assert.rejects(
      () => client.pushDevicePhotos([photo(1)]),
      (err: unknown) => err instanceof FsError && err.httpStatus === 0 && err.retryable
    );
  });

  test('the single pushDevicePhoto keeps sending the legacy bare body', async () => {
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ statusCode: 201, message: 'ok', data: { photoId: photo(1).photoId } })
    );
    const client = new DeviceApiClient(impl, () => CREDS);

    const got = await client.pushDevicePhoto(photo(1));

    assert.deepEqual(got, { photoId: photo(1).photoId });
    assert.deepEqual(JSON.parse(calls[0].init.body as string), photo(1));
  });
});

/**
 * Asserts `o` is a failed outcome and returns its `FsError`. Narrows with
 * `in` rather than the `ok` discriminant on purpose: this package's
 * `tsconfig.electron.json` is not `strict`, and boolean-literal discriminant
 * narrowing does not work without `strictNullChecks`.
 */
function failureOf(o: BatchUploadOutcome): FsError {
  if (!('error' in o)) throw new Error('expected a failed outcome');
  if (!(o.error instanceof FsError)) throw new Error('expected an FsError');
  return o.error;
}

function uploadInput(n: number, over: Partial<UploadInput> = {}): UploadInput {
  return {
    virtualPath: `face/2026/sess-1/step-${n}-1.jpg`,
    data: new Uint8Array(n * 10),
    mimeType: 'image/jpeg',
    idempotencyKey: `sess-1:step-${n}:1:face`,
    ...over,
  };
}

describe('mapDevicePhotoBatchResults', () => {
  test('matches results to inputs by photoId, not by position', () => {
    const inputs = [uploadInput(1), uploadInput(2)];
    const ids = inputs.map((i) => deterministicUuid(i.idempotencyKey));
    // Server answered in the opposite order.
    const results: DevicePhotoPushResult[] = [
      { photoId: ids[1], ok: false, statusCode: 400, message: 'bad data url' },
      { photoId: ids[0], ok: true },
    ];

    const outcomes = mapDevicePhotoBatchResults(ids, results, inputs);

    assert.equal(outcomes.length, 2);
    assert.ok(outcomes[0].ok, 'input 0 succeeded');
    assert.ok(!outcomes[1].ok, 'input 1 failed');
  });

  test('a successful photo becomes a READY local: result sized from its own input', () => {
    const inputs = [uploadInput(3, { visibility: 'public' })];
    const ids = [deterministicUuid(inputs[0].idempotencyKey)];

    const [outcome] = mapDevicePhotoBatchResults(ids, [{ photoId: ids[0], ok: true }], inputs);

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.result.fileId, `local:${ids[0]}`);
      assert.equal(outcome.result.status, 'READY');
      assert.equal(outcome.result.size, 30);
      assert.equal(outcome.result.virtualPath, inputs[0].virtualPath);
      assert.equal(outcome.result.visibility, 'public');
    }
  });

  test('a 403 is permanent, a 400 is permanent, a 503 and a 429 are retryable', () => {
    const inputs = [uploadInput(1), uploadInput(2), uploadInput(3), uploadInput(4)];
    const ids = inputs.map((i) => deterministicUuid(i.idempotencyKey));
    const results: DevicePhotoPushResult[] = [
      { photoId: ids[0], ok: false, statusCode: 403, message: 'other device' },
      { photoId: ids[1], ok: false, statusCode: 400, message: 'bad' },
      { photoId: ids[2], ok: false, statusCode: 503, message: 'db down' },
      { photoId: ids[3], ok: false, statusCode: 429, message: 'slow down' },
    ];

    const outcomes = mapDevicePhotoBatchResults(ids, results, inputs);
    const retryable = outcomes.map((o) => failureOf(o).retryable);

    assert.deepEqual(retryable, [false, false, true, true]);
    const first = failureOf(outcomes[0]);
    assert.equal(first.httpStatus, 403);
    assert.match(first.message, /other device/);
  });

  test('a photo the server did not answer for is retryable, never a success or a permanent loss', () => {
    const inputs = [uploadInput(1), uploadInput(2)];
    const ids = inputs.map((i) => deterministicUuid(i.idempotencyKey));

    const outcomes = mapDevicePhotoBatchResults(ids, [{ photoId: ids[0], ok: true }], inputs);

    assert.ok(outcomes[0].ok);
    const missing = failureOf(outcomes[1]);
    assert.ok(missing.retryable);
    assert.match(missing.message, /no result/);
  });

  test('a failure with no statusCode is treated as retryable (status 0)', () => {
    const inputs = [uploadInput(1)];
    const ids = [deterministicUuid(inputs[0].idempotencyKey)];

    const [outcome] = mapDevicePhotoBatchResults(ids, [{ photoId: ids[0], ok: false }], inputs);

    assert.ok(failureOf(outcome).retryable);
  });
});

describe('ApiPhotoUploadClient (batch side)', () => {
  function makeClient(pushDevicePhotos: (inputs: DevicePhotoInput[]) => Promise<DevicePhotoPushResult[]>) {
    const requests: DevicePhotoInput[][] = [];
    const deviceClient = {
      pushDevicePhotos: async (inputs: DevicePhotoInput[]) => {
        requests.push(inputs);
        return pushDevicePhotos(inputs);
      },
    };
    const client = new ApiPhotoUploadClient(
      { baseUrl: 'http://fs.example.test', apiKey: 'k' },
      deviceClient as unknown as DeviceApiClient
    );
    return { client, requests };
  }

  test('canBatch: photos yes, videos no', () => {
    const { client } = makeClient(async () => []);
    assert.equal(client.canBatch({ virtualPath: 'face/2026/sess-1/a.jpg' }), true);
    assert.equal(client.canBatch({ virtualPath: 'video/2026/sess-1/a.webm' }), false);
  });

  test('uploadBatch sends every photo in ONE request and returns outcomes in input order', async () => {
    const { client, requests } = makeClient(async (reqs) => reqs.map((r) => ({ photoId: r.photoId, ok: true })));
    const inputs = [uploadInput(1), uploadInput(2), uploadInput(3)];

    const outcomes = await client.uploadBatch(inputs);

    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests[0].map((r) => r.stepId),
      ['step-1', 'step-2', 'step-3']
    );
    assert.equal(requests[0][0].photoId, deterministicUuid(inputs[0].idempotencyKey));
    assert.match(requests[0][0].dataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(outcomes.length, 3);
    assert.ok(outcomes.every((o) => o.ok));
  });

  test('per-photo transport fields (identityNumber/userCode/operatorUserId) ride along like the single route', async () => {
    const { client, requests } = makeClient(async (reqs) => reqs.map((r) => ({ photoId: r.photoId, ok: true })));
    await client.uploadBatch([
      uploadInput(1, { metadata: { identityNumber: '001', userCode: 'U1', operatorUserId: 'op-1' } }),
      uploadInput(2),
    ]);

    assert.equal(requests[0][0].identityNumber, '001');
    assert.equal(requests[0][0].userCode, 'U1');
    assert.equal(requests[0][0].operatorUserId, 'op-1');
    assert.equal(requests[0][1].identityNumber, undefined);
  });

  test('an unparseable idemKey fails only that item and is left out of the request; the rest merge back in order', async () => {
    const { client, requests } = makeClient(async (reqs) => reqs.map((r) => ({ photoId: r.photoId, ok: true })));
    const inputs = [uploadInput(1), uploadInput(2, { idempotencyKey: 'garbage' }), uploadInput(3)];

    const outcomes = await client.uploadBatch(inputs);

    assert.deepEqual(
      requests[0].map((r) => r.stepId),
      ['step-1', 'step-3'],
      'the bad item never reaches the server'
    );
    assert.equal(outcomes.length, 3);
    assert.ok(outcomes[0].ok);
    assert.match(failureOf(outcomes[1]).message, /garbage/);
    assert.ok(outcomes[2].ok);
  });

  test('when nothing parses, no request is made at all', async () => {
    const { client, requests } = makeClient(async () => []);

    const outcomes = await client.uploadBatch([uploadInput(1, { idempotencyKey: 'x' }), uploadInput(2, { idempotencyKey: 'y' })]);

    assert.equal(requests.length, 0);
    assert.ok(outcomes.every((o) => !o.ok));
  });

  test('a per-photo server rejection stays per-photo', async () => {
    const { client } = makeClient(async (reqs) =>
      reqs.map((r, i) => (i === 1 ? { photoId: r.photoId, ok: false, statusCode: 403, message: 'other device' } : { photoId: r.photoId, ok: true }))
    );

    const outcomes = await client.uploadBatch([uploadInput(1), uploadInput(2), uploadInput(3)]);

    assert.deepEqual(
      outcomes.map((o) => o.ok),
      [true, false, true]
    );
  });

  test('a whole-request failure propagates so UploadWorker can decide (fallback vs retry)', async () => {
    const { client } = makeClient(async () => {
      throw new FsError(400, FS_ERROR_CODES.HTTP, 'old api');
    });

    await assert.rejects(
      () => client.uploadBatch([uploadInput(1), uploadInput(2)]),
      (err: unknown) => err instanceof FsError && err.httpStatus === 400
    );
  });
});
