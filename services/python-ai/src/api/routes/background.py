from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.models.background_removal import replace_background
from src.models.image_codec import ImageDecodeError, decode_image, encode_image

router = APIRouter()


class BackgroundRequest(BaseModel):
    image_data: str
    backgroundColor: str = "#FFFFFF"


class BackgroundResponse(BaseModel):
    image_data: str
    warnings: List[str]


@router.post("/background", response_model=BackgroundResponse)
def background_endpoint(req: BackgroundRequest):
    """Standalone background replacement, reusing the exact same
    `replace_background()` function `/card-photo` uses internally (see
    src/models/background_removal.py) so CMS can re-run just this step."""
    try:
        image = decode_image(req.image_data)
    except ImageDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result, warnings = replace_background(image, req.backgroundColor)
    return BackgroundResponse(image_data=encode_image(result), warnings=warnings)
