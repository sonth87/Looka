/**
 * Vietnamese labels for the raw quality/posture reason codes
 * (FaceQualityResult.reasons, BodyPostureResult.reasons).
 *
 * Shared between every place that shows a rejection-reason list to the
 * operator — DebugPanel and DesktopCaptureView today — so a code only ever
 * has one Vietnamese label. The codes themselves stay in English: they are
 * also what GuidanceEngine keys its on-screen instructions off, and what
 * shows up in logs, so renaming them upstream would break both.
 */
export const QUALITY_REASON_LABEL: Record<string, string> = {
  FACE_TOO_SMALL: 'Mặt quá nhỏ',
  FACE_TOO_LARGE: 'Mặt quá to',
  OFF_CENTER: 'Lệch khỏi giữa khung',
  TOO_DARK: 'Thiếu sáng',
  TOO_BRIGHT: 'Quá sáng',
  BLURRY: 'Ảnh bị mờ',
  OCCLUDED: 'Mặt bị che',
  EYES_CLOSED: 'Mắt nhắm',
  SMILING: 'Đang cười',
  SHOULDERS_TILTED: 'Vai nghiêng',
  SHOULDERS_NOT_VISIBLE: 'Không thấy vai',
};
