# Phase 1: Camera Layer — Walkthrough

Đã hoàn thành xây dựng package `@face/camera` quản lý vòng đời camera, trích xuất video frame real-time, và bộ UI components camera trong `@face/ui`.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Package `@face/camera` (`packages/camera`)
- [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/camera/package.json) & [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/camera/tsconfig.json): Định nghĩa package `@face/camera`.
- [BrowserCameraService.ts](file:///Users/skyline/PROJECTS/face-capture/packages/camera/src/BrowserCameraService.ts):
  - Triển khai `CameraService` interface của `@face/core`.
  - `enumerateDevices()`: Liệt kê các camera input khả dụng.
  - `requestPermission()`: Xin quyền truy cập webcam an toàn.
  - `start(constraints)`: Khởi tạo `MediaStream`, cài đặt track resolution/fps, tự động bắt sự kiện camera disconnect (`track.onended`).
  - `stop()`, `pause()`, `resume()`: Dừng/tạm dừng/tiếp tục stream.
  - `getFrame()`: Trích xuất frame hình ảnh hiện tại dưới dạng `FrameInput` (`Uint8ClampedArray` + timestamp).
  - Tích hợp event emitter cho các sự kiện `device-change`, `disconnect`, `error`.
- [BrowserCameraService.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/camera/src/__tests__/BrowserCameraService.test.ts): Unit tests kiểm tra xử lý lỗi khi không có API trình duyệt và kiểm tra event listener.

### 2. Camera Components trong `@face/ui` (`packages/ui`)
- [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/ui/package.json): Bổ sung `react`, `react-dom` và `@face/core` dependencies.
- [CameraPreview.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraPreview.tsx): Component hiển thị webcam stream với chế độ selfie mirror, tùy chỉnh aspect ratio (`16/9`, `4/3`, `1/1`) và canvas overlay hỗ trợ vẽ bounding box/landmarks.
- [CameraSelector.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraSelector.tsx): Select dropdown danh sách camera sẵn có.
- [CameraPermission.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraPermission.tsx): UI thông báo hướng dẫn xin quyền / xử lý từ chối quyền camera.
- [CameraError.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraError.tsx): Component hiển thị lỗi camera kèm nút Thử lại (Retry).
- [index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts): Export các camera UI components.

---

## Kết Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 4 successful, 4 total` (cả `@face/core`, `@face/camera`, `@face/cv-engine`, `@face/ui` đều compile 100% không có lỗi TypeScript).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 5, fail 0` (`BrowserCameraService` test suite & `MockCVEngine` test suite đều passed).
