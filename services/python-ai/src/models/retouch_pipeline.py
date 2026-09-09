"""
Identity-preserving retouch: smooth skin texture only inside a face-skin
mask, leaving eyes/eyebrows/mouth and everything outside the face
untouched.

This is the deterministic OpenCV approach recommended in
`docs/plans/campaign-config-sso-card-photo-discussion.md` §3.6.1
("Deterministic OpenCV: mask da tu MediaPipe Face Mesh [loai mat, long
may, moi, mui] -> guided/bilateral filter") and
`docs/plans/cms-photo-review-plan.md` §6.2 (identity-preservation
guardrails) -- deliberately NOT a generative model: no GAN, no diffusion,
so it cannot invent detail or change identity. `cv2.bilateralFilter` is an
edge-preserving smoothing filter; applying it only within the skin mask
(never full-frame) is what keeps eyes/eyebrows/lips/hair crisp.
"""
from __future__ import annotations

import cv2
import numpy as np

from src.models.face_landmarks import REGION_INDICES, FaceDetectionResult, FaceLandmarkDetector

_detector = FaceLandmarkDetector()

# Bilateral filter params per strength preset. `d` is the pixel
# neighborhood diameter; sigmaColor/sigmaSpace control how much
# color/spatial difference is smoothed over. MEDIUM is a stronger, but
# still texture-preserving (not blurring), pass than LIGHT.
_STRENGTH_PARAMS: dict[str, dict[str, int]] = {
    "LIGHT": {"d": 5, "sigma_color": 35, "sigma_space": 35},
    "MEDIUM": {"d": 9, "sigma_color": 65, "sigma_space": 65},
}


def build_skin_mask(image_shape: tuple, det: FaceDetectionResult) -> tuple[np.ndarray, list[str]]:
    """Returns a float32 [0, 1] mask, same H x W as `image_shape`, marking
    skin that is safe to retouch. Feathered at the boundary for a smooth
    blend rather than a hard edge."""
    h, w = image_shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    warnings: list[str] = []

    if det.method == "mediapipe" and det.landmarks_px is not None:
        pts = det.landmarks_px

        face_hull = cv2.convexHull(pts[REGION_INDICES["face_oval"]].astype(np.float32)).astype(np.int32)
        cv2.fillConvexPoly(mask, face_hull, 255)

        for region in ("left_eye", "right_eye", "left_eyebrow", "right_eyebrow", "lips"):
            region_pts = pts[REGION_INDICES[region]].astype(np.float32)
            hull = cv2.convexHull(region_pts).astype(np.int32)
            hull_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillConvexPoly(hull_mask, hull, 255)
            # Dilate the exclusion hull slightly so filtering doesn't creep
            # up to the exact eyelash/lip-line edge under landmark jitter.
            hull_mask = cv2.dilate(hull_mask, np.ones((7, 7), np.uint8))
            mask[hull_mask > 0] = 0
    else:
        warnings.append(
            "face landmark model unavailable; used an ellipse-based face-region "
            "fallback mask (degraded -- does not precisely exclude eyes/mouth)"
        )
        x, y, bw, bh = det.face_box
        center = (int(x + bw / 2), int(y + bh / 2))
        axes = (max(1, int(bw * 0.42)), max(1, int(bh * 0.47)))
        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)

        # Best-effort eye/eyebrow-band exclusion: cut a horizontal strip
        # roughly where eyes sit on an average frontal face (~28-52% down
        # the detector box). This is a crude geometric guess, not a
        # measurement -- the Haar fallback has no landmarks to locate the
        # eyes precisely.
        strip_top = max(0, y + int(bh * 0.28))
        strip_bottom = min(h, y + int(bh * 0.52))
        mask[strip_top:strip_bottom, :] = 0

    soft = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (11, 11), 0)
    return np.clip(soft, 0.0, 1.0), warnings


def apply_retouch(image_bgr: np.ndarray, strength: str = "LIGHT") -> tuple[np.ndarray, list[str]]:
    strength = (strength or "LIGHT").upper()
    if strength not in _STRENGTH_PARAMS:
        raise ValueError(f"unsupported strength: {strength!r} (expected LIGHT or MEDIUM)")

    det = _detector.detect(image_bgr)
    mask, mask_warnings = build_skin_mask(image_bgr.shape, det)
    warnings = list(det.warnings) + mask_warnings

    params = _STRENGTH_PARAMS[strength]
    filtered = cv2.bilateralFilter(
        image_bgr, d=params["d"], sigmaColor=params["sigma_color"], sigmaSpace=params["sigma_space"]
    )

    mask3 = mask[..., None]
    out = image_bgr.astype(np.float32) * (1 - mask3) + filtered.astype(np.float32) * mask3
    out = np.clip(out, 0, 255).astype(np.uint8)

    warnings.append(
        f"applied bilateral-filter retouch ({strength}) inside the detected skin mask "
        "only; no generative model used, geometry is untouched"
    )
    return out, warnings
