import os
import unittest

import cv2
import numpy as np

from src.models.face_landmarks import FaceDetectionResult, FaceLandmarkDetector
from src.models.retouch_pipeline import apply_retouch, build_skin_mask

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "sample_face.jpg")


class TestSkinMaskHaarFallback(unittest.TestCase):
    """The ellipse-based fallback mask (used when mediapipe is unavailable)
    tested in isolation, without needing any real face detection."""

    def setUp(self):
        self.shape = (200, 200, 3)
        self.det = FaceDetectionResult(
            method="haar_fallback",
            landmarks_px=None,
            left_eye_center=(70, 80),
            right_eye_center=(130, 80),
            chin=(100, 180),
            forehead=(100, 20),
            face_box=(50, 20, 100, 160),  # x, y, w, h
        )

    def test_mask_shape_and_range(self):
        mask, warnings = build_skin_mask(self.shape, self.det)
        self.assertEqual(mask.shape, (200, 200))
        self.assertGreaterEqual(mask.min(), 0.0)
        self.assertLessEqual(mask.max(), 1.0)
        self.assertTrue(any("fallback" in w for w in warnings))

    def test_mask_is_zero_far_outside_face_box(self):
        mask, _ = build_skin_mask(self.shape, self.det)
        # Corner of the image is nowhere near the face ellipse.
        self.assertEqual(mask[0, 0], 0.0)
        self.assertEqual(mask[199, 199], 0.0)

    def test_mask_excludes_eye_band_but_keeps_lower_face(self):
        mask, _ = build_skin_mask(self.shape, self.det)
        x, y, w, h = self.det.face_box
        # A point well inside the eye-exclusion strip (~40% down the box,
        # away from any feathered boundary) should be fully excluded.
        eye_band_point = (y + int(h * 0.40), x + w // 2)
        self.assertLess(mask[eye_band_point], 0.05)

        # A point on the lower cheek/chin area (~85% down the box, still
        # inside the ellipse) should be included as retouchable skin.
        lower_face_point = (y + int(h * 0.85), x + w // 2)
        self.assertGreater(mask[lower_face_point], 0.5)


class TestApplyRetouchMediaPipe(unittest.TestCase):
    """End-to-end retouch on a real face photo: verifies the boundary
    behavior that matters for identity preservation -- eyes must be left
    bit-for-bit untouched, while skin actually changes."""

    def setUp(self):
        self.image = cv2.imread(FIXTURE_PATH)
        self.assertIsNotNone(self.image, "failed to load test fixture image")
        self.detector = FaceLandmarkDetector()
        self.det = self.detector.detect(self.image)

    def test_mediapipe_available_for_this_fixture(self):
        # Sanity check for the rest of this test class: if this fails, the
        # environment fell back to Haar and the eye-exclusion assertions
        # below would be testing the wrong code path.
        self.assertEqual(self.det.method, "mediapipe")

    def test_output_shape_matches_input(self):
        out, warnings = apply_retouch(self.image, "LIGHT")
        self.assertEqual(out.shape, self.image.shape)
        self.assertIsInstance(warnings, list)

    def test_eye_pixels_are_left_untouched(self):
        out, _ = apply_retouch(self.image, "MEDIUM")
        for eye_center in (self.det.left_eye_center, self.det.right_eye_center):
            x, y = int(round(eye_center[0])), int(round(eye_center[1]))
            before = self.image[y, x].astype(int)
            after = out[y, x].astype(int)
            # Exact match: the exclusion hull is dilated by several pixels
            # specifically so points at the landmark-derived eye center are
            # never touched by the bilateral filter blend.
            np.testing.assert_array_equal(before, after)

    def test_cheek_skin_is_actually_smoothed(self):
        out, _ = apply_retouch(self.image, "MEDIUM")
        # Midpoint between the eyes and the chin, offset toward one side --
        # lands on cheek skin, well away from eyes/eyebrows/lips.
        eye_mid_x = (self.det.left_eye_center[0] + self.det.right_eye_center[0]) / 2.0
        eye_mid_y = (self.det.left_eye_center[1] + self.det.right_eye_center[1]) / 2.0
        cheek_x = int(round(eye_mid_x + (self.det.right_eye_center[0] - eye_mid_x) * 1.6))
        cheek_y = int(round(eye_mid_y + (self.det.chin[1] - eye_mid_y) * 0.55))

        h, w = self.image.shape[:2]
        cheek_x = min(max(cheek_x, 0), w - 1)
        cheek_y = min(max(cheek_y, 0), h - 1)

        # A single pixel can coincidentally match after filtering, so
        # compare a small patch mean instead of one pixel.
        before_patch = self.image[cheek_y - 3 : cheek_y + 3, cheek_x - 3 : cheek_x + 3].astype(np.float32)
        after_patch = out[cheek_y - 3 : cheek_y + 3, cheek_x - 3 : cheek_x + 3].astype(np.float32)
        diff = float(np.abs(before_patch - after_patch).mean())
        self.assertGreater(diff, 0.0, "expected bilateral filtering to change cheek skin at all")

    def test_unsupported_strength_raises(self):
        with self.assertRaises(ValueError):
            apply_retouch(self.image, "EXTREME")


if __name__ == "__main__":
    unittest.main()
