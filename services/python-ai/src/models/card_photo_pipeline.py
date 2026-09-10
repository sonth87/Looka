"""
Card photo (ID photo) pipeline: rotate level to the eye line, crop to the
requested head-height/eye-line ratios, replace the background with a solid
color, and resize to the exact pixel dimensions for the requested paper
size/DPI.

See `docs/plans/campaign-config-sso-card-photo-discussion.md` §3.5 for the
pixel table and crop-rule source ("dung landmark khuon mat -> xoay thang
theo duong mat -> cat sao cho chieu cao dau chiem 70-80% anh, duong mat o
40-45% tu tren xuong -> resize ve pixel theo dpi -> JPEG q95").
"""
from __future__ import annotations

import math
from typing import Tuple

import cv2
import numpy as np

from src.models.background_removal import replace_background
from src.models.face_landmarks import FaceDetectionResult, FaceLandmarkDetector

# --- Pixel table (campaign-config-sso-card-photo-discussion.md §3.5) ---
CARD_PHOTO_PIXEL_TABLE: dict[Tuple[str, int], Tuple[int, int]] = {
    ("3x4", 300): (354, 472),
    ("3x4", 600): (709, 945),
    ("4x6", 300): (472, 709),
    ("4x6", 600): (945, 1417),
}

_detector = FaceLandmarkDetector()


def get_target_pixels(size: str, dpi: int) -> Tuple[int, int]:
    key = (size, dpi)
    if key not in CARD_PHOTO_PIXEL_TABLE:
        raise ValueError(
            f"unsupported card size/dpi combination: {size}@{dpi}dpi "
            f"(supported: {sorted(CARD_PHOTO_PIXEL_TABLE.keys())})"
        )
    return CARD_PHOTO_PIXEL_TABLE[key]


def _rotate_to_level_eyes(
    image: np.ndarray, det: FaceDetectionResult
) -> tuple[np.ndarray, FaceDetectionResult, list[str]]:
    """Rotate `image` so the eye line is horizontal. Returns the rotated
    image and a NEW FaceDetectionResult re-expressed in the rotated image's
    coordinate space (landmarks/points are affine-transformed directly
    rather than re-running inference, since rotation is a known rigid
    transform)."""
    warnings: list[str] = []
    if det.method != "mediapipe":
        # The Haar fallback has no per-eye landmark to compute a reliable
        # rotation angle from -- a wrong rotation guess is worse than none,
        # so we skip it and say so explicitly.
        warnings.append(
            "face landmark model unavailable; skipped eye-line rotation "
            "(bounding-box fallback only)"
        )
        return image, det, warnings

    # NOTE: mediapipe's "left_eye"/"right_eye" naming is anatomical (the
    # subject's own left/right), which is mirrored in image pixel space for
    # a camera-facing portrait -- det.left_eye_center is typically to the
    # RIGHT of det.right_eye_center in x. Computing the rotation angle
    # directly from (right - left) would then measure a vector pointing
    # mostly in -x, giving an angle near 180 degrees instead of the small
    # tilt correction we actually want. Order the two eye points by their
    # pixel x-coordinate instead, so the angle is always the small
    # eye-line tilt regardless of which landmark group is which.
    eye_a, eye_b = sorted([det.left_eye_center, det.right_eye_center], key=lambda p: p[0])
    angle_deg = math.degrees(math.atan2(eye_b[1] - eye_a[1], eye_b[0] - eye_a[0]))

    h, w = image.shape[:2]
    center = (w / 2.0, h / 2.0)
    rot_mat = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    rotated = cv2.warpAffine(image, rot_mat, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    def transform_point(p):
        x, y = p
        nx = rot_mat[0, 0] * x + rot_mat[0, 1] * y + rot_mat[0, 2]
        ny = rot_mat[1, 0] * x + rot_mat[1, 1] * y + rot_mat[1, 2]
        return (float(nx), float(ny))

    new_landmarks = None
    if det.landmarks_px is not None:
        ones = np.ones((det.landmarks_px.shape[0], 1), dtype=np.float32)
        homog = np.hstack([det.landmarks_px, ones])
        new_landmarks = (rot_mat @ homog.T).T.astype(np.float32)

    new_det = FaceDetectionResult(
        method=det.method,
        landmarks_px=new_landmarks,
        left_eye_center=transform_point(det.left_eye_center),
        right_eye_center=transform_point(det.right_eye_center),
        chin=transform_point(det.chin),
        forehead=transform_point(det.forehead),
        face_box=det.face_box,
        warnings=[],
    )
    return rotated, new_det, warnings


def _compute_crop_box(
    det: FaceDetectionResult,
    target_w: int,
    target_h: int,
    head_height_ratio: Tuple[float, float],
    eye_line_ratio: Tuple[float, float],
    image_shape: tuple,
) -> tuple[int, int, int, int, list[str]]:
    warnings: list[str] = []
    img_h, img_w = image_shape[:2]
    target_head_ratio = sum(head_height_ratio) / 2.0
    target_eye_ratio = sum(eye_line_ratio) / 2.0

    if det.method == "mediapipe":
        eye_mid_x = (det.left_eye_center[0] + det.right_eye_center[0]) / 2.0
        eye_mid_y = (det.left_eye_center[1] + det.right_eye_center[1]) / 2.0
        chin_y = det.chin[1]
        eye_to_chin = chin_y - eye_mid_y
        if eye_to_chin <= 0:
            eye_to_chin = img_h * 0.15
            warnings.append("degenerate eye-to-chin distance from landmarks; used a fallback estimate")

        # Approximate head height (crown-to-chin). MediaPipe's mesh has no
        # crown/hairline landmark (hair isn't modeled), so we mirror the
        # eye-to-chin distance above the eye line -- a standard portrait
        # heuristic that assumes the eye line sits near the vertical
        # midpoint of the head. This is an approximation, not a
        # measurement, and is the main source of crop error in this
        # pipeline.
        head_height_px = eye_to_chin * 2.0
    else:
        x, y, w, h = det.face_box
        eye_mid_x = x + w / 2.0
        eye_mid_y = y + h * 0.4  # Haar box: eyes are typically ~40% down it
        head_height_px = h * 1.3  # Haar box under-covers forehead/crown; rough correction
        warnings.append("using bounding-box-derived head height estimate (Haar fallback, no landmarks)")

    crop_h = head_height_px / target_head_ratio
    crop_w = crop_h * (target_w / target_h)

    crop_top = eye_mid_y - target_eye_ratio * crop_h
    crop_left = eye_mid_x - crop_w / 2.0

    orig_top, orig_left = crop_top, crop_left
    if crop_h <= img_h:
        crop_top = max(0.0, min(crop_top, img_h - crop_h))
    if crop_w <= img_w:
        crop_left = max(0.0, min(crop_left, img_w - crop_w))

    if crop_h > img_h or crop_w > img_w:
        warnings.append(
            "ideal crop is larger than the source image; the source will be "
            "upscaled to fit and quality may suffer"
        )
    elif abs(orig_top - crop_top) > 1 or abs(orig_left - crop_left) > 1:
        warnings.append(
            "ideal crop extended past the image edges and was shifted inward; head "
            "position in the source photo may be off-center in the result"
        )

    return int(round(crop_left)), int(round(crop_top)), int(round(crop_w)), int(round(crop_h)), warnings


def process_card_photo(
    image_bgr: np.ndarray,
    size: str,
    dpi: int,
    background_color: str,
    head_height_ratio: Tuple[float, float] = (0.70, 0.80),
    eye_line_ratio: Tuple[float, float] = (0.40, 0.45),
    mirror: bool = False,
) -> tuple[np.ndarray, list[str]]:
    """Full pipeline: detect face -> rotate level to eyes -> crop to the
    target head/eye ratios -> replace background -> resize to the exact
    target pixel dimensions. Returns (result_bgr, warnings).

    `mirror` (product decision 2026-09-10, "chup anh the phai giong anh
    soi guong, khong lat anh"): the live kiosk preview is deliberately
    mirrored, but the captured still is saved unmirrored (raw sensor
    image) by design. Passing `mirror=True` flips the input horizontally
    BEFORE detection so the generated card photo matches the mirrored
    preview the subject actually saw, instead of the raw unmirrored
    still. Everything downstream (detection, rotation, crop, background
    replace) then runs consistently on the already-flipped array.
    """
    if mirror:
        image_bgr = cv2.flip(image_bgr, 1)

    warnings: list[str] = []
    target_w, target_h = get_target_pixels(size, dpi)

    det = _detector.detect(image_bgr)
    warnings.extend(det.warnings)

    rotated, det_rot, rot_warnings = _rotate_to_level_eyes(image_bgr, det)
    warnings.extend(rot_warnings)

    crop_x, crop_y, crop_w, crop_h, crop_warnings = _compute_crop_box(
        det_rot, target_w, target_h, head_height_ratio, eye_line_ratio, rotated.shape
    )
    warnings.extend(crop_warnings)

    # Pad with edge-replicated pixels instead of failing when the ideal
    # crop box extends outside the (rotated) image bounds.
    img_h, img_w = rotated.shape[:2]
    pad_top = max(0, -crop_y)
    pad_left = max(0, -crop_x)
    pad_bottom = max(0, (crop_y + crop_h) - img_h)
    pad_right = max(0, (crop_x + crop_w) - img_w)

    canvas = cv2.copyMakeBorder(
        rotated, pad_top, pad_bottom, pad_left, pad_right, borderType=cv2.BORDER_REPLICATE
    )
    start_y = crop_y + pad_top
    start_x = crop_x + pad_left
    cropped = canvas[start_y : start_y + crop_h, start_x : start_x + crop_w]

    composited, bg_warnings = replace_background(cropped, background_color)
    warnings.extend(bg_warnings)

    resized = cv2.resize(composited, (target_w, target_h), interpolation=cv2.INTER_AREA)

    return resized, warnings
