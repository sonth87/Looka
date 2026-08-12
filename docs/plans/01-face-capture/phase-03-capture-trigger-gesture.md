# Phase 3.x — Capture Trigger Mode & Hand Gesture Recognition

## Mục tiêu

Bổ sung tính năng **Capture Trigger Mode** vào quy trình chụp ảnh khuôn mặt, cho phép người dùng chọn một trong ba chế độ kích hoạt chụp:

- **AUTO**: Tự động chụp sau khi khuôn mặt đúng vị trí trong N giây (mặc định 2s)
- **MANUAL**: Nhận ra ký hiệu tay từ người dùng bằng MediaPipe Hand Landmarker để kích hoạt chụp
- **OFF**: Hiện nút bấm thủ công (shutter button)

---

## Phụ thuộc

- `@face/core` — types mở rộng: `CaptureTriggerConfig`, `GestureType`, `GestureState`
- `@face/cv-mediapipe` — MediaPipe Hand Landmarker wasm model
- `@face/workflow-engine` — `CaptureController` mới
- `@face/ui` — UI components mới

---

## Danh sách Task

### Phase 3.1 — CaptureController + AUTO mode

- [ ] Thêm `CaptureTriggerConfig` interface vào `@face/core/src/types/capture-config.ts`
- [ ] Thêm `CaptureTriggerMode = 'AUTO' | 'MANUAL' | 'OFF'` vào core
- [ ] Implement `CaptureController` trong `@face/workflow-engine`
- [ ] Tích hợp `CaptureController` vào `WorkflowEngine.processFrame()`
- [ ] Mặc định `mode = 'AUTO'` với `stabilityDurationMs = 2000`
- [ ] `StabilityTracker` dùng lại cho AUTO mode timing
- [ ] Viết unit test: `CaptureController.test.ts`

### Phase 3.2 — OFF mode (Shutter Button)

- [ ] Implement `ShutterButton` UI component trong `@face/ui`
  - Enabled khi `faceReady === true`, disabled khi chưa đủ điều kiện
  - Bottom-center, nút tròn lớn, hiệu ứng ripple khi bấm
- [ ] Kết nối `ShutterButton` với `CaptureController` (mode OFF)
- [ ] Thêm mục chọn mode vào `OverlayConfigPanel`
- [ ] Lưu `mode` vào localStorage qua key `face_ui_capture_trigger_mode`
- [ ] Unit test: `ShutterButton.test.tsx`

### Phase 3.3 — @face/hand-gesture Package Bootstrap

- [ ] Tạo package mới: `packages/hand-gesture/`
- [ ] Thiết lập `package.json`, `tsconfig.json`, `turbo.json` entry
- [ ] Định nghĩa `GestureType`, `GestureState`, `HandLandmark` trong `src/types/`
- [ ] Định nghĩa `GestureEngine` interface trong `src/interfaces/`
- [ ] Implement `MockGestureEngine` (deterministic, configurable output)
- [ ] Viết unit test cho `MockGestureEngine`

### Phase 3.4 — RuleBasedClassifier

- [ ] Implement `RuleBasedClassifier` từ 21 hand landmarks
  - VICTORY: Index + Middle extended, Ring + Pinky closed
  - OPEN_PALM: Tất cả 5 ngón extended
  - CLOSED_FIST: Tất cả 5 ngón closed
  - THUMBS_UP: Chỉ Thumb extended thẳng lên
  - OK_SIGN: Thumb tip gần Index tip, ngón khác extended
- [ ] Helper: `isFingerExtended(tip, pip, mcp, wrist)`
- [ ] Helper: `isTipNear(tip1, tip2, threshold)`
- [ ] Implement `GestureSmoothing` (EMA, window-based majority vote)
- [ ] Viết unit test với mock landmark arrays cho từng gesture
- [ ] Viết unit test cho `GestureSmoothing`

### Phase 3.5 — MediaPipe Hand Landmarker Adapter

- [ ] Implement `MediaPipeGestureEngine` trong `@face/hand-gesture`
  - Tải `hand_landmarker.task` wasm model
  - Gọi `HandLandmarker.detect()` từng frame
  - Chuyển 21 landmarks sang `HandLandmark[]`
  - Gọi `RuleBasedClassifier` → `GestureState`
- [ ] Throttle gesture inference: chỉ xử lý khi now - lastGestureTime >= 80ms (~12 FPS)
- [ ] Expose `isInitialized` getter
- [ ] Handle model init failure (fallback to NONE)

### Phase 3.6 — Parallel GesturePipeline

- [ ] Implement `GesturePipeline` trong `@face/hand-gesture`
  - Nhận `FrameInput`, gọi `GestureEngine.processFrame()`
  - `onResult(cb)` callback pattern (tương tự `FramePipeline`)
  - Latest-frame-wins, không queue
- [ ] Tích hợp `GesturePipeline` song song với `FramePipeline` trong `App.tsx`
  - Live mode: cả hai pipeline nhận cùng camera frame
  - Simulation mode: `MockGestureEngine` nhận dummy frame
- [ ] Kết nối `GestureState` → `CaptureController.shouldCapture()`

### Phase 3.7 — MANUAL mode Integration

- [ ] Kết nối `GestureEngine` vào `WorkflowEngine` khi mode = MANUAL
- [ ] Implement gesture confirmation timer (giữ 500ms mới chụp)
- [ ] Reset confirmation timer khi gesture thay đổi hoặc mất
- [ ] Implement `GestureOverlay` UI component:
  - Badge hiển thị gesture đang nhận được + icon emoji (✌ 👍 ✋ ✊ 👌)
  - Confirmation progress bar (0 → 100% trong 500ms)
  - Tự ẩn khi không nhận được gesture
- [ ] Hiển thị `GestureOverlay` trên camera preview khi MANUAL mode

### Phase 3.8 — OverlayConfigPanel Extension

- [ ] Thêm section "Chế độ chụp" vào `OverlayConfigPanel`
  - 3 nút toggle: [AUTO] [MANUAL] [OFF]
  - Khi AUTO: hiện slider thời gian giữ (0.5s → 5.0s, default 2.0s)
  - Khi MANUAL: hiện danh sách gestures được chấp nhận (checklist)
- [ ] Lưu cấu hình vào localStorage
- [ ] Prop callbacks: `onCaptureModeChange`, `onAutoStabilityChange`, `onTriggerGesturesChange`

### Phase 3.9 — Simulation Mode Support

- [ ] Thêm "Gesture Simulator" vào `SimulationSliders` panel
  - Dropdown chọn gesture: NONE / VICTORY / THUMBS_UP / OPEN_PALM / CLOSED_FIST / OK_SIGN
  - Slider confidence: 0 → 1
- [ ] `MockGestureEngine.updateSettings({ gesture, confidence })`
- [ ] Tích hợp trong simulation frame loop: push gesture state cùng với face state
- [ ] Unit test: `MockGestureEngine` với updateSettings

---

## Acceptance Criteria

### AUTO mode
- [ ] Khuôn mặt đúng vị trí → thanh tiến trình tăng từ 0 → 100% trong thời gian cấu hình
- [ ] Khuôn mặt rời khỏi vị trí → thanh tiến trình reset về 0
- [ ] Sau khi thanh tiến trình đầy → hệ thống tự chụp và next step
- [ ] Thời gian giữ có thể thay đổi qua slider trong OverlayConfigPanel
- [ ] Cấu hình được lưu sau khi reload trang

### OFF mode
- [ ] Hiện nút shutter button khi face sẵn sàng (xanh)
- [ ] Nút ở trạng thái disabled (xám) khi face chưa đủ điều kiện
- [ ] Bấm nút → chụp ảnh + next step
- [ ] Hiệu ứng ripple khi bấm

### MANUAL mode
- [ ] Giơ tay VICTORY trước camera → badge "✌ VICTORY" xuất hiện
- [ ] Confirmation bar tăng trong 500ms
- [ ] Sau 500ms giữ gesture → chụp ảnh + next step
- [ ] Bỏ tay → bar reset, không chụp
- [ ] Chỉ chụp khi face cũng đang đúng vị trí

### Simulation
- [ ] Có thể chọn gesture trong SimulationSliders panel
- [ ] Hệ thống nhận diện gesture mock và xử lý như gesture thật

---

## Rủi ro & Giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Hand model wasm quá nặng (>50MB) | Lazy-load, chỉ tải khi MANUAL mode active |
| Gesture FPS làm lag face pipeline | Chạy parallel, throttle gesture ở 12 FPS |
| Gesture flickering | EMA smoothing + majority vote window |
| False positive gesture trigger | Confidence threshold 0.85 + 500ms confirmation |
| MediaPipe wasm fail trên một số browser | Fallback về OFF mode + thông báo người dùng |
