# Implementation Plan — Phase 3: Workflow & Capture

Xây dựng package `@face/workflow-engine` chịu trách nhiệm điều phối toàn bộ quy trình chụp ảnh hướng dẫn tự động (Rule Evaluator, Guidance Engine với cơ chế ưu tiên & hysteresis, Stability Tracker, State Machine 15+ trạng thái, Auto Capture Controller) và các UI components hỗ trợ tiến trình.

## User Review Required

> [!IMPORTANT]
> - **Data-driven Workflow**: Quy trình chụp được cấu hình hoàn toàn dưới dạng dữ liệu JSON (`CaptureWorkflow`), không hard-code số lượng hay loại bước chụp (FRONT, LEFT, RIGHT, UP, DOWN).
> - **Hysteresis & Priority Guidance**: Chỉ hiển thị 1 câu hướng dẫn có ưu tiên cao nhất tại một thời điểm, sử dụng khoảng đệm hysteresis xung quanh ngưỡng pose target để chống hiện tượng nhấp nháy UI.
> - **Auto Capture Stability**: Tự động chụp ảnh chỉ khi tư thế và chất lượng đạt chuẩn và giữ ổn định liên tục trong khoảng thời gian cấu hình (`stabilityDurationMs`, mặc định 500ms).

## Open Questions

Không có câu hỏi mở cho Phase 3.

## Proposed Changes

### Package: `@face/workflow-engine` (`packages/workflow-engine`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/tsconfig.json)
#### [NEW] [src/StepEvaluator.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/StepEvaluator.ts)
- Kiểm tra các tiêu chuẩn của từng bước: số lượng khuôn mặt, góc nghiêng pose (target + tolerance), kích thước và vị trí khuôn mặt, các tiêu chuẩn chất lượng.
#### [NEW] [src/StabilityTracker.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/StabilityTracker.ts)
- Theo dõi khoảng thời gian duy trì tư thế đúng liên tục; reset khi bị gián đoạn hoặc rời khỏi vùng tolerance.
#### [NEW] [src/GuidanceEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/GuidanceEngine.ts)
- Phân tích lỗi theo thứ tự ưu tiên (No Face > Multiple Faces > Size > Off Center > Pose > Quality) và tạo `GuidanceState` tiếng Việt có hysteresis.
#### [NEW] [src/WorkflowEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/WorkflowEngine.ts)
- Triển khai `WorkflowEngine` interface điều khiển FSM 15+ trạng thái: khởi tạo session, chuyển bước, retry, timeout, hoàn thành workflow.
#### [NEW] [src/CaptureController.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/CaptureController.ts)
- Xử lý trigger chụp ảnh tự động, lưu tạm thời và validate lại chất lượng ảnh sau khi chụp.
#### [NEW] [src/__tests__/WorkflowEngine.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/__tests__/WorkflowEngine.test.ts)
- Unit test suite kiểm thử chuyển đổi trạng thái FSM, tính ổn định và ưu tiên hướng dẫn.
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/workflow-engine/src/index.ts)

---

### Package: `@face/ui` (`packages/ui`)

#### [NEW] [src/components/workflow/StepProgress.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/StepProgress.tsx)
- Thanh tiến trình các bước chụp (● ━ ● ━ ○ ━ ○) kèm icon và nhãn trạng thái.

#### [NEW] [src/components/workflow/GuidanceMessage.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/GuidanceMessage.tsx)
- Component hiển thị câu lệnh hướng dẫn chính và gợi ý phụ với animation chuyển đổi.

#### [NEW] [src/components/workflow/StabilityProgress.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/StabilityProgress.tsx)
- Thanh đếm ngược "Giữ nguyên tư thế..." với hiệu ứng fill tiến trình.

#### [NEW] [src/components/workflow/CountdownTimer.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/CountdownTimer.tsx)
- Đồng hồ đếm ngược trực quan 3.. 2.. 1.. 📸 trước khi chụp.

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)
- Export các workflow components.

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/workflow-engine`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Test `WorkflowEngine` với `MockCVEngine` giả lập chuỗi tư thế FRONT -> LEFT -> RIGHT -> UP -> DOWN, kiểm tra chuyển bước tự động và trigger capture.
