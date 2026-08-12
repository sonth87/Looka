# Phase 5: Optimization & Debug — Walkthrough

Đã hoàn thành tối ưu hóa luồng xử lý frame với `FramePipeline` (chiến lược latest-frame-wins & đếm CV FPS), hỗ trợ cô lập suy luận trong Web Worker với `WorkerCVAdapter`, và bổ sung bộ công cụ `SimulationSliders` trong `@face/ui` phục vụ kiểm thử guided capture không cần camera.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Optimization & Pipeline trong `@face/cv-engine` (`packages/cv-engine`)
- [FramePipeline.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/FramePipeline.ts):
  - Áp dụng chiến lược **latest-frame-wins** với bounded queue: Khi CVEngine đang bận xử lý, frame mới đẩy vào sẽ ghi đè lên frame chờ cũ và hủy các frame dư thừa (`droppedFrames`).
  - Đếm chỉ số tốc độ suy luận `cvFps` dựa trên rolling window thời gian thực thi.
- [WorkerCVAdapter.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/WorkerCVAdapter.ts):
  - Adapter giao tiếp bất đồng bộ qua Web Worker API, đóng vai trò proxy tách biệt hoàn toàn việc tính toán MediaPipe khỏi main UI thread.
- [FramePipeline.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/__tests__/FramePipeline.test.ts): Unit test suite kiểm tra việc xử lý nối tiếp và hủy frame rác khi quá tải.
- Export các module trong `packages/cv-engine/src/index.ts`.

### 2. Simulation Debug Mode trong `@face/ui` (`packages/ui`)
- [SimulationSliders.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/debug/SimulationSliders.tsx):
  - Giao diện giả lập kéo các thanh trượt Yaw (-90° đến +90°), Pitch, Roll, Face Size Ratio và các trạng thái hiện diện (`SINGLE_FACE`, `NO_FACE`, `MULTIPLE_FACES`).
  - Bổ sung nút bấm nhanh Presets (FRONT, LEFT, RIGHT, UP, DOWN, NO_FACE) giúp Developer và AI Agent dễ dàng kiểm thử guided capture workflow.
- Export `SimulationSliders` trong `packages/ui/src/index.ts`.

---

## Kết Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 8 successful, 8 total` (tất cả 8 packages compile 100% không lỗi).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 16, fail 0` (toàn bộ 16 unit tests thuộc tất cả các package đều passed).

---

## 🏆 Đánh Giá Tổng Kết PILLAR A (Face Capture & Guided Photography)

Với việc hoàn thành từ **Phase 0 đến Phase 5**, toàn bộ **PILLAR A — Face Capture & Guided Photography** đã chính thức hoàn thành đầy đủ:
- ✅ **Infrastructure Monorepo & Core Types** (`@face/core`)
- ✅ **Camera Lifecycle & Device Management** (`@face/camera`)
- ✅ **Face Detection, 468 Landmarks, Pose Estimation & Quality Gates** (`@face/cv-mediapipe`, `@face/face-quality`)
- ✅ **Guided Capture State Machine, Priority Guidance & Stability** (`@face/workflow-engine`)
- ✅ **Local Persistence & SQLite Schema** (`@face/database`)
- ✅ **Production UI Screen, Debug Panel & Simulation Mode** (`@face/ui`)
