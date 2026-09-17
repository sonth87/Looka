import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@app/shared/security/secret.codec';
import {
  EligibilityApiConfig,
  EligibilityHttpClient,
} from './eligibility-http.client';

const ORIGINAL_KEY = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;

function makeConfig(
  overrides: Partial<EligibilityApiConfig> = {},
): EligibilityApiConfig {
  return {
    baseUrl: 'https://example.test',
    requestMethod: 'POST',
    requestPath: '/api/lookup',
    requestBodyTemplate: { student_code: '{{key}}', course_year: 0 },
    authType: 'API_KEY_HEADER',
    authParamName: 'x-api-key',
    credentialCiphertext: encryptSecret('real-api-key'),
    keyResponsePath: 'data[0].student_code',
    ...overrides,
  };
}

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  body: unknown;
}) {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    text: () => Promise.resolve(JSON.stringify(response.body)),
  } as unknown as Response);
}

describe('EligibilityHttpClient', () => {
  const client = new EligibilityHttpClient();

  beforeEach(() => {
    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY ??=
      randomBytes(32).toString('base64');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('substitutes {{key}} into the request body and sends the decrypted credential as the configured header', async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      body: {
        success: true,
        data: [{ student_code: 'SV001', full_name: 'Nguyen Van A' }],
      },
    });

    const outcome = await client.lookup(makeConfig(), 'SV001');

    expect(outcome.kind).toBe('Success');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://example.test/api/lookup');
    expect((init as RequestInit).headers).toMatchObject({
      'x-api-key': 'real-api-key',
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      student_code: 'SV001',
      course_year: 0,
    });
  });

  it('extracts the record using keyResponsePath (parent of the key field)', async () => {
    mockFetchOnce({
      ok: true,
      body: { data: [{ student_code: 'SV001', full_name: 'Nguyen Van A' }] },
    });

    const outcome = await client.lookup(makeConfig(), 'SV001');

    expect(outcome.kind).toBe('Success');
    if (outcome.kind === 'Success') {
      expect(outcome.value.record).toEqual({
        student_code: 'SV001',
        full_name: 'Nguyen Van A',
      });
      expect(outcome.value.raw).toEqual({
        data: [{ student_code: 'SV001', full_name: 'Nguyen Van A' }],
      });
    }
  });

  it('falls back to guessing the record shape when keyResponsePath is unset (first-ever test call)', async () => {
    mockFetchOnce({ ok: true, body: { data: [{ student_code: 'SV002' }] } });

    const outcome = await client.lookup(
      makeConfig({ keyResponsePath: undefined }),
      'SV002',
    );

    expect(outcome.kind).toBe('Success');
    if (outcome.kind === 'Success') {
      expect(outcome.value.record).toEqual({ student_code: 'SV002' });
    }
  });

  it('is Terminal when auth is required but no credential is configured', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const outcome = await client.lookup(
      makeConfig({ credentialCiphertext: undefined }),
      'SV001',
    );

    expect(outcome.kind).toBe('Terminal');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is Terminal on a non-2xx HTTP response', async () => {
    mockFetchOnce({ ok: false, status: 401, body: { message: 'invalid key' } });
    const outcome = await client.lookup(makeConfig(), 'SV001');
    expect(outcome.kind).toBe('Terminal');
  });

  it('is Retryable when the network call itself throws', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const outcome = await client.lookup(makeConfig(), 'SV001');
    expect(outcome.kind).toBe('Retryable');
  });

  it('builds a GET request with the template substituted into query params, no body', async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      body: { student_code: 'SV003' },
    });

    await client.lookup(
      makeConfig({
        requestMethod: 'GET',
        requestBodyTemplate: { code: '{{key}}' },
      }),
      'SV003',
    );

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://example.test/api/lookup?code=SV003');
    expect((init as RequestInit).body).toBeUndefined();
  });
});
