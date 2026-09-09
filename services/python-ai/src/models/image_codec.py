"""
Shared image encode/decode helpers.

The rest of this service (see `src/api/routes/embedding.py` and
`liveness.py`) already uses a JSON body with a single `image_data: str`
field for images rather than multipart upload. That existing convention
never actually decodes the string (the mock extractor just hashes the raw
characters), so this module is the first place in the sidecar that treats
`image_data` as a real base64-encoded image. New endpoints in this service
(`/card-photo`, `/background`, `/retouch`, `/identity-similarity`, `/edit`)
all reuse these helpers so decode/encode behavior is consistent.
"""
from __future__ import annotations

import base64
import binascii

import cv2
import numpy as np


class ImageDecodeError(ValueError):
    """Raised when `image_data` is not a decodable image payload."""


def decode_image(image_data: str) -> np.ndarray:
    """Decode a base64 (optionally data-URI prefixed) string into a BGR uint8 numpy array (OpenCV convention)."""
    if not image_data:
        raise ImageDecodeError("image_data is empty")

    payload = image_data
    if payload.startswith("data:") and "," in payload:
        # Tolerate a data URI like "data:image/jpeg;base64,...."
        payload = payload.split(",", 1)[1]

    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ImageDecodeError(f"image_data is not valid base64: {exc}") from exc

    if not raw:
        raise ImageDecodeError("decoded image_data is empty")

    buf = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if image is None:
        raise ImageDecodeError("image_data could not be decoded as an image (unsupported/corrupt format)")

    return image


def encode_image(image_bgr: np.ndarray, jpeg_quality: int = 95) -> str:
    """Encode a BGR uint8 numpy array to a base64 JPEG string (no data-URI prefix, matching the plain-string convention of `image_data`)."""
    ok, buf = cv2.imencode(".jpg", image_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
    if not ok:
        raise ValueError("failed to encode image as JPEG")
    return base64.b64encode(buf.tobytes()).decode("ascii")
