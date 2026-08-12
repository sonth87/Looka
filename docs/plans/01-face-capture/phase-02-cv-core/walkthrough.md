# Phase 2: CV Core — Walkthrough

Đã hoàn thành triển khai bộ các package Computer Vision cốt lõi (`@face/face-quality`, `@face/cv-mediapipe`) và bộ UI components Debug Overlay (`@face/ui`).

---

## Các Thay Đổi Đã Thực Hiện

### 1. Package `@face/face-quality` (`packages/face-quality`)
- [QualityEvaluator.ts](file:///Users/skyline/PROJECTS/face-capture/packages/face-quality/src/QualityEvaluator.ts):
  - `calculateBrightness`: Thuật toán tính độ sáng trung bình chuẩn Relative Luminance (`0.2126R + 0.7152G + 0.0722B`) từ pixel buffer.
  - `calculateSharpness`: Thuật toán tính độ sắc nét bằng phương pháp normalized variance of Laplacian 3x3 kernel.
  - `evaluateQuality`: Kiểm tra toàn bộ cổng chất lượng (tỷ lệ face size, độ lệch tâm, độ sáng, độ nét) và trả về `FaceQualityResult` kèm mảng `reasons` mô tả nguyên nhân lỗi.
- [QualityEvaluator.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/face-quality/src/__tests__/QualityEvaluator.test.ts): Unit tests kiểm tra độ sáng, face size quá nhỏ, và face off-center.

### 2. Package `@face/cv-mediapipe` (`packages/cv-mediapipe`)
- [PoseEstimator.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/PoseEstimator.ts):
  - Thuật toán tính toán góc nghiêng Yaw (-90 đến +90 deg: Trái/Phải), Pitch (Ngẩng/Cúi), Roll (Nghiêng) từ 468 điểm facial landmarks chuẩn Master Spec.
  - Tích hợp bộ lọc làm mượt Exponential Moving Average (EMA) chống hiện tượng giật rung góc đầu.
- [MediaPipeCVEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/MediaPipeCVEngine.ts):
  - Implementation cho `CVEngine` interface với `@mediapipe/tasks-vision` WASM model.
  - Xử lý frame -> Landmarks -> Pose -> Quality -> Trả về `FaceState` chuẩn hợp đồng domain.
- [PoseEstimator.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/__tests__/PoseEstimator.test.ts): Unit test suite cho góc nghiêng đầu và bộ lọc EMA.

### 3. Debug Components trong `@face/ui` (`packages/ui`)
- [DebugPanel.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/debug/DebugPanel.tsx): Bảng điều khiển debug thời gian thực hiển thị Camera FPS, CV FPS, góc Yaw/Pitch/Roll, chỉ số Brightness, Sharpness, Size Ratio và lý do từ chối chất lượng.
- [FaceOverlay.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/face/FaceOverlay.tsx): Bounding box khuôn mặt động với trạng thái màu sắc (Xanh: OK, Vàng: Warning/Multiple, Đỏ: Reject) và hiển thị các điểm landmarks.
- Export components trong `packages/ui/src/index.ts`.

---

## Kết Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 6 successful, 6 total` (tất cả 6 packages compile 100% không lỗi).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 9, fail 0` (toàn bộ 9 unit tests thuộc `@face/camera`, `@face/cv-engine`, `@face/face-quality`, `@face/cv-mediapipe` đều passed).
