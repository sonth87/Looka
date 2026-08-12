import { GestureType, HandLandmark } from '@face/core';

export class RuleBasedClassifier {
  /**
   * Classify 21 normalized 3D hand landmarks into a GestureType.
   * Landmark indices (MediaPipe Hand Landmarker standard):
   * 0: Wrist
   * 1-4: Thumb (4=tip)
   * 5-8: Index (5=MCP, 8=tip)
   * 9-12: Middle (9=MCP, 12=tip)
   * 13-16: Ring (13=MCP, 16=tip)
   * 17-20: Pinky (17=MCP, 20=tip)
   */
  public classify(landmarks: HandLandmark[]): { gesture: GestureType; confidence: number } {
    if (!landmarks || landmarks.length < 21) {
      return { gesture: 'NONE', confidence: 0 };
    }

    const wrist = landmarks[0];

    const dist = (a: HandLandmark, b: HandLandmark) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = (a.z || 0) - (b.z || 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    const isExtended = (tipIdx: number, mcpIdx: number) => {
      return dist(landmarks[tipIdx], wrist) > dist(landmarks[mcpIdx], wrist) * 1.15;
    };

    const indexExt = isExtended(8, 5);
    const middleExt = isExtended(12, 9);
    const ringExt = isExtended(16, 13);
    const pinkyExt = isExtended(20, 17);
    const thumbExt = dist(landmarks[4], wrist) > dist(landmarks[2], wrist) * 1.15;

    const thumbIndexDist = dist(landmarks[4], landmarks[8]);

    // 1. OK_SIGN: Thumb tip and Index tip touching/very close, other fingers extended
    if (thumbIndexDist < 0.08 && middleExt && ringExt) {
      return { gesture: 'OK_SIGN', confidence: 0.94 };
    }

    // 2. VICTORY (V sign): Index + Middle extended, Ring + Pinky closed
    if (indexExt && middleExt && !ringExt && !pinkyExt) {
      return { gesture: 'VICTORY', confidence: 0.96 };
    }

    // 3. THUMBS_UP: Thumb extended & pointing upward relative to wrist, other fingers closed
    if (thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt && landmarks[4].y < wrist.y) {
      return { gesture: 'THUMBS_UP', confidence: 0.95 };
    }

    // 4. OPEN_PALM: All 5 fingers extended
    if (thumbExt && indexExt && middleExt && ringExt && pinkyExt) {
      return { gesture: 'OPEN_PALM', confidence: 0.98 };
    }

    // 5. CLOSED_FIST: All 4 main fingers closed
    if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
      return { gesture: 'CLOSED_FIST', confidence: 0.92 };
    }

    return { gesture: 'NONE', confidence: 0.5 };
  }
}
