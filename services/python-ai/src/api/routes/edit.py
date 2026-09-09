"""
POST /edit -- AI prompt-based photo edit.

This endpoint implements the FULL request contract (validation + the
prompt safety filter) from `docs/plans/cms-photo-review-plan.md` §6.4/§7,
but does NOT run any generative model. Per §6.1, the recommended models
(Qwen-Image-Edit 2511, Step1X-Edit v1.2, HiDream-E1.1) all need a 24 GB+
GPU and multi-gigabyte weight downloads -- this dev environment has
neither (no GPU detected; downloading a multi-GB diffusion model was
explicitly out of scope for this pass). `run_edit_model()` below is a
clearly separated stub that always raises `EditModelNotConfiguredError`;
the route catches it and returns HTTP 501 with a structured body -- a
well-documented stub, never a silent no-op or a fake success.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.models.prompt_filter import find_forbidden_keyword

router = APIRouter()


class EditRequest(BaseModel):
    image_data: str
    prompt: str
    region: Optional[Literal["FACE_EXCLUDED", "GLASSES", "HAIR", "FULL"]] = "FACE_EXCLUDED"
    fromVariantId: Optional[str] = None


class EditModelNotConfiguredError(RuntimeError):
    pass


def run_edit_model(image_data: str, prompt: str, region: str) -> dict:
    """The actual generative-edit call. Deliberately unimplemented in this
    environment -- see module docstring. Kept as a separate function so a
    future GPU-backed deployment only needs to fill in this one place
    (e.g. call a ComfyUI HTTP API's `/prompt` + `/history`, or a Diffusers
    pipeline directly, running Qwen-Image-Edit 2511 per
    cms-photo-review-plan.md §6.1/§6.4) without touching the
    validation/filter logic in the route below."""
    raise EditModelNotConfiguredError("AI edit model not configured in this environment")


@router.post("/edit")
def edit_photo(req: EditRequest):
    keyword = find_forbidden_keyword(req.prompt)
    if keyword:
        return JSONResponse(
            status_code=422,
            content={
                "error": "prompt rejected by safety filter",
                "detail": (
                    f"Prompt contains a forbidden edit request ('{keyword}'). This "
                    "service does not allow AI edits that change expression, open "
                    'closed eyes, remove glasses, slim/de-age/"beautify" a face, or '
                    "change eyes/nose/mouth shape -- see cms-photo-review-plan.md "
                    "§6.3. Re-shoot the photo instead if this is genuinely needed."
                ),
                "matchedKeyword": keyword,
            },
        )

    try:
        result = run_edit_model(req.image_data, req.prompt, req.region or "FACE_EXCLUDED")
        return result
    except EditModelNotConfiguredError:
        return JSONResponse(
            status_code=501,
            content={
                "error": "AI edit model not configured in this environment",
                "detail": (
                    "Requires Qwen-Image-Edit 2511 (Apache 2.0) or equivalent on a "
                    "24GB+ GPU -- see cms-photo-review-plan.md §6.1. This endpoint "
                    "validates prompts and defines the contract but does not run "
                    "inference here."
                ),
            },
        )
