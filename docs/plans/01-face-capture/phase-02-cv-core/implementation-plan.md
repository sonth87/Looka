# Implementation Plan — Phase 2: CV Core

Xây dựng bộ thư viện xử lý Computer Vision cốt lõi (phát hiện khuôn mặt, facial landmarks, ước lượng tư thế đầu Yaw/Pitch/Roll, đánh giá chất lượng ảnh) và tích hợp MediaPipe Face Landmarker adapter cùng bộ UI Debug Overlay.

## User Review Required

> [!IMPORTANT]
> - **MediaPipe WASM Adapter**: Package `@face/cv-mediapipe` đóng vai trò adapter kết nối với `@mediapipe/tasks-vision` chạy hoàn toàn offline trên WASM / WebGL.
> - **Pose Estimation Algorithm**: Tính toán góc Yaw, Pitch, Roll trực tiếp từ 468 facial landmarks chính (mũi, mắt, cằm, tai) với cơ chế làm mượt Exponential Moving Average (EMA) để tránh hiện tượng giật (jitter).
> - **Quality Assessment**: Kết hợp thuật toán tính độ sắc nét (Laplacian variance), độ sáng trung bình (luminance histogram), tỷ lệ kích thước khuôn mặt so với khung hình và độ lệch tâm.

## Open Questions

Không có câu hỏi mở cho Phase 2.

## Proposed Changes

### Package: `@face/face-quality` (`packages/face-quality`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/face-quality/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/face-quality/tsconfig.json)
#### [NEW] [src/QualityEvaluator.ts](file:///Users/skyline/PROJECTS/face-capture/packages/face-quality/src/QualityEvaluator.ts)
- Tính toán sharpness (Laplacian variance), brightness (luminance), face size ratio, center offset X/Y và trả về `FaceQualityResult` với mảng `reasons` cấu trúc.
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/face-quality/src/index.ts)

---

### Package: `@face/cv-mediapipe` (`packages/cv-mediapipe`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/package.json)
- Dependency: `@mediapipe/tasks-vision`, `@face/core`, `@face/face-quality`.
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/tsconfig.json)
#### [NEW] [src/MediaPipeCVEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/MediaPipeCVEngine.ts)
- Triển khai `CVEngine` interface của `@face/core`:
  - Khởi tạo MediaPipe `FaceLandmarker`.
  - Chạy `processFrame()` chuyển đổi video frame -> 468 landmarks -> Pose (Yaw/Pitch/Roll) -> Quality.
  - Hỗ trợ làm mượt pose với EMA smoothing filter.
  - Phát hiện trạng thái `NO_FACE`, `SINGLE_FACE`, `MULTIPLE_FACES`.
#### [NEW] [src/PoseEstimator.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/PoseEstimator.ts)
- Thuật toán trích xuất Yaw/Pitch/Roll từ landmarks và chuẩn hóa góc nghiêng.
#### [NEW] [src/__tests__/PoseEstimator.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/__tests__/PoseEstimator.test.ts)
- Unit tests cho thuật toán tính toán tư thế đầu.
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-mediapipe/src/index.ts)

---

### Package: `@face/ui` (`packages/ui`)

#### [NEW] [src/components/debug/DebugPanel.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/debug/DebugPanel.tsx)
- Hiển thị thông số thời gian thực: Camera FPS, CV FPS, Yaw/Pitch/Roll, Confidence, Brightness, Sharpness, Face Size.

#### [NEW] [src/components/face/FaceOverlay.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/face/FaceOverlay.tsx)
- Vẽ Bounding Box xung quanh khuôn mặt, hiển thị trạng thái phát hiện khuôn mặt và các điểm landmark tùy chọn.

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)
- Export `DebugPanel` và `FaceOverlay`.

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/face-quality` và `@face/cv-mediapipe`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Test `MediaPipeCVEngine` và `QualityEvaluator` với mock/video frames, kiểm tra kết quả tính toán Yaw/Pitch/Roll và chỉ số độ sáng/độ nét.
