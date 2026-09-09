"""
Background replacement via OpenCV GrabCut.

This is an explicit, documented placeholder for a real matting model.
`docs/plans/campaign-config-sso-card-photo-discussion.md` §3.6.1 recommends
BiRefNet (via `rembg`, model `birefnet-general`) or BEN2 for production
quality, especially around hair. Both require downloading a multi-hundred-
MB ONNX/PyTorch model on first use; fetching/validating that download was
out of scope for this pass (per the task's instruction not to fake
sophistication that isn't really there), so this function uses
`cv2.grabCut` instead: classical, CPU-only, ships inside
opencv-contrib-python with **no model download at all**. Expect soft/rough
edges, especially around hair -- this is a placeholder pipeline stage, not
a final-quality claim.

TODO(upgrade): replace the body of `replace_background()` with something
like:
    from rembg import remove, new_session
    session = new_session('birefnet-general')
    matte = remove(image_rgba, session=session, only_mask=True)
and alpha-composite `matte` onto the solid background color below instead
of the grabCut mask. Keep the function signature
(`image_bgr, background_hex -> (result_bgr, warnings)`) so callers
(`/card-photo`, `/background`) don't need to change.
"""
from __future__ import annotations

from typing import Tuple

import cv2
import numpy as np


def hex_to_bgr(hex_color: str) -> Tuple[int, int, int]:
    h = (hex_color or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError(f"invalid hex color: {hex_color!r}")
    try:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
    except ValueError as exc:
        raise ValueError(f"invalid hex color: {hex_color!r}") from exc
    return (b, g, r)


def replace_background(
    image_bgr: np.ndarray, background_hex: str, margin_frac: float = 0.06
) -> tuple[np.ndarray, list[str]]:
    """Segment the (assumed single, roughly centered) subject with GrabCut
    and composite them onto a solid `background_hex` color.

    Returns (result_bgr, warnings). Never raises for a "just didn't
    segment well" case -- degrades to returning the original image with a
    warning instead, since a bad composite is worse than a no-op for a
    downstream ID-photo pipeline.
    """
    warnings: list[str] = []
    h, w = image_bgr.shape[:2]
    if h < 10 or w < 10:
        return image_bgr.copy(), ["image too small for background segmentation; returned unmodified"]

    try:
        bg_bgr = np.array(hex_to_bgr(background_hex), dtype=np.uint8)
    except ValueError as exc:
        return image_bgr.copy(), [f"{exc}; background left unchanged"]

    mask = np.zeros((h, w), np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    # Seed rect: assume the subject fills most of the frame (typical for a
    # portrait/ID photo) and is roughly centered, so "probable foreground"
    # is everything but a thin margin around the edges.
    mx = max(1, int(w * margin_frac))
    my = max(1, int(h * margin_frac))
    rect = (mx, my, max(1, w - 2 * mx), max(1, h - 2 * my))

    try:
        cv2.grabCut(image_bgr, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error as exc:
        warnings.append(f"grabCut segmentation failed ({exc}); background left unchanged")
        return image_bgr.copy(), warnings

    fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
    fg_fraction = float(fg_mask.mean())

    if fg_fraction < 0.05:
        warnings.append(
            "grabCut found almost no foreground; background replacement skipped to "
            "avoid erasing the subject"
        )
        return image_bgr.copy(), warnings
    if fg_fraction > 0.97:
        warnings.append("grabCut found almost no background; result may be visually unchanged")

    # Feather the mask edge so the composite isn't a hard cutout.
    soft_mask = cv2.GaussianBlur(fg_mask.astype(np.float32), (9, 9), 0)
    soft_mask = np.clip(soft_mask, 0.0, 1.0)[..., None]

    background_layer = np.full_like(image_bgr, bg_bgr)
    composited = image_bgr.astype(np.float32) * soft_mask + background_layer.astype(np.float32) * (1 - soft_mask)
    composited = np.clip(composited, 0, 255).astype(np.uint8)

    warnings.append(
        "background replaced with classical OpenCV GrabCut segmentation (placeholder "
        "for BiRefNet/rembg per campaign-config-sso-card-photo-discussion.md §3.6.1; "
        "expect soft/imprecise edges, especially around hair)"
    )
    return composited, warnings
