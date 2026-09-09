"""
Face landmark detection, shared by /card-photo, /retouch, and
/identity-similarity's crop step.

Primary path -- MediaPipe FaceLandmarker (Python Tasks API):
  - Confirmed installable in this environment on 2026-09-08 via
    `pip install mediapipe` (CPU-only, no GPU needed, no CUDA deps).
  - Needs one small model asset (~3.6 MB), checked into this repo at
    `services/python-ai/models/face_landmarker.task` (fetched once from
    Google's public MediaPipe model zoo -- see MODEL_DOWNLOAD_URL below --
    small enough to commit so startup doesn't depend on network access).
  - Gives 478 3D landmarks per face (468 mesh points + 10 iris points),
    which is enough to compute eye-line angle/position, chin position, and
    face-region masks precisely -- a real landmark-based pipeline, not a
    bounding-box guess.

Fallback path -- OpenCV Haar cascade frontal-face detector:
  - Ships inside opencv-contrib-python with **no extra download** (the xml
    file lives at cv2.data.haarcascades).
  - Used automatically if mediapipe fails to import, the .task model file
    is missing, or landmark inference raises for any reason at request
    time -- callers never get a 500 just because the ideal path failed.
  - Only yields a bounding box, not landmarks -- so eye-line rotation is
    skipped entirely by callers (a wrong guess is worse than none) and
    downstream crop/mask math falls back to fixed proportions of the box.
    This is a materially lower-quality path; every caller is told about it
    via `FaceDetectionResult.warnings`.

Upgrading later: a higher-fidelity fallback than Haar would be OpenCV's DNN
face detector (res10_300x300_ssd) -- still no GPU, but needs its own ~10 MB
model download that wasn't fetched/validated in this pass to keep the
model footprint of this change minimal (only the mediapipe .task file
above was actually confirmed and added).
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

MODELS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "models",
)
FACE_LANDMARKER_MODEL_PATH = os.path.join(MODELS_DIR, "face_landmarker.task")
MODEL_DOWNLOAD_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)

# Populated lazily the first time mediapipe import + model load succeeds
# (see FaceLandmarkDetector._ensure_mediapipe). Kept at module scope so
# other modules (e.g. retouch_pipeline.py) can reuse the exact same index
# groups without importing mediapipe themselves.
REGION_INDICES: dict[str, list[int]] = {}


class NoFaceDetectedError(RuntimeError):
    """Raised when neither mediapipe nor the Haar fallback can find a face."""


@dataclass
class FaceDetectionResult:
    method: str  # "mediapipe" | "haar_fallback"
    landmarks_px: Optional[np.ndarray]  # (478, 2) float32 pixel coords, mediapipe only
    left_eye_center: tuple
    right_eye_center: tuple
    chin: tuple
    forehead: tuple
    face_box: tuple  # (x, y, w, h) in pixels, best-effort in both paths
    warnings: list = field(default_factory=list)


def _connection_indices(connections) -> list[int]:
    """Flatten a mediapipe FaceLandmarksConnections.Connection list into the
    sorted set of unique landmark indices it touches."""
    idx = set()
    for c in connections:
        idx.add(c.start)
        idx.add(c.end)
    return sorted(idx)


class FaceLandmarkDetector:
    """Lazily-initialized, process-wide face landmark detector.

    Model loading happens once (guarded by a lock) on first use rather than
    at import time, so importing this module never requires mediapipe to be
    installed -- only calling `detect()` does, and even then it degrades to
    the Haar fallback instead of raising an ImportError.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._mp = None
        self._mp_landmarker = None
        self._mp_available: Optional[bool] = None
        self._mp_load_error: Optional[str] = None
        self._haar_cascade = None

    # -- mediapipe path --------------------------------------------------
    def _ensure_mediapipe(self) -> bool:
        if self._mp_available is not None:
            return self._mp_available
        with self._lock:
            if self._mp_available is not None:
                return self._mp_available
            try:
                import mediapipe as mp
                from mediapipe.tasks import python as mp_python
                from mediapipe.tasks.python import vision as mp_vision

                if not os.path.exists(FACE_LANDMARKER_MODEL_PATH):
                    raise FileNotFoundError(
                        f"{FACE_LANDMARKER_MODEL_PATH} not found (expected to be "
                        f"checked into the repo; re-download from {MODEL_DOWNLOAD_URL} "
                        "if missing)"
                    )

                base_options = mp_python.BaseOptions(model_asset_path=FACE_LANDMARKER_MODEL_PATH)
                options = mp_vision.FaceLandmarkerOptions(
                    base_options=base_options,
                    num_faces=1,
                    output_face_blendshapes=False,
                    output_facial_transformation_matrixes=False,
                )
                self._mp_landmarker = mp_vision.FaceLandmarker.create_from_options(options)
                self._mp = mp

                if not REGION_INDICES:
                    flc = mp_vision.FaceLandmarksConnections
                    REGION_INDICES["left_eye"] = _connection_indices(flc.FACE_LANDMARKS_LEFT_EYE)
                    REGION_INDICES["right_eye"] = _connection_indices(flc.FACE_LANDMARKS_RIGHT_EYE)
                    REGION_INDICES["left_eyebrow"] = _connection_indices(flc.FACE_LANDMARKS_LEFT_EYEBROW)
                    REGION_INDICES["right_eyebrow"] = _connection_indices(flc.FACE_LANDMARKS_RIGHT_EYEBROW)
                    REGION_INDICES["lips"] = _connection_indices(flc.FACE_LANDMARKS_LIPS)
                    REGION_INDICES["face_oval"] = _connection_indices(flc.FACE_LANDMARKS_FACE_OVAL)

                self._mp_available = True
            except Exception as exc:  # noqa: BLE001 - any failure here just means "use the fallback"
                self._mp_available = False
                self._mp_load_error = f"{type(exc).__name__}: {exc}"
        return self._mp_available

    def _detect_mediapipe(self, image_bgr: np.ndarray) -> FaceDetectionResult:
        h, w = image_bgr.shape[:2]
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._mp_landmarker.detect(mp_image)
        if not result.face_landmarks:
            raise NoFaceDetectedError("mediapipe FaceLandmarker found no face")

        lm = result.face_landmarks[0]
        pts = np.array([[p.x * w, p.y * h] for p in lm], dtype=np.float32)

        left_eye = pts[REGION_INDICES["left_eye"]].mean(axis=0)
        right_eye = pts[REGION_INDICES["right_eye"]].mean(axis=0)
        chin = pts[152]
        forehead = pts[10]
        face_oval_pts = pts[REGION_INDICES["face_oval"]]
        x, y, bw, bh = cv2.boundingRect(face_oval_pts.astype(np.float32))

        return FaceDetectionResult(
            method="mediapipe",
            landmarks_px=pts,
            left_eye_center=tuple(left_eye.tolist()),
            right_eye_center=tuple(right_eye.tolist()),
            chin=tuple(chin.tolist()),
            forehead=tuple(forehead.tolist()),
            face_box=(int(x), int(y), int(bw), int(bh)),
            warnings=[],
        )

    # -- Haar fallback path ----------------------------------------------
    def _ensure_haar(self):
        if self._haar_cascade is None:
            path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            cascade = cv2.CascadeClassifier(path)
            if cascade.empty():
                raise RuntimeError(f"failed to load bundled Haar cascade from {path}")
            self._haar_cascade = cascade
        return self._haar_cascade

    def _detect_haar(self, image_bgr: np.ndarray) -> FaceDetectionResult:
        cascade = self._ensure_haar()
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        if len(faces) == 0:
            raise NoFaceDetectedError("Haar cascade fallback found no face")

        # If several boxes match, the largest is almost always the actual
        # subject (portrait photos don't usually have a bigger face in the
        # background).
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])

        return FaceDetectionResult(
            method="haar_fallback",
            landmarks_px=None,
            # No landmarks in this path -- these are fixed proportions of the
            # detector's box, not measurements. Haar's box conventionally
            # spans roughly eyebrows-to-chin.
            left_eye_center=(x + w * 0.3, y + h * 0.4),
            right_eye_center=(x + w * 0.7, y + h * 0.4),
            chin=(x + w * 0.5, y + h),
            forehead=(x + w * 0.5, y),
            face_box=(int(x), int(y), int(w), int(h)),
            warnings=[],
        )

    # -- public API --------------------------------------------------------
    def detect(self, image_bgr: np.ndarray) -> FaceDetectionResult:
        """Detect the (single, largest) face in `image_bgr` (OpenCV BGR
        array). Tries mediapipe first, transparently falls back to Haar on
        any failure, and only raises `NoFaceDetectedError` if both paths
        find nothing."""
        if self._ensure_mediapipe():
            try:
                return self._detect_mediapipe(image_bgr)
            except Exception as mp_exc:  # noqa: BLE001
                try:
                    result = self._detect_haar(image_bgr)
                except Exception:
                    raise NoFaceDetectedError(
                        f"no face detected by mediapipe or the Haar fallback: {mp_exc}"
                    ) from mp_exc
                result.warnings.append(
                    f"mediapipe found no usable face ({mp_exc}); fell back to OpenCV "
                    "Haar cascade for this request (bounding box only, no landmarks, "
                    "no rotation applied)"
                )
                return result

        result = self._detect_haar(image_bgr)
        result.warnings.append(
            "mediapipe unavailable "
            f"({self._mp_load_error or 'not installed/loadable'}); used OpenCV Haar "
            "cascade fallback (bounding box only, no landmarks, no rotation applied)"
        )
        return result
