# Implementation Plan — Phase 5: Optimization & Debug

Tối ưu hóa hiệu năng hệ thống bằng cách cô lập CV processing trong Web Worker, áp dụng chiến lược frame pipeline "latest-frame-wins" chống nghẽn bộ nhớ, và xây dựng chế độ giả lập Pose Simulation Mode để kiểm thử không cần camera.

## User Review Required

> [!IMPORTANT]
> - **Web Worker Isolation**: Xử lý suy luận MediaPipe CV được đưa vào Web Worker riêng biệt (`WorkerCVAdapter`) giúp main UI thread giữ vững 60 FPS mượt mà.
> - **Latest-Frame-Wins Strategy**: Hàng chờ frame chỉ giữ lại frame mới nhất. Nếu CV Worker chưa kịp xử lý frame cũ, các frame trung gian sẽ bị hủy bỏ (drop) để tránh trễ tích lũy và nghẽn RAM.
> - **Simulation Mode**: Thêm công cụ `SimulationSliders` trong `@face/ui` hỗ trợ AI Agent và Developer kéo các thanh trượt Yaw, Pitch, Roll và Quality để test toàn bộ guided capture workflow mà không cần soi mặt trước webcam.

## Open Questions

Không có câu hỏi mở cho Phase 5.

## Proposed Changes

### Package: `@face/cv-engine` (`packages/cv-engine`)

#### [NEW] [src/FramePipeline.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/FramePipeline.ts)
- Bộ quản lý luồng frame với cơ chế bounded queue (max 1 frame in-flight), tự động hủy frame cũ khi frame mới tới và đếm CV FPS.

#### [NEW] [src/WorkerCVAdapter.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/WorkerCVAdapter.ts)
- Web Worker proxy đóng vai trò wrapper bọc ngoài `CVEngine` thực tế, gửi `FrameInput` qua `postMessage` và nhận lại `FaceState` bất đồng bộ.

#### [NEW] [src/__tests__/FramePipeline.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/__tests__/FramePipeline.test.ts)
- Unit test suite kiểm thử cơ chế latest-frame-wins và thả trôi frame nghẽn.

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/index.ts)
- Export `FramePipeline` và `WorkerCVAdapter`.

---

### Package: `@face/ui` (`packages/ui`)

#### [NEW] [src/components/debug/SimulationSliders.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/debug/SimulationSliders.tsx)
- Giao diện giả lập thanh trượt:
  - Yaw (-90° đến +90°)
  - Pitch (-90° đến +90°)
  - Roll (-90° đến +90°)
  - Face Presence (NO_FACE, SINGLE_FACE, MULTIPLE_FACES)
  - Face Size Ratio & Quality presets

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)
- Export `SimulationSliders`.

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/cv-engine`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Kiểm tra `FramePipeline` điều tiết tốc độ xử lý frame không bị tích lũy delay khi đưa vào tải 60 FPS.
