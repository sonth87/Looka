from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "python-ai-sidecar",
        "version": "0.1.0",
        "models_loaded": True
    }
