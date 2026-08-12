# Phase 3: Workflow & Capture — Walkthrough

Đã hoàn thành xây dựng package điều phối quy trình `@face/workflow-engine` (State Machine 15+ trạng thái, Rule Evaluator, Stability Tracker, Guidance Engine ưu tiên có hysteresis, Auto-Capture Controller) và bộ UI components tiến trình chụp trong `@face/ui`.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Package `@face/workflow-engine` (`packages/workflow-engine`)
- [StepEvaluator.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/StepEvaluator.ts):
  - Triển khai `StepEvaluator` interface của `@face/core`.
  - Kiểm tra sự hiện diện khuôn mặt (`NO_FACE`, `SINGLE_FACE`, `MULTIPLE_FACES`), góc nghiêng pose (Yaw/Pitch/Roll) theo target + tolerance, kích thước và vị trí khuôn mặt, và kết quả kiểm tra chất lượng.
- [StabilityTracker.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/StabilityTracker.ts):
  - Theo dõi khoảng thời gian duy trì tư thế đúng liên tục (time-based stability).
  - Trả về tiến trình ổn định (0 đến 1.0) và trạng thái `isStable`.
- [GuidanceEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/GuidanceEngine.ts):
  - Sinh câu hướng dẫn ưu tiên cao nhất theo thứ tự: `NO_FACE` > `MULTIPLE_FACES` > `FACE_TOO_SMALL` > `FACE_TOO_LARGE` > `OFF_CENTER` > `TURN_LEFT` / `TURN_RIGHT` > `LOOK_UP` / `LOOK_DOWN` > `TOO_DARK` > `BLURRY` > `HOLD_STILL`.
  - Tích hợp bộ đệm Hysteresis chống hiện tượng nhấp nháy câu lệnh UI khi người dùng đứng sát ranh giới tolerance.
- [CaptureController.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/CaptureController.ts):
  - Quản lý trigger chụp ảnh tự động và kiểm tra lại chất lượng sau chụp.
- [WorkflowEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/WorkflowEngine.ts):
  - Triển khai FSM điều phối các trạng thái registration session, chuyển bước tự động (FRONT -> LEFT -> RIGHT -> UP -> DOWN), retry bước, skip bước và timeout handling.
- [WorkflowEngine.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/__tests__/WorkflowEngine.test.ts): Unit test suite kiểm tra chuyển bước tự động và hoàn thành session.

### 2. Workflow Components trong `@face/ui` (`packages/ui`)
- [StepProgress.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/StepProgress.tsx): Thanh tiến trình các bước chụp dạng (● ━ ● ━ ○ ━ ○) kèm icon và trạng thái.
- [GuidanceMessage.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/GuidanceMessage.tsx): Hiển thị câu lệnh hướng dẫn chính và gợi ý phụ với badge trạng thái.
- [StabilityProgress.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/StabilityProgress.tsx): Thanh đếm tiến trình giữ nguyên tư thế.
- [CountdownTimer.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/CountdownTimer.tsx): Đồng hồ đếm ngược 3..2..1..📸.
- Export components trong `packages/ui/src/index.ts`.

---

## Kết Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 7 successful, 7 total` (tất cả 7 packages compile 100% không lỗi).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 12, fail 0` (toàn bộ 12 unit tests thuộc các package `@face/camera`, `@face/cv-engine`, `@face/face-quality`, `@face/cv-mediapipe`, `@face/workflow-engine` đều passed).
