export interface CapturedImageResult {
  imagePath: string;
  timestamp: number;
}

export interface CaptureValidationPolicy {
  minWidth?: number;
  minHeight?: number;
}

/**
 * CaptureController handles the actual frame capture and image validation.
 * It is responsible for capturing the current frame and validating the result.
 */
export class CaptureController {
  private snapshotProvider?: () => string | null;

  public setSnapshotProvider(provider: () => string | null): void {
    this.snapshotProvider = provider;
  }

  async captureCurrentFrame(): Promise<CapturedImageResult> {
    const dataUrl = this.snapshotProvider ? this.snapshotProvider() : null;
    return {
      imagePath: dataUrl || `capture_${Date.now()}.jpg`,
      timestamp: Date.now(),
    };
  }

  async validateCapturedImage(
    _imagePath: string,
    _policy: CaptureValidationPolicy
  ): Promise<boolean> {
    // Placeholder: real implementation will validate the captured image quality
    return true;
  }
}
