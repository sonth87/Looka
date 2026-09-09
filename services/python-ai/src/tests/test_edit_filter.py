import unittest

from fastapi.testclient import TestClient

from src.api.app import app
from src.models.prompt_filter import find_forbidden_keyword

ALLOWED_PROMPTS = [
    "Bỏ lóa trên kính, giữ nguyên khuôn mặt",  # example from the plan's modal mockup
    "gọn tóc lòa xòa",
    "thẳng cổ áo",
    "nền trắng đều",
    "bỏ bụi/vết trên nền",
    "cân sáng hai bên mặt",
]

FORBIDDEN_PROMPTS = [
    ("làm cho người này cười tươi hơn", "cười"),
    ("mở mắt ra giúp tôi", "mở mắt"),
    ("bỏ kính đi nhé", "bỏ kính"),
    ("làm gầy mặt lại", "gầy"),
    ("trẻ hóa khuôn mặt", "trẻ hóa"),
    ("làm đẹp da mặt", "đẹp"),
    ("đổi mắt to hơn", "đổi mắt"),
    ("đổi mũi cao hơn", "đổi mũi"),
    ("đổi miệng nhỏ lại", "đổi miệng"),
]


class TestPromptFilterUnit(unittest.TestCase):
    def test_allowed_prompts_pass(self):
        for prompt in ALLOWED_PROMPTS:
            with self.subTest(prompt=prompt):
                self.assertIsNone(find_forbidden_keyword(prompt))

    def test_forbidden_prompts_are_caught(self):
        for prompt, expected_keyword_substring in FORBIDDEN_PROMPTS:
            with self.subTest(prompt=prompt):
                found = find_forbidden_keyword(prompt)
                self.assertIsNotNone(found, f"expected {prompt!r} to be rejected")

    def test_case_insensitive_match(self):
        self.assertIsNotNone(find_forbidden_keyword("CƯỜI lên nào"))
        self.assertIsNotNone(find_forbidden_keyword("Mở Mắt ra"))

    def test_empty_prompt_passes(self):
        self.assertIsNone(find_forbidden_keyword(""))


class TestEditEndpoint(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_forbidden_prompt_returns_422_with_matched_keyword(self):
        response = self.client.post(
            "/api/v1/edit",
            json={"image_data": "irrelevant-for-this-test", "prompt": "làm cho cười tươi lên", "region": "FULL"},
        )
        self.assertEqual(response.status_code, 422)
        data = response.json()
        self.assertIn("matchedKeyword", data)
        self.assertEqual(data["matchedKeyword"], "cười")

    def test_allowed_prompt_returns_501_not_implemented(self):
        response = self.client.post(
            "/api/v1/edit",
            json={
                "image_data": "irrelevant-for-this-test",
                "prompt": "Bỏ lóa trên kính, giữ nguyên khuôn mặt",
                "region": "GLASSES",
            },
        )
        self.assertEqual(response.status_code, 501)
        data = response.json()
        self.assertIn("Qwen-Image-Edit", data["detail"])

    def test_invalid_region_returns_422_validation_error(self):
        response = self.client.post(
            "/api/v1/edit",
            json={"image_data": "x", "prompt": "bỏ bụi trên nền", "region": "NOT_A_REGION"},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
