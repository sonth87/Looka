from __future__ import annotations

from typing import Optional

import cv2
from fastapi import APIRouter
from PIL import Image
from pydantic import BaseModel

from src.models.identity_similarity import (
    IdentityModelUnavailableError,
    NoFaceDetectedError,
    cosine_similarity_0_1,
    get_embedder,
)
from src.models.image_codec import ImageDecodeError, decode_image

router = APIRouter()


class IdentitySimilarityRequest(BaseModel):
    # Two images, same base64 `image_data` convention as the rest of this
    # service (see src/models/image_codec.py), suffixed _a/_b since this
    # endpoint compares a pair.
    image_data_a: str
    image_data_b: str


class IdentitySimilarityResponse(BaseModel):
    similarity: Optional[float] = None
    error: Optional[str] = None


@router.post("/identity-similarity", response_model=IdentitySimilarityResponse)
def identity_similarity_endpoint(req: IdentitySimilarityRequest):
    """Real face-embedding cosine-similarity comparison via facenet-pytorch
    (see src/models/identity_similarity.py for what was actually verified
    to work in this environment). This is a safety-relevant endpoint (used
    to catch a wrong-person upload) -- if the model genuinely isn't
    available, this returns an explicit null + error, never a fabricated
    number."""
    embedder = get_embedder()

    try:
        img_a = decode_image(req.image_data_a)
        img_b = decode_image(req.image_data_b)
    except ImageDecodeError as exc:
        return IdentitySimilarityResponse(similarity=None, error=str(exc))

    if not embedder.is_available():
        return IdentitySimilarityResponse(
            similarity=None,
            error=(
                "face embedding model unavailable in this environment -- install "
                "facenet-pytorch and confirm model weights can download to enable "
                f"this ({embedder.load_error})"
            ),
        )

    try:
        pil_a = Image.fromarray(cv2.cvtColor(img_a, cv2.COLOR_BGR2RGB))
        pil_b = Image.fromarray(cv2.cvtColor(img_b, cv2.COLOR_BGR2RGB))
        emb_a = embedder.embed(pil_a)
        emb_b = embedder.embed(pil_b)
    except NoFaceDetectedError as exc:
        return IdentitySimilarityResponse(similarity=None, error=str(exc))
    except IdentityModelUnavailableError as exc:
        return IdentitySimilarityResponse(similarity=None, error=str(exc))

    similarity = cosine_similarity_0_1(emb_a, emb_b)
    return IdentitySimilarityResponse(similarity=round(similarity, 4), error=None)
