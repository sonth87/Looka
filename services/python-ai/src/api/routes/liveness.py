from fastapi import APIRouter
from pydantic import BaseModel
from src.models.extractor import ModelExtractor

router = APIRouter()
extractor = ModelExtractor()

class LivenessRequest(BaseModel):
    image_data: str

class LivenessResponse(BaseModel):
    is_live: bool
    score: float
    status: str
    model_version: str

@router.post("/liveness", response_model=LivenessResponse)
def evaluate_liveness(req: LivenessRequest):
    res = extractor.evaluate_liveness(req.image_data)
    return LivenessResponse(
        is_live=res["is_live"],
        score=res["score"],
        status=res["status"],
        model_version=res["model_version"]
    )
