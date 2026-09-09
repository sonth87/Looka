from __future__ import annotations

from typing import List, Literal, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.models.card_photo_pipeline import get_target_pixels, process_card_photo
from src.models.image_codec import ImageDecodeError, decode_image, encode_image

router = APIRouter()


class CardSpec(BaseModel):
    size: Literal["3x4", "4x6"]
    dpi: Literal[300, 600]
    backgroundColor: str = "#FFFFFF"
    headHeightRatio: Tuple[float, float] = (0.70, 0.80)
    eyeLineRatio: Tuple[float, float] = (0.40, 0.45)


class CardPhotoRequest(BaseModel):
    image_data: str
    card_spec: CardSpec


class CardPhotoResponse(BaseModel):
    image_data: str
    width: int
    height: int
    dpi: int
    warnings: List[str]


@router.post("/card-photo", response_model=CardPhotoResponse)
def card_photo_endpoint(req: CardPhotoRequest):
    try:
        image = decode_image(req.image_data)
    except ImageDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    spec = req.card_spec
    try:
        target_w, target_h = get_target_pixels(spec.size, spec.dpi)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        result, warnings = process_card_photo(
            image,
            size=spec.size,
            dpi=spec.dpi,
            background_color=spec.backgroundColor,
            head_height_ratio=spec.headHeightRatio,
            eye_line_ratio=spec.eyeLineRatio,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced as a client-facing 422, not a 500
        raise HTTPException(status_code=422, detail=f"card-photo pipeline failed: {exc}") from exc

    return CardPhotoResponse(
        image_data=encode_image(result),
        width=target_w,
        height=target_h,
        dpi=spec.dpi,
        warnings=warnings,
    )
