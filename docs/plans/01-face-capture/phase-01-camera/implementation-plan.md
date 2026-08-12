# Implementation Plan — Phase 1: Camera Layer

Xây dựng package `@face/camera` phục vụ quản lý camera lifecycle, trích xuất video frame real-time, xử lý các sự kiện ngắt kết nối/xin quyền, và tạo bộ UI components tương tác camera trong `@face/ui`.

## User Review Required

> [!IMPORTANT]
> - **Web Standard API**: Sử dụng `navigator.mediaDevices.getUserMedia()` và `ImageBitmap` / `OffscreenCanvas` để đảm bảo hoạt động tương thích 100% trên cả Electron Desktop lẫn Browser environment.
> - **Preview vs Frame Resolution**: Preview hiển thị độ phân giải gốc của camera, trong khi frame trích xuất cho CV engine có thể được downscale chủ động để giữ hiệu năng.

## Open Questions

Không có câu hỏi mở cho Phase 1.

## Proposed Changes

### Package: `@face/camera` (`packages/camera`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/camera/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/camera/tsconfig.json)
#### [NEW] [src/BrowserCameraService.ts](file:///Users/skyline/PROJECTS/face-capture/packages/camera/src/BrowserCameraService.ts)
- Triển khai `CameraService` interface của `@face/core`:
  - `enumerateDevices()`: Lấy danh sách videoinput devices.
  - `requestPermission()`: Yêu cầu quyền truy cập webcam.
  - `start(constraints)`: Khởi tạo `MediaStream`, thiết lập track constraints.
  - `stop()`, `pause()`, `resume()`: Quản lý vòng đời stream.
  - `getFrame()`: Trích xuất frame hiện tại dưới dạng `FrameInput` (sử dụng `ImageBitmap` / `Canvas`).
  - Event listener cho `devicechange`, `disconnect`, `error`.
#### [NEW] [src/__tests__/BrowserCameraService.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/camera/src/__tests__/BrowserCameraService.test.ts)
- Unit tests kiểm tra state machine và mock MediaDevices.
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/camera/src/index.ts)

---

### Package: `@face/ui` (`packages/ui`)

#### [MODIFY] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/ui/package.json)
- Thêm `react` và `react-dom` peerDependencies / devDependencies.

#### [NEW] [src/components/camera/CameraPreview.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraPreview.tsx)
- Render video stream với chế độ mirror (webcam selfie), aspect-ratio fit/cover, và canvas overlay cho face bounding box.

#### [NEW] [src/components/camera/CameraSelector.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraSelector.tsx)
- Select dropdown hiển thị danh sách camera sẵn có và chọn camera mặc định.

#### [NEW] [src/components/camera/CameraPermission.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraPermission.tsx)
- UI thông báo xin quyền camera hoặc hướng dẫn khi bị từ chối.

#### [NEW] [src/components/camera/CameraError.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/camera/CameraError.tsx)
- Hiển thị lỗi camera kèm nút Thử lại (Retry).

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)
- Export các camera components.

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn workspace:
  ```bash
  pnpm build
  ```
- Thực thi unit tests cho `@face/camera`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Verify `BrowserCameraService` khởi tạo stream, xử lý pause/resume/stop và bắt đúng sự kiện ngắt kết nối.
