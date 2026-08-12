import { BoundingBox, FaceQualityResult, QualityRequirement } from '@face/core';

export class QualityEvaluator {
  private defaultRequirement: Required<QualityRequirement> = {
    minFaceSizeRatio: 0.2,
    maxFaceSizeRatio: 0.75,
    maxCenterOffsetX: 0.25,
    maxCenterOffsetY: 0.25,
    minBrightness: 0.3,
    maxBrightness: 0.85,
    minSharpness: 0.35,
    requireEyesVisible: true,
    rejectOccluded: true,
  };

  /**
   * Evaluates image brightness from an RGBA pixel array (Uint8ClampedArray).
   * Returns a normalized mean luminance value between 0.0 and 1.0.
   */
  public calculateBrightness(pixelData: Uint8ClampedArray): number {
    if (!pixelData || pixelData.length === 0) return 0;

    let totalLuminance = 0;
    const pixelCount = Math.floor(pixelData.length / 4);

    for (let i = 0; i < pixelData.length; i += 4) {
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];
      // Standard Relative Luminance formula
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLuminance += luminance;
    }

    return Math.min(1.0, Math.max(0.0, totalLuminance / (pixelCount * 255)));
  }

  /**
   * Calculates sharpness using normalized variance of Laplacian algorithm.
   * Higher values indicate clearer/sharper image focus.
   */
  public calculateSharpness(
    pixelData: Uint8ClampedArray,
    width: number,
    height: number
  ): number {
    if (!pixelData || width <= 2 || height <= 2) return 0;

    // Convert to grayscale grid
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const p = i * 4;
      gray[i] = 0.299 * pixelData[p] + 0.587 * pixelData[p + 1] + 0.114 * pixelData[p + 2];
    }

    // Apply 3x3 Discrete Laplacian Kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const idx = y * width + x;
        const laplacian =
          gray[idx - width] +
          gray[idx - 1] +
          -4 * gray[idx] +
          gray[idx + 1] +
          gray[idx + width];

        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }

    if (count === 0) return 0;

    const mean = sum / count;
    const variance = sumSq / count - mean * mean;

    // Normalize variance into 0..1 range (variance usually range 0..5000)
    return Math.min(1.0, Math.max(0.0, Math.sqrt(variance) / 50));
  }

  /**
   * Evaluates overall face quality gates against requirements.
   */
  public evaluateQuality(
    boundingBox: BoundingBox,
    frameWidth: number,
    frameHeight: number,
    pixelData?: Uint8ClampedArray,
    requirement?: QualityRequirement
  ): FaceQualityResult {
    const req = { ...this.defaultRequirement, ...requirement };
    const reasons: string[] = [];

    // Face Size Ratio
    const faceSizeRatio = boundingBox.width / frameWidth;
    if (faceSizeRatio < req.minFaceSizeRatio) {
      reasons.push('FACE_TOO_SMALL');
    } else if (faceSizeRatio > req.maxFaceSizeRatio) {
      reasons.push('FACE_TOO_LARGE');
    }

    // Center Offset
    const centerX = boundingBox.x + boundingBox.width / 2;
    const centerY = boundingBox.y + boundingBox.height / 2;
    const centerXOffset = Math.abs(centerX - frameWidth / 2) / frameWidth;
    const centerYOffset = Math.abs(centerY - frameHeight / 2) / frameHeight;

    if (centerXOffset > req.maxCenterOffsetX || centerYOffset > req.maxCenterOffsetY) {
      reasons.push('OFF_CENTER');
    }

    // Brightness & Sharpness (if pixels provided)
    let brightness = 0.65;
    let sharpness = 0.8;

    if (pixelData && pixelData.length > 0) {
      brightness = this.calculateBrightness(pixelData);
      sharpness = this.calculateSharpness(pixelData, frameWidth, frameHeight);

      if (brightness < req.minBrightness) {
        reasons.push('TOO_DARK');
      } else if (brightness > req.maxBrightness) {
        reasons.push('TOO_BRIGHT');
      }

      if (sharpness < req.minSharpness) {
        reasons.push('BLURRY');
      }
    }

    const accepted = reasons.length === 0;

    // Calculate score (0..1)
    const scoreFactors = [
      1 - Math.min(1, Math.abs(faceSizeRatio - 0.45) / 0.45),
      1 - Math.min(1, (centerXOffset + centerYOffset) / 0.5),
      brightness >= req.minBrightness && brightness <= req.maxBrightness ? 1 : 0.4,
      sharpness >= req.minSharpness ? 1 : 0.4,
    ];

    const overallScore = scoreFactors.reduce((a, b) => a + b, 0) / scoreFactors.length;

    return {
      overallScore: Number(overallScore.toFixed(2)),
      accepted,
      sharpness: Number(sharpness.toFixed(2)),
      brightness: Number(brightness.toFixed(2)),
      faceSizeRatio: Number(faceSizeRatio.toFixed(2)),
      centerXOffset: Number(centerXOffset.toFixed(2)),
      centerYOffset: Number(centerYOffset.toFixed(2)),
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      reasons,
    };
  }
}
