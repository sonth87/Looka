from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.api.routes import health, embedding, liveness

app = FastAPI(
    title="Face Platform Python AI Sidecar Service",
    description="REST API service for ArcFace 512-d embeddings and Deep Liveness verification",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api/v1", tags=["Health"])
app.include_router(embedding.router, prefix="/api/v1", tags=["Embedding"])
app.include_router(liveness.router, prefix="/api/v1", tags=["Liveness"])

@app.get("/")
def root():
    return {"message": "Face Platform Python AI Sidecar Running"}
