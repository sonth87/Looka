import { BoundingBox, CaptureSensitivity, FaceQualityResult, QualityRequirement } from '@face/core';

/**
 * Size thresholds are bounding-box width over frame width.
 *
 * The box is the hull of the MediaPipe face-mesh landmarks, so its width is
 * cheekbone-to-cheekbone (~14 cm on an adult) rather than full head breadth.
 * For a camera of horizontal field of view F, a face at distance D spans
 * ratio = 0.14 / (2 * D * tan(F/2)). Inverted for the 1280x720 the camera
 * requests, across the 60-70 degree range typical of webcams:
 *
 *   ratio   hull px   crop px   IPD px   distance
 *   0.30      384       442      173     0.33 - 0.40 m
 *   0.25      320       368      144     0.40 - 0.48 m
 *   0.20      256       294      115     0.50 - 0.61 m
 *   0.10      128       147       58     1.00 - 1.21 m
 *   0.08      102       118       46     1.25 - 1.52 m
 *
 * The floor is a pixel budget rather than a distance preference. The recogniser
 * consumes a 112x112 crop, and a crop assembled from fewer pixels than that is
 * upscaled, inventing detail the sensor never resolved. A hull of 0.08 * 1280 =
 * 102 px still measures ~118 px once the usual crop margin is added, making it
 * the smallest face that fills that input from real pixels; below it the photo
 * genuinely cannot carry a face. The permissive tiers step up from that floor,
 * giving a kiosk roughly 0.2 m to 1.1 m of usable depth — enough that someone
 * can stand naturally rather than lean in to a marked spot.
 *
 * HIGH and VERY_HIGH hold their floors because eKYC capture answers to ICAO
 * 9303 / ISO 19794-5, which ask for >=90 px between the eye centres and treat
 * 120 px as high quality. Interocular distance runs ~0.45 of this hull width,
 * so 0.25 yields ~144 px and 0.30 ~173 px; reach is not worth trading for that.
 */
/**
 * Sharpness thresholds are the standard deviation of the Laplacian over the FACE
 * region, divided by 50.
 *
 * They are far lower than they look because skin is smooth: that is what a face
 * is. Measured across the whole frame the statistic was dominated by furniture,
 * text and door frames, and an identical face scored 0.94 in a cluttered room
 * against 0.19 in front of a bare wall. Restricting it to the face removed that
 * five-fold inflation, and the old thresholds — inherited from whole-frame
 * numbers — then sat above what any real face can reach.
 *
 * Two anchors bracket the bands, both measured on the face region:
 *
 *   a real in-focus face, on the deployed kiosk        0.20
 *   a blurred face in a detailed room                  0.097
 *
 * Synthetic faces read lower than real ones — generated skin has no pores,
 * lashes or stray hair — so they establish the shape of the curve but not where
 * the line belongs. The thresholds sit between those two anchors: above the
 * blurred reading, so genuine blur is still caught, and below the in-focus one,
 * so an ordinary capture is not rejected.
 *
 * Calibrated against one field capture plus the synthetic curve, so treat them
 * as a starting point: re-measure on the deployed camera before tightening.
 */
/**
 * Eye-open and expression thresholds, on the same 0..1 blendshape scale as
 * MediaPipe reports them.
 *
 * `minEyeOpenScore` loosens from HIGH/VERY_HIGH down to VERY_LOW for the same
 * reason the pixel-based thresholds do: a permissive tier is meant to still
 * accept a marginal capture rather than force a retake, and eyelid position
 * genuinely varies by person (heavy-lidded eyes read lower even fully open).
 *
 * `maxSmileScore` tightens the same direction, down to a near-ICAO-strict
 * ceiling at VERY_HIGH. Both are calibrated on the ARKit-style 52-blendshape
 * output MediaPipe FaceLandmarker produces with `outputFaceBlendshapes: true`
 * — not measured on the deployed kiosk yet, so treat them as a starting point
 * the same way YAW_GAIN/PITCH_GAIN in PoseEstimator.ts are.
 */
export const SENSITIVITY_PRESETS: Record<CaptureSensitivity, Required<QualityRequirement>> = {
  VERY_LOW: {
    minSharpness: 0.06,
    minBrightness: 0.15,
    maxBrightness: 0.95,
    minFaceSizeRatio: 0.08,
    maxFaceSizeRatio: 0.55,
    maxCenterOffsetX: 0.20,
    maxCenterOffsetY: 0.20,
    minEyeOpenScore: 0.30,
    maxSmileScore: 0.60,
    sensitivity: 'VERY_LOW',
  },
  LOW: {
    minSharpness: 0.09,
    minBrightness: 0.20,
    maxBrightness: 0.92,
    minFaceSizeRatio: 0.09,
    maxFaceSizeRatio: 0.50,
    maxCenterOffsetX: 0.18,
    maxCenterOffsetY: 0.18,
    minEyeOpenScore: 0.40,
    maxSmileScore: 0.50,
    sensitivity: 'LOW',
  },
  MEDIUM: {
    minSharpness: 0.12,
    minBrightness: 0.30,
    maxBrightness: 0.90,
    minFaceSizeRatio: 0.10,
    maxFaceSizeRatio: 0.55,
    maxCenterOffsetX: 0.15,
    maxCenterOffsetY: 0.15,
    minEyeOpenScore: 0.50,
    maxSmileScore: 0.40,
    sensitivity: 'MEDIUM',
  },
  HIGH: {
    minSharpness: 0.15,
    minBrightness: 0.35,
    maxBrightness: 0.88,
    minFaceSizeRatio: 0.25,
    maxFaceSizeRatio: 0.40,
    maxCenterOffsetX: 0.12,
    maxCenterOffsetY: 0.12,
    minEyeOpenScore: 0.60,
    maxSmileScore: 0.30,
    sensitivity: 'HIGH',
  },
  VERY_HIGH: {
    minSharpness: 0.18,
    minBrightness: 0.40,
    maxBrightness: 0.85,
    minFaceSizeRatio: 0.30,
    maxFaceSizeRatio: 0.38,
    maxCenterOffsetX: 0.10,
    maxCenterOffsetY: 0.10,
    minEyeOpenScore: 0.65,
    maxSmileScore: 0.20,
    sensitivity: 'VERY_HIGH',
  },
};

/**
 * Absolute floor on saved face resolution, in pixels (§2.8 of
 * docs/plans/multi-camera-device-management-discussion.md) — ">250x250,
 * ideally 300-500". Independent of `minFaceSizeRatio`/sensitivity: a face can
 * clear the ratio floor and still be too few real pixels once the camera's
 * resolution is low enough (see that section's own distance table), so this
 * applies at every sensitivity level rather than being one more per-preset
 * tunable.
 */
export const MIN_FACE_RESOLUTION_PX = 250;

export class QualityEvaluator {
  private lastLogAt = 0;

  /**
   * Evaluates image brightness from an RGBA pixel array (Uint8ClampedArray).
   * Returns a normalized mean luminance value between 0.0 and 1.0.
   *
   * Confined to `region` when one is supplied, for the same reason as sharpness:
   * averaged over the whole frame the number describes the room. A face lit from
   * behind by a window is the case that matters — the frame reads bright and
   * passes while the face itself is a silhouette.
   */
  public calculateBrightness(
    pixelData: Uint8ClampedArray,
    width?: number,
    height?: number,
    region?: BoundingBox
  ): number {
    if (!pixelData || pixelData.length === 0) return 0;

    let totalLuminance = 0;
    let pixelCount = 0;

    // A region is only used when it lands inside the frame and carries enough
    // pixels to average meaningfully; otherwise the whole frame is the less
    // wrong answer, matching how sharpness degrades.
    let usable = false;
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;

    if (width && height && region && region.width > 0 && region.height > 0) {
      x0 = Math.max(0, Math.floor(region.x));
      y0 = Math.max(0, Math.floor(region.y));
      x1 = Math.min(width - 1, Math.ceil(region.x + region.width));
      y1 = Math.min(height - 1, Math.ceil(region.y + region.height));
      usable = x1 > x0 && y1 > y0 && (x1 - x0 + 1) * (y1 - y0 + 1) >= 64;
    }

    if (usable && width) {
      for (let y = y0; y <= y1; y++) {
        const rowStart = y * width * 4;
        for (let x = x0; x <= x1; x++) {
          const i = rowStart + x * 4;
          totalLuminance +=
            0.2126 * pixelData[i] + 0.7152 * pixelData[i + 1] + 0.0722 * pixelData[i + 2];
          pixelCount++;
        }
      }
    } else {
      pixelCount = Math.floor(pixelData.length / 4);
      for (let i = 0; i < pixelData.length; i += 4) {
        // Standard Relative Luminance formula
        totalLuminance +=
          0.2126 * pixelData[i] + 0.7152 * pixelData[i + 1] + 0.0722 * pixelData[i + 2];
      }
    }

    if (pixelCount === 0) return 0;
    return Math.min(1.0, Math.max(0.0, totalLuminance / (pixelCount * 255)));
  }

  /**
   * Calculates sharpness using normalized variance of Laplacian algorithm.
   * Higher values indicate clearer/sharper image focus.
   *
   * Confined to `region` when one is supplied. Measured across the whole frame
   * the statistic answers "is this room detailed", not "is this face in focus":
   * a face at a metre covers ~1% of the pixels, so a bare kiosk wall drags the
   * score down while a poster-covered one props it up, in both cases almost
   * independently of the subject. That error grows as the face recedes, which
   * is precisely where the measurement has to stay trustworthy.
   */
  public calculateSharpness(
    pixelData: Uint8ClampedArray,
    width: number,
    height: number,
    region?: BoundingBox
  ): number {
    if (!pixelData || width <= 2 || height <= 2) return 0;

    // The kernel reads one pixel either side, so the window stops short of the
    // frame edge rather than clamping and inventing edges that are not there.
    let x0 = 1;
    let y0 = 1;
    let x1 = width - 2;
    let y1 = height - 2;

    if (region && region.width > 0 && region.height > 0) {
      const rx0 = Math.max(1, Math.floor(region.x));
      const ry0 = Math.max(1, Math.floor(region.y));
      const rx1 = Math.min(width - 2, Math.ceil(region.x + region.width));
      const ry1 = Math.min(height - 2, Math.ceil(region.y + region.height));

      // Too few samples to estimate a variance from; the whole frame is the
      // less wrong answer at that point.
      const samples = ((rx1 - rx0) / 2 + 1) * ((ry1 - ry0) / 2 + 1);
      if (rx1 > rx0 && ry1 > ry0 && samples >= 64) {
        x0 = rx0;
        y0 = ry0;
        x1 = rx1;
        y1 = ry1;
      }
    }

    // Grayscale is only needed one row beyond the window in each direction,
    // which keeps a face-sized window off the cost of a full-frame conversion
    // on every frame.
    const gray = new Float32Array(width * height);
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      const rowStart = y * width;
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const i = rowStart + x;
        const p = i * 4;
        gray[i] = 0.299 * pixelData[p] + 0.587 * pixelData[p + 1] + 0.114 * pixelData[p + 2];
      }
    }

    // Apply 3x3 Discrete Laplacian Kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
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
   * Evaluates overall face quality gates against requirements and sensitivity level.
   */
  public evaluateQuality(
    boundingBox: BoundingBox,
    frameWidth: number,
    frameHeight: number,
    pixelData?: Uint8ClampedArray,
    requirement?: QualityRequirement,
    /**
     * Measurements taken elsewhere from the same frame.
     *
     * Lets a caller that holds no pixels — the workflow step gate, which sees
     * only a FaceState — apply its own thresholds to figures the CV engine has
     * already paid to compute, instead of skipping the checks entirely.
     */
    measured?: {
      brightness?: number | null;
      sharpness?: number | null;
      /**
       * 1 - eye-blink blendshape. Unlike brightness/sharpness this package has
       * no pixel-based fallback for it — MediaPipe's blendshape output is the
       * only source, so a caller with no blendshapes leaves it null rather
       * than guessing from geometry.
       */
      eyeOpenScore?: number | null;
      /** Mouth-smile blendshape, under the same rule as `eyeOpenScore`. */
      smileScore?: number | null;
    },
    /**
     * The resolution the capture will actually be SAVED at, when it differs
     * from `frameWidth`/`frameHeight` — those may come from a downscaled
     * analysis frame (see FrameInput.nativeWidth's doc comment). Defaults to
     * `frameWidth`/`frameHeight` when omitted, i.e. "assume the frame given
     * here is the save resolution too."
     */
    saveFrameSize?: { width: number; height: number }
  ): FaceQualityResult {
    const sensitivity = requirement?.sensitivity || 'MEDIUM';
    const basePreset = SENSITIVITY_PRESETS[sensitivity] || SENSITIVITY_PRESETS.MEDIUM;
    const req = { ...basePreset, ...requirement };
    const reasons: string[] = [];

    // Face Size Ratio
    const faceSizeRatio = boundingBox.width / frameWidth;
    if (faceSizeRatio < req.minFaceSizeRatio) {
      reasons.push('FACE_TOO_SMALL');
    } else if (faceSizeRatio > req.maxFaceSizeRatio) {
      reasons.push('FACE_TOO_LARGE');
    }

    // Absolute face resolution on the saved image (§2.8) — deliberately
    // independent of faceSizeRatio above: that is a ratio, so a low-resolution
    // camera can hold a face at a ratio well inside every sensitivity's band
    // while still never reaching enough real pixels to print or match against
    // reliably. Computed by scaling the ratio (scale-invariant — the same
    // crop, just measured on the frame that will actually be written to disk)
    // rather than re-deriving from boundingBox directly, since boundingBox's
    // own coordinates are in the (possibly downscaled) analysis frame.
    const saveWidth = saveFrameSize?.width ?? frameWidth;
    const saveHeight = saveFrameSize?.height ?? frameHeight;
    const faceWidthPx = faceSizeRatio * saveWidth;
    const faceHeightPx = (boundingBox.height / frameHeight) * saveHeight;
    if (faceWidthPx < MIN_FACE_RESOLUTION_PX || faceHeightPx < MIN_FACE_RESOLUTION_PX) {
      reasons.push('FACE_RESOLUTION_TOO_LOW');
    }

    // Center Offset
    const centerX = boundingBox.x + boundingBox.width / 2;
    const centerY = boundingBox.y + boundingBox.height / 2;
    const centerXOffset = Math.abs(centerX - frameWidth / 2) / frameWidth;
    const centerYOffset = Math.abs(centerY - frameHeight / 2) / frameHeight;

    if (centerXOffset > req.maxCenterOffsetX || centerYOffset > req.maxCenterOffsetY) {
      reasons.push('OFF_CENTER');
    }

    // Brightness and sharpness, measured here from pixels or handed in by a
    // caller that already measured them. Null means nobody looked: these used
    // to default to 0.65 and 0.8, comfortably inside every threshold, so a
    // caller with no pixels silently passed both checks and the debug panel
    // displayed two numbers that described nothing.
    let brightness: number | null = measured?.brightness ?? null;
    let sharpness: number | null = measured?.sharpness ?? null;

    if (pixelData && pixelData.length > 0) {
      brightness = this.calculateBrightness(pixelData, frameWidth, frameHeight, boundingBox);
      sharpness = this.calculateSharpness(pixelData, frameWidth, frameHeight, boundingBox);
    }

    if (brightness !== null) {
      if (brightness < req.minBrightness) {
        reasons.push('TOO_DARK');
      } else if (brightness > req.maxBrightness) {
        reasons.push('TOO_BRIGHT');
      }
    }

    if (sharpness !== null && sharpness < req.minSharpness) {
      reasons.push('BLURRY');
    }

    // Eye-open and expression. Blendshapes only — no pixel fallback exists,
    // so these stay null unless a caller actually handed them in.
    const eyeOpenScore: number | null = measured?.eyeOpenScore ?? null;
    const smileScore: number | null = measured?.smileScore ?? null;

    if (eyeOpenScore !== null && eyeOpenScore < req.minEyeOpenScore) {
      reasons.push('EYES_CLOSED');
    }
    if (smileScore !== null && smileScore > req.maxSmileScore) {
      reasons.push('SMILING');
    }

    const accepted = reasons.length === 0;

    // Score size against the middle of the band this preset accepts. A fixed
    // ideal peaks outside the accepted range under the strict presets, and
    // marks down a face that is merely distant rather than unusable — which
    // then carries through into the embedding weights derived from this score.
    const idealFaceSizeRatio = (req.minFaceSizeRatio + req.maxFaceSizeRatio) / 2;
    const faceSizeTolerance = Math.max(1e-6, (req.maxFaceSizeRatio - req.minFaceSizeRatio) / 2);

    // Unmeasured factors are left out of the average rather than scored as
    // either good or bad, so the number stays an average of what was actually
    // looked at instead of being dragged by a guess.
    // An accepted capture is by definition usable, so the worst one still scores
    // half rather than nearly zero. Falling linearly to zero at the edges of the
    // accepted band made an accepted-but-distant face weigh an order of
    // magnitude less than a centred one in the embedding average — a gap far
    // larger than the difference in the images. Rejection is expressed by
    // `accepted`; this number only ranks the captures that got through.
    const scoreFactors = [
      1 - 0.5 * Math.min(1, Math.abs(faceSizeRatio - idealFaceSizeRatio) / faceSizeTolerance),
      1 - Math.min(1, (centerXOffset + centerYOffset) / 0.5),
    ];
    if (brightness !== null) {
      scoreFactors.push(brightness >= req.minBrightness && brightness <= req.maxBrightness ? 1 : 0.4);
    }
    if (sharpness !== null) {
      scoreFactors.push(sharpness >= req.minSharpness ? 1 : 0.4);
    }
    if (eyeOpenScore !== null) {
      scoreFactors.push(eyeOpenScore >= req.minEyeOpenScore ? 1 : 0.4);
    }
    if (smileScore !== null) {
      scoreFactors.push(smileScore <= req.maxSmileScore ? 1 : 0.4);
    }

    const overallScore = scoreFactors.reduce((a, b) => a + b, 0) / scoreFactors.length;

    const result: FaceQualityResult = {
      overallScore: Number(overallScore.toFixed(2)),
      accepted,
      sharpness: sharpness === null ? null : Number(sharpness.toFixed(2)),
      brightness: brightness === null ? null : Number(brightness.toFixed(2)),
      faceSizeRatio: Number(faceSizeRatio.toFixed(2)),
      centerXOffset: Number(centerXOffset.toFixed(2)),
      centerYOffset: Number(centerYOffset.toFixed(2)),
      eyeOpenScore: eyeOpenScore === null ? null : Number(eyeOpenScore.toFixed(2)),
      smileScore: smileScore === null ? null : Number(smileScore.toFixed(2)),
      eyesVisible: eyeOpenScore === null ? null : eyeOpenScore >= req.minEyeOpenScore,
      neutralExpression: smileScore === null ? null : smileScore <= req.maxSmileScore,
      // Nothing here inspects covered mouths or other occlusion. Reporting
      // "not occluded" was a claim the pipeline had never checked, and it
      // stayed true for a face hidden behind a mask.
      mouthVisible: null,
      occluded: null,
      faceWidthPx: Math.round(faceWidthPx),
      faceHeightPx: Math.round(faceHeightPx),
      reasons,
    };

    this.logResult(req.sensitivity, result);

    return result;
  }

  /**
   * Throttled to ~1/s: quality is re-evaluated on every video frame, so an
   * unthrottled log would flood the console without adding anything a
   * developer could actually read.
   */
  private logResult(sensitivity: CaptureSensitivity, result: FaceQualityResult): void {
    const now = Date.now();
    if (now - this.lastLogAt < 1000) return;
    this.lastLogAt = now;
    console.log('[QualityEvaluator] evaluateQuality', { sensitivity, ...result });
  }
}
