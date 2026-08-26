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

  /**
   * Release this run's captures for upload, once the operator has reviewed
   * and confirmed them.
   *
   * Distinct from `completeSession`: completing only closes the local record,
   * while this is the signal that what was staged may now actually be sent.
   * `ElectronCaptureSink` is the implementation this matters for — see its own
   * doc comment. `HttpCaptureSink` implements it as a no-op; see there for why.
   */
  approveUpload(sessionId: string): Promise<void>;
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

  /**
   * No-op — the web/API path has no staging concept to release.
   *
   * `PhotoService.addPhoto()` writes straight to a durable Postgres
   * `upload_outbox` row and `UploadWorkerService` drains it within seconds,
   * for every photo, the moment it is captured — there was never a point
   * where this backend held a photo back pending review. The two-phase
   * "stage, then approve" flow this method exists for (see the CaptureSink
   * interface doc comment) was built for the desktop kiosk's literal local
   * "temp folder"; the browser has no such filesystem to stage anything on in
   * the first place. Left as a real, documented no-op rather than an error so
   * FaceCaptureApp's review screen can call it unconditionally regardless of
   * which sink is active.
   */
  public async approveUpload(): Promise<void> {
    // Intentionally does nothing — see method doc comment.
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
 * `approveUpload`, unlike those two, is not a no-op here: a queued row stays
 * invisible to the background uploader until the operator reviews the session
 * and this is called — see that method's own doc comment for the mechanism,
 * and `UploadOutboxRepository.approveSession()` for where the gate actually
 * lives.
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

  /**
   * Tell the main process to release this session's staged captures.
   *
   * Until this is called, `queueCapture`'s rows sit on local disk and in the
   * local outbox but are invisible to the background uploader — see
   * `session:approveUpload`'s own doc comment in apps/desktop's main process
   * for the full mechanism. A session nobody ever approves simply stays
   * staged forever, which is the safe, intended outcome, not a bug: nothing
   * uploads behind the operator's back, and nothing captured is ever deleted
   * for want of a click.
   */
  public async approveUpload(sessionId: string): Promise<void> {
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.approveSessionUpload) {
      throw new Error('faceAPI.approveSessionUpload is not available — not running inside the desktop app');
    }
    const result = await faceAPI.approveSessionUpload({ sessionId });
    if (!result?.ok) {
      throw new Error(result?.error ?? 'approveSessionUpload failed');
    }
  }
}

/**
 * Lazily opens one CaptureSink session per logical run and caches its id so
 * every photo captured during that run shares it, the way the sink's own
 * `startSession` doc comment ("identifies it from here on") intends.
 *
 * `reset()` is what makes that safe across a run that never finished. Both
 * the desktop and web outboxes key a capture's idempotency on
 * `${sessionId}:${stepId}:${attempt}`, numbering attempts from 1 within each
 * run (see queueCapture in apps/desktop's uploads.ts and PhotoService on the
 * web side). Two runs number their steps identically, so if a run is
 * abandoned mid-way — cancelled, or "Chụp lại toàn bộ" from
 * SessionReviewModal, both reachable before a session ever reaches
 * `completeSession` — and the next run reused the same cached id, its first
 * capture of each step would carry the exact idemKey the abandoned run's did.
 * The desktop outbox's `ON CONFLICT(idem_key) DO NOTHING` (and the web
 * API's equivalent upsert) would then silently drop the retaken photo from
 * the upload queue, leaving whatever the abandoned run had already sent —
 * sometimes nothing usable at all — as the last word on that step, with no
 * error surfaced anywhere. `reset()` drops the cached id without telling the
 * sink the run completed, so the next capture opens a genuinely new session
 * and can never collide with the one it left behind.
 */
export class RunScopedCaptureSession {
  private sessionId: string | null = null;

  constructor(private readonly sink: CaptureSink | null) {}

  /** The id for the current run, opening one with the sink if none is cached yet. */
  public async ensure(): Promise<string | null> {
    if (!this.sink) return null;
    if (this.sessionId) return this.sessionId;
    this.sessionId = await this.sink.startSession({});
    return this.sessionId;
  }

  /** Store one photo under the current run, opening the run first if needed. */
  public async savePhoto(input: { stepId: string; attempt: number; dataUrl: string }): Promise<void> {
    if (!this.sink) throw new Error('No CaptureSink configured.');
    const sessionId = await this.ensure();
    if (!sessionId) throw new Error('No CaptureSink configured.');
    await this.sink.savePhoto({ sessionId, ...input });
  }

  /**
   * The operator reviewed this run and confirmed it: release its staged
   * captures for upload.
   *
   * Deliberately does not clear the cached session id the way `complete()`
   * does — it uses it, the same as `savePhoto`, without ending the run. Call
   * this before `complete()`, not after: `complete()` drops the cached id, and
   * an approval call made once it is gone would silently find no session to
   * approve. Leaving the id intact on failure (this rejects rather than
   * swallowing an error — see the sink implementations) is what lets a caller
   * retry by calling this again instead of losing the ability to approve at
   * all.
   *
   * Throws rather than quietly doing nothing when no session id is cached —
   * this used to return silently, which made the review screen's "Xác nhận"
   * button report success (no exception, modal closes) while never having
   * called the sink at all. The one legitimate way to lose the cached id
   * without an explicit reset() is a dev-server hot-reload remounting this
   * component mid-run; surfacing that as a real, visible error is what lets
   * an operator notice instead of walking away thinking the upload went out.
   */
  public async approve(): Promise<void> {
    if (!this.sink) throw new Error('No CaptureSink configured.');
    const sessionId = this.sessionId;
    if (!sessionId) {
      throw new Error(
        'No active capture session to approve — the app may have hot-reloaded mid-session. Please fully reload and recapture.'
      );
    }
    await this.sink.approveUpload(sessionId);
  }

  /** The run finished naturally: tell the sink, then drop the cached id. */
  public async complete(): Promise<void> {
    const sessionId = this.sessionId;
    if (!this.sink || !sessionId) return;
    await this.sink.completeSession(sessionId);
    this.sessionId = null;
  }

  /**
   * The run was abandoned rather than finished — drop the cached id without
   * calling `completeSession`, so the next capture starts a fresh run instead
   * of silently continuing this one. See the class doc comment for why.
   */
  public reset(): void {
    this.sessionId = null;
  }
}
