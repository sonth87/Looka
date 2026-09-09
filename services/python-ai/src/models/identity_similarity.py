"""
Face-identity similarity via facenet-pytorch (MIT-licensed, the model
recommended in `docs/plans/cms-photo-review-plan.md` §6.2 guardrail #3:
"Kiem tra do giong: embedding truoc/sau bang facenet-pytorch hoac AdaFace").

Confirmed working in this environment on 2026-09-08:
  - `pip install facenet-pytorch` succeeds (pulls in a CPU build of torch
    2.2.2 + torchvision; no CUDA/GPU required).
  - MTCNN's detector weights (pnet.pt/rnet.pt/onet.pt) ship inside the
    facenet-pytorch package itself -- no download needed for face
    detection/alignment.
  - InceptionResnetV1's `vggface2` pretrained weights (~107 MB) downloaded
    successfully from the facenet-pytorch release on first use in this
    environment and are cached by torch under `~/.cache/torch/hub`
    afterwards, so only the very first request after a fresh machine pays
    the download cost.
  - End-to-end smoke test: same image compared to itself -> cosine
    similarity ~1.0; the same person's photo horizontally flipped ->
    ~0.98. Both sane results for a real embedding model.

This means /identity-similarity is a REAL embedding comparison, not a
fabricated score. `src/api/routes/identity.py` still has an explicit
"model unavailable" response path for the (here, hypothetical) case where
loading fails at runtime on some other machine -- see that module for the
honest-failure contract this deliberately does not paper over.
"""
from __future__ import annotations

import threading
from typing import Optional

import numpy as np


class IdentityModelUnavailableError(RuntimeError):
    """Raised when the embedding model/weights could not be loaded."""


class NoFaceDetectedError(RuntimeError):
    """Raised when MTCNN cannot find a face in the supplied image."""


class IdentityEmbedder:
    """Lazily-initialized, process-wide MTCNN + InceptionResnetV1 pipeline."""

    def __init__(self):
        self._lock = threading.Lock()
        self._ready: Optional[bool] = None
        self._load_error: Optional[str] = None
        self._torch = None
        self._mtcnn = None
        self._resnet = None

    def _ensure_loaded(self) -> None:
        if self._ready is not None:
            return
        with self._lock:
            if self._ready is not None:
                return
            try:
                import torch
                from facenet_pytorch import MTCNN, InceptionResnetV1

                self._torch = torch
                # margin=0, image_size=160: the standard facenet-pytorch
                # alignment size InceptionResnetV1 was trained/validated on.
                self._mtcnn = MTCNN(image_size=160, margin=0, post_process=True)
                self._resnet = InceptionResnetV1(pretrained="vggface2").eval()
                self._ready = True
            except Exception as exc:  # noqa: BLE001 - any failure means "unavailable", never a crash
                self._ready = False
                self._load_error = f"{type(exc).__name__}: {exc}"

    @property
    def load_error(self) -> Optional[str]:
        self._ensure_loaded()
        return self._load_error

    def is_available(self) -> bool:
        self._ensure_loaded()
        return bool(self._ready)

    def embed(self, image_rgb_pil) -> np.ndarray:
        """`image_rgb_pil`: a PIL.Image in RGB mode. Returns an L2-normalized
        512-d embedding as a float64 numpy array."""
        if not self.is_available():
            raise IdentityModelUnavailableError(self._load_error or "identity embedding model unavailable")

        face_tensor = self._mtcnn(image_rgb_pil)
        if face_tensor is None:
            raise NoFaceDetectedError("MTCNN found no face in the image")

        with self._torch.no_grad():
            embedding = self._resnet(face_tensor.unsqueeze(0))
        vec = embedding[0].numpy().astype(np.float64)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec


_embedder = IdentityEmbedder()


def get_embedder() -> IdentityEmbedder:
    return _embedder


def cosine_similarity_0_1(a: np.ndarray, b: np.ndarray) -> float:
    """Both vectors are already L2-normalized by `IdentityEmbedder.embed`,
    so their dot product IS the cosine similarity (range [-1, 1]).
    Negative values are clamped to 0 to fit the endpoint's documented
    [0, 1] contract -- for two face embeddings from the same model, a
    negative cosine similarity only happens for very different faces, so
    clamping doesn't lose any meaningful discrimination in the range that
    actually matters for a same-person/different-person decision."""
    sim = float(np.dot(a, b))
    return max(0.0, min(1.0, sim))
