import unittest
from fastapi.testclient import TestClient
from src.api.app import app

class TestPythonAIService(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        response = self.client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "python-ai-sidecar")

    def test_embedding_extraction(self):
        response = self.client.post("/api/v1/embed", json={"image_data": "sample_base64_image_payload"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["dimension"], 512)
        self.assertEqual(len(data["vector"]), 512)
        self.assertEqual(data["model_family"], "ArcFace-Python")

    def test_liveness_evaluation(self):
        response = self.client.post("/api/v1/liveness", json={"image_data": "sample_base64_image_payload"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("is_live", data)
        self.assertIn("score", data)
        self.assertIn("status", data)

if __name__ == "__main__":
    unittest.main()
