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

/**
 * Hands captures to the desktop app's own main process instead of a server.
 *
 * The kiosk is offline-first (see the desktop app's own description): there is
 * no bridge call to open a session with the file-service, and none is needed —
 * `window.faceAPI.queueCapture` already writes each photo to local disk and a
 * local outbox durably on its own, the same per-photo-not-per-session
 * durability this interface's own doc comment calls for. `startSession` and
 * `completeSession` exist only to satisfy CaptureSink; nothing to open or
 * close lives on this side.
 *
 * `(window as any).faceAPI` rather than a typed global: matches how the rest
 * of this package already reaches the preload bridge (see
 * SessionReviewModal.tsx) without pulling apps/desktop's preload types into a
 * package the web app also builds, where that global does not exist at all.
 */
export class ElectronCaptureSink implements CaptureSink {
  public async startSession(): Promise<string> {
    return crypto.randomUUID();
  }

  public async savePhoto(input: {
    sessionId: string;
    stepId: string;
    attempt: number;
    dataUrl: string;
  }): Promise<void> {
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.queueCapture) {
      throw new Error('faceAPI.queueCapture is not available — not running inside the desktop app');
    }
    const result = await faceAPI.queueCapture({
      sessionId: input.sessionId,
      // Every capture this screen produces is a face-enrollment photo; see
      // queueCapture's own doc comment for how this feeds the on-disk path.
      kind: 'face',
      stepId: input.stepId,
      attempt: input.attempt,
      dataUrl: input.dataUrl,
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? 'queueCapture failed');
    }
  }

  public async completeSession(): Promise<void> {
    // No-op — see class doc comment.
  }
}
