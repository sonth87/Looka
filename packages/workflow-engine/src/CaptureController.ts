export interface CapturedImageResult {
  imagePath: string;
  timestamp: number;
}

export interface CaptureValidationPolicy {
  /**
   * The face-quality result already measured for the frame just captured,
   * re-checked here as the final gate before a step is marked COMPLETED.
   *
   * Not recomputed from the image: the CV engine already paid to measure
   * this on the same frame (see StepEvaluator, which is what gated the
   * decision to capture in the first place). This is a corroborating check —
   * did the outcome actually match what triggered the capture — not a fresh
   * measurement.
   */
  quality?: { accepted: boolean; reasons: string[] } | null;
}

/** A base64 image data URL, e.g. "data:image/jpeg;base64,/9j/4AAQ...". */
const DATA_URL_PATTERN = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/i;

/**
 * CaptureController handles the actual frame capture and image validation.
 *
 * Both steps exist to be a hard gate, not a formality: a snapshot the
 * provider failed to produce, or a frame quality had already flagged as
 * unacceptable, must stop the step from being marked COMPLETED — the
 * `else` branch in WorkflowEngine.triggerManualCapture() that retries
 * instead only ever runs because of what happens here.
 */
export class CaptureController {
  private snapshotProvider?: () => string | null;

  public setSnapshotProvider(provider: () => string | null): void {
    this.snapshotProvider = provider;
  }

  /**
   * Null means the provider had nothing to give — camera not ready, canvas
   * not painted yet, whatever the cause. Previously this fell back to a
   * fabricated `capture_<timestamp>.jpg` path that was not an image at all,
   * and validateCapturedImage() approved it unconditionally: a step could
   * reach COMPLETED with no real photo behind it.
   */
  async captureCurrentFrame(): Promise<CapturedImageResult | null> {
    const dataUrl = this.snapshotProvider ? this.snapshotProvider() : null;
    if (!dataUrl) return null;
    return { imagePath: dataUrl, timestamp: Date.now() };
  }

  /**
   * Rejects anything that is not a plausible image data URL, and anything
   * the caller's own quality measurement already marked unacceptable.
   *
   * The length floor is a sanity check, not a real size validation — an
   * empty or near-empty payload (a blank canvas, a failed encode) still
   * matches the data-URL pattern syntactically. It is not a substitute for
   * decoding and measuring the image, which this deliberately does not do —
   * see the doc comment on CaptureValidationPolicy.quality for why.
   */
  async validateCapturedImage(
    imagePath: string,
    policy: CaptureValidationPolicy
  ): Promise<boolean> {
    const match = DATA_URL_PATTERN.exec(imagePath);
    if (!match || match[1].length < 100) return false;

    if (policy.quality && !policy.quality.accepted) return false;

    return true;
  }
}
