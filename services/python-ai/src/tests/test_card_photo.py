import base64
import os
import unittest

import cv2
import numpy as np
from fastapi.testclient import TestClient

from src.api.app import app
from src.models.card_photo_pipeline import CARD_PHOTO_PIXEL_TABLE, get_target_pixels, process_card_photo

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "sample_face.jpg")


class TestPixelTable(unittest.TestCase):
    """docs/plans/campaign-config-sso-card-photo-discussion.md §3.5's pixel
    table, implemented exactly."""

    def test_pixel_table_exact_values(self):
        self.assertEqual(get_target_pixels("3x4", 300), (354, 472))
        self.assertEqual(get_target_pixels("3x4", 600), (709, 945))
        self.assertEqual(get_target_pixels("4x6", 300), (472, 709))
        self.assertEqual(get_target_pixels("4x6", 600), (945, 1417))

    def test_pixel_table_has_exactly_four_entries(self):
        self.assertEqual(len(CARD_PHOTO_PIXEL_TABLE), 4)

    def test_unsupported_combination_raises(self):
        with self.assertRaises(ValueError):
            get_target_pixels("5x7", 300)
        with self.assertRaises(ValueError):
            get_target_pixels("3x4", 150)


class TestCardPhotoEndpoint(unittest.TestCase):
    """End-to-end: hit POST /api/v1/card-photo with a real face photo and
    check the output image actually has the requested pixel dimensions."""

    def setUp(self):
        self.client = TestClient(app)
        with open(FIXTURE_PATH, "rb") as f:
            self.image_b64 = base64.b64encode(f.read()).decode("ascii")

    def _post(self, size, dpi, background="#FFFFFF"):
        return self.client.post(
            "/api/v1/card-photo",
            json={
                "image_data": self.image_b64,
                "card_spec": {
                    "size": size,
                    "dpi": dpi,
                    "backgroundColor": background,
                },
            },
        )

    def test_4x6_300dpi_output_dimensions(self):
        response = self._post("4x6", 300)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["width"], 472)
        self.assertEqual(data["height"], 709)
        self.assertEqual(data["dpi"], 300)
        self.assertIsInstance(data["warnings"], list)

        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(data["image_data"]), np.uint8), cv2.IMREAD_COLOR)
        self.assertIsNotNone(decoded)
        h, w = decoded.shape[:2]
        self.assertEqual((w, h), (472, 709))

    def test_3x4_600dpi_output_dimensions(self):
        response = self._post("3x4", 600)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["width"], 709)
        self.assertEqual(data["height"], 945)
        self.assertEqual(data["dpi"], 600)

        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(data["image_data"]), np.uint8), cv2.IMREAD_COLOR)
        h, w = decoded.shape[:2]
        self.assertEqual((w, h), (709, 945))

    def test_invalid_image_data_returns_422(self):
        response = self.client.post(
            "/api/v1/card-photo",
            json={
                "image_data": "not-valid-base64!!!",
                "card_spec": {"size": "4x6", "dpi": 300},
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_invalid_card_spec_size_returns_422(self):
        response = self.client.post(
            "/api/v1/card-photo",
            json={
                "image_data": self.image_b64,
                "card_spec": {"size": "5x7", "dpi": 300},
            },
        )
        # Pydantic Literal validation rejects this before it reaches the pipeline.
        self.assertEqual(response.status_code, 422)


class TestCardPhotoMirror(unittest.TestCase):
    """`mirror` flag (2026-09-10, "chup anh the phai giong anh soi guong,
    khong lat anh"): `process_card_photo(mirror=True)` must flip the input
    horizontally BEFORE face detection/rotation/crop/background-replace run.

    Proof strategy: flipping the input ourselves and then asking the
    pipeline to flip it back (`mirror=True`) should cancel out, landing
    close to the same result as running `mirror=False` on the original,
    un-flipped image — a mean-abs-pixel-difference threshold rather than
    exact equality, since JPEG re-encode / background replace introduce
    minor non-determinism. If the flip happened AFTER detection (or not at
    all), this would not hold: detection would run on mismatched geometry
    and the crop/rotation would diverge well past the threshold.
    """

    def setUp(self):
        self.image = cv2.imread(FIXTURE_PATH)
        self.assertIsNotNone(self.image, "fixture image failed to load")

    @staticmethod
    def _mean_abs_diff(a: np.ndarray, b: np.ndarray) -> float:
        return float(cv2.absdiff(a, b).astype(np.float32).mean())

    def test_mirror_before_detection_cancels_out_a_pre_flipped_input(self):
        result_plain, _ = process_card_photo(
            self.image, size="4x6", dpi=300, background_color="#FFFFFF", mirror=False
        )

        pre_flipped_input = cv2.flip(self.image, 1)
        result_mirrored, _ = process_card_photo(
            pre_flipped_input, size="4x6", dpi=300, background_color="#FFFFFF", mirror=True
        )

        self.assertEqual(result_plain.shape, result_mirrored.shape)
        mean_diff = self._mean_abs_diff(result_plain, result_mirrored)
        self.assertLess(
            mean_diff,
            5.0,
            f"mirror=True on a pre-flipped input should closely match mirror=False on "
            f"the original (mean abs pixel diff was {mean_diff}); this only holds if "
            f"the flip happens BEFORE detection/rotation/crop, not after",
        )

    def test_mirror_flag_has_a_real_effect_on_the_output(self):
        # Same source image, only `mirror` differs -- proves the flag is
        # actually wired through to the pipeline rather than silently
        # ignored (the two outputs must NOT be near-identical).
        result_plain, _ = process_card_photo(
            self.image, size="4x6", dpi=300, background_color="#FFFFFF", mirror=False
        )
        result_mirrored, _ = process_card_photo(
            self.image, size="4x6", dpi=300, background_color="#FFFFFF", mirror=True
        )
        mean_diff = self._mean_abs_diff(result_plain, result_mirrored)
        self.assertGreater(
            mean_diff,
            5.0,
            "mirror=True produced an output indistinguishable from mirror=False -- "
            "the flag appears to have no effect",
        )


if __name__ == "__main__":
    unittest.main()
