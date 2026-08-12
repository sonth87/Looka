# Implementation Plan — Pillar C (Phases 10 & 11): Electron Packaging & Production Hardening

Xây dựng ứng dụng Desktop Electron độc lập `@face/desktop` (`apps/desktop`), triển khai kiến trúc hai lớp Main Process & Preload Script bảo mật (`contextIsolation`, no Node integration), hệ thống Typed IPC APIs, hoàn thiện các Database Repositories còn thiếu, tích hợp trọn vẹn luồng Đăng ký khuôn mặt End-to-End và Kiosk Chấm công tự động Real-time.

## User Review Required

> [!IMPORTANT]
> - **Electron Architecture & Security**: Renderer UI hoàn toàn bị phong tỏa không có Node integration. Giao tiếp với tầng AI, SQLite Database và Camera phần cứng thông qua `preload.ts` mở API chuẩn `window.faceAPI`.
> - **End-to-End Integration**:
>   - Ghi nhận đầy đủ `Person` và `FaceProfile` kèm các vector đặc trưng 512 chiều vào SQLite.
>   - Tích hợp kiểm tra Deep Liveness từ dịch vụ Python AI Sidecar trước khi chốt kết quả nhận diện 1:N.
>   - Triển khai màn hình **Kiosk Attendance Real-time** (`KioskAttendanceScreen.tsx`) tự động quét khuôn mặt, xác thực và hiển thị kết quả chấm công.

## Open Questions

Không có câu hỏi mở cho Pillar C.

## Proposed Changes

### 1. Package: `@face/database` (`packages/database`)

#### [NEW] [src/repositories/PersonRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/PersonRepository.ts)
- Quản lý tạo mới, cập nhật và truy vấn thông tin nhân sự `persons`.

#### [NEW] [src/repositories/FaceProfileRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/FaceProfileRepository.ts)
- Ghi nhận `face_profiles` và `face_embeddings` vào SQLite local theo đúng giao dịch nguyên tử (Atomic transaction).

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/index.ts)
- Export `PersonRepository` và `FaceProfileRepository`.

---

### 2. Package: `@face/ui` (`packages/ui`)

#### [NEW] [src/components/screens/KioskAttendanceScreen.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/screens/KioskAttendanceScreen.tsx)
- Màn hình Kiosk chấm công tự động real-time hiển thị video stream, khung bounding box nhận diện, thông báo tên nhân sự thành công hoặc trạng thái `UNKNOWN`/`ALREADY_RECORDED`.

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)
- Export `KioskAttendanceScreen`.

---

### 3. Application: `@face/desktop` (`apps/desktop`) [Phase 10]

#### [NEW] [apps/desktop/package.json](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/package.json)
#### [NEW] [apps/desktop/tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/tsconfig.json)
#### [NEW] [apps/desktop/electron-builder.json](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/electron-builder.json)

#### [NEW] [src/main/index.ts](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/main/index.ts)
- Main process khởi tạo BrowserWindow, cài đặt IPC handlers cho `camera:*`, `face:*`, `attendance:*`, và khởi tạo SQLite db connection.

#### [NEW] [src/preload/index.ts](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/preload/index.ts)
- Preload script mở các hàm bất đồng bộ typed IPC thông qua `contextBridge.exposeInMainWorld('faceAPI', ...)`.

#### [NEW] [src/renderer/index.html](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/renderer/index.html)
#### [NEW] [src/renderer/App.tsx](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/renderer/App.tsx)
- Application Shell cho Electron Desktop hỗ trợ chuyển đổi linh hoạt giữa Mode Đăng ký (`RegistrationMode`) và Mode Kiosk Điểm danh (`KioskMode`).

---

## Verification Plan

### Automated Tests
- Build kiểm thử toàn bộ Workspace (13 packages & apps):
  ```bash
  pnpm build
  ```
- Chạy unit test suite của dự án:
  ```bash
  pnpm test
  ```

### Manual Verification
- Khởi chạy Electron Desktop App local:
  ```bash
  pnpm --filter @face/desktop dev
  ```
- Kiểm tra tính năng Đăng ký nhân sự tạo Profile lưu vào SQLite local thành công.
- Chuyển sang Mode Kiosk điểm danh, kiểm tra hệ thống tự động quét nhận diện nhân sự vừa đăng ký và tạo dữ liệu chấm công thành công.
