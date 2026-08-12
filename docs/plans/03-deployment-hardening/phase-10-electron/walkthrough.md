# Pillar C (Phases 10 & 11): Electron Packaging & Production Hardening — Walkthrough

Đã hoàn thành xây dựng ứng dụng Desktop Electron độc lập `@face/desktop` (`apps/desktop`), triển khai hai tầng Main Process & Preload Script bảo mật (`contextIsolation`, no Node integration), các Repositories lưu trữ SQLite mới (`PersonRepository`, `FaceProfileRepository`), màn hình **Kiosk Attendance Real-time** (`KioskAttendanceScreen.tsx`) và hoàn thiện tích hợp hệ thống trọn vẹn.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Bổ sung Repositories trong `@face/database` (`packages/database`)
- [PersonRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/PersonRepository.ts): Thêm mới, cập nhật và truy vấn danh sách nhân sự `persons`.
- [FaceProfileRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/FaceProfileRepository.ts): Lưu trữ hồ sơ `face_profiles` và vector đặc trưng 512 chiều `face_embeddings` theo giao dịch nguyên tử SQL.
- [Database.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/__tests__/Database.test.ts): Thêm unit test kiểm tra `PersonRepository` và `FaceProfileRepository`.

### 2. Màn Hình Kiosk Attendance trong `@face/ui` (`packages/ui`)
- [KioskAttendanceScreen.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/screens/KioskAttendanceScreen.tsx): Màn hình Kiosk tự động quét khuôn mặt, hiển thị video stream, FaceOverlay bounding box, và banner trạng thái điểm danh (`RECORDED`, `ALREADY_RECORDED`, `REJECTED`).

### 3. Application Electron Desktop (`apps/desktop`)
- [package.json](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/package.json) & [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/tsconfig.json): Khai báo ứng dụng `@face/desktop`.
- [electron-builder.json](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/electron-builder.json): Cấu hình đóng gói Electron Desktop cho macOS (.dmg, .zip) và Windows (.nsis, .zip).
- [main/index.ts](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/main/index.ts): Main process khởi tạo BrowserWindow với `contextIsolation: true`, `nodeIntegration: false`, lắng nghe IPC handlers `app:getVersion`, `app:getStatus`.
- [preload/index.ts](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/preload/index.ts): Preload script mở an toàn API `window.faceAPI`.
- [App.tsx](file:///Users/skyline/PROJECTS/face-capture/apps/desktop/src/renderer/App.tsx): Application Shell hỗ trợ chuyển đổi linh hoạt giữa Mode Đăng ký (`GuidedCaptureScreen`) và Mode Kiosk Điểm danh (`KioskAttendanceScreen`) tích hợp lưu trữ SQLite local.

---

## Kết Quả Verification

1. **Workspace Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 13 successful, 13 total` (Tất cả 13 workspace packages & apps compile 100% không lỗi).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 27, fail 0` (Toàn bộ 27 Node TS unit tests passed).
   Python Service: `3/3 tests passed` (Tổng cộng **30 unit tests pass 100%**).
