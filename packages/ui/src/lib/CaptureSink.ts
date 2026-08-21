/**
 * Where captures are sent to be kept.
 *
 * The capture screen is shared, but where a photo belongs is not: the desktop
 * kiosk hands it to its main process, which owns the local queue and the
 * file-service key, while the web app posts it to a backend for the same reason
 * — that key is namespace-wide and must never reach a browser.
 *
 * Splitting it out is what lets the screen stop reaching for a database of its
 * own, which it could only ever have in the one place it should not.
 */
export interface CaptureSink {
  /** Open a record for this run. The returned id identifies it from here on. */
  startSession(input: { subjectCode?: string; subjectName?: string }): Promise<string>;

  /**
   * Store one capture, as its step completes.
   *
   * Per photo rather than per session: a run interrupted at the fourth step
   * should keep the three already taken, not discard them for want of a fifth.
   */
  savePhoto(input: {
    sessionId: string;
    stepId: string;
    attempt: number;
    dataUrl: string;
  }): Promise<void>;

  /** Mark the run finished. */
  completeSession(sessionId: string): Promise<void>;
}

/**
 * Posts captures to a backend over HTTP.
 *
 * Carries no credentials of its own — the backend holds them. What travels from
 * the browser is the image and which step it belongs to, nothing that would let
 * a page reach the file-service directly.
 */
export class HttpCaptureSink implements CaptureSink {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The backend's ApiKeyMiddleware rejects every /v1/sessions and
        // /v1/photos request without this - see apps/api's api-key.middleware.ts.
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Read the message the API sent rather than reporting a bare status: it
      // is the difference between "something failed" and a line an operator can
      // act on without opening a network panel.
      const text = await res.text().catch(() => '');
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed?.message) message = parsed.message;
      } catch {
        /* not JSON; the raw text is the best available */
      }
      throw new Error(`${res.status}: ${message}`);
    }

    // Every response body is { statusCode, message, data } - the API's global
    // ResponseTransformInterceptor adds that envelope to every handler's
    // return value, so callers here unwrap it rather than each endpoint
    // re-declaring the same shape.
    const envelope = (await res.json()) as { data: T };
    return envelope.data;
  }

  public async startSession(input: {
    subjectCode?: string;
    subjectName?: string;
  }): Promise<string> {
    const data = await this.post<{ id: string }>('/v1/sessions', input);
    return data.id;
  }

  public async savePhoto(input: {
    sessionId: string;
    stepId: string;
    attempt: number;
    dataUrl: string;
  }): Promise<void> {
    await this.post(`/v1/sessions/${encodeURIComponent(input.sessionId)}/photos`, {
      stepId: input.stepId,
      attempt: input.attempt,
      dataUrl: input.dataUrl,
    });
  }

  public async completeSession(sessionId: string): Promise<void> {
    await this.post(`/v1/sessions/${encodeURIComponent(sessionId)}/complete`, {});
  }
}
