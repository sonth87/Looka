from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.models.image_codec import ImageDecodeError, decode_image, encode_image
from src.models.retouch_pipeline import apply_retouch

router = APIRouter()


class RetouchRequest(BaseModel):
    image_data: str
    strength: Optional[Literal["LIGHT", "MEDIUM"]] = "LIGHT"


class RetouchResponse(BaseModel):
    image_data: str
    warnings: List[str]


@router.post("/retouch", response_model=RetouchResponse)
def retouch_endpoint(req: RetouchRequest):
    try:
        image = decode_image(req.image_data)
    except ImageDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        result, warnings = apply_retouch(image, req.strength or "LIGHT")
    except Exception as exc:  # noqa: BLE001 - e.g. no face detected at all
        raise HTTPException(status_code=422, detail=f"retouch failed: {exc}") from exc

    return RetouchResponse(image_data=encode_image(result), warnings=warnings)
