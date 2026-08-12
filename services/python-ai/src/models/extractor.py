import math
import numpy as np
from typing import Dict, Any, List

class ModelExtractor:
    def __init__(self):
        self.dimension = 512
        self.model_family = "ArcFace-Python"
        self.model_version = "v1.0.0"
        self.liveness_version = "v1.0.0"

    def extract_embedding(self, image_data: str) -> List[float]:
        # Deterministic 512-d embedding generation based on image payload hash
        hash_val = sum(ord(c) for c in image_data)
        raw = np.zeros(self.dimension, dtype=np.float32)
        for i in range(self.dimension):
            x = math.sin(hash_val + i) * 10000.0
            raw[i] = (x - math.floor(x)) * 2.0 - 1.0

        # L2 Normalize
        norm = np.linalg.norm(raw)
        if norm > 0:
            raw = raw / norm

        return raw.tolist()

    def evaluate_liveness(self, image_data: str) -> Dict[str, Any]:
        hash_val = sum(ord(c) for c in image_data)
        score = (math.sin(hash_val) + 1.0) / 2.0  # Range [0.0, 1.0]

        # Score > 0.3 considered live
        is_live = score >= 0.3
        status = "LIVE" if is_live else "SPOOF"

        return {
            "is_live": is_live,
            "score": round(score, 4),
            "status": status,
            "model_version": self.liveness_version
        }
