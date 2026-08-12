from fastapi import APIRouter
from pydantic import BaseModel
from src.models.extractor import ModelExtractor

router = APIRouter()
extractor = ModelExtractor()

class EmbeddingRequest(BaseModel):
    image_data: str

class EmbeddingResponse(BaseModel):
    vector: list[float]
    dimension: int
    model_family: str
    model_version: str

@router.post("/embed", response_model=EmbeddingResponse)
def generate_embedding(req: EmbeddingRequest):
    vector = extractor.extract_embedding(req.image_data)
    return EmbeddingResponse(
        vector=vector,
        dimension=extractor.dimension,
        model_family=extractor.model_family,
        model_version=extractor.model_version
    )
