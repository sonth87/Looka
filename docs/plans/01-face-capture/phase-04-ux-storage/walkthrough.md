# Phase 4: UX & Storage — Walkthrough

Đã hoàn thành triển khai lớp lưu trữ cơ sở dữ liệu local-first `@face/database` (SQLite schema 11 tables DDL, `SQLiteStorageAdapter`, `SessionRepository`) và giao diện sản xuất `GuidedCaptureScreen` cùng `SessionReviewModal` trong `@face/ui`.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Package `@face/database` (`packages/database`)
- [schema.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/schema.ts): DDL SQL khởi tạo 11 bảng cơ sở dữ liệu chuẩn Master Spec (Section 40): `persons`, `face_profiles`, `face_embeddings`, `face_samples`, `attendance_sessions`, `attendance_records`, `sync_queue`, `model_versions`, `devices`, `app_settings`, `audit_events`.
- [SQLiteStorageAdapter.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/SQLiteStorageAdapter.ts): Triển khai `StorageAdapter` interface của `@face/core` sử dụng WASM-based `sql.js` (hỗ trợ in-memory fallback), cung cấp phương thức `get`, `set`, `delete`, `exec` và `run` giao tiếp SQLite.
- [SessionRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/SessionRepository.ts): Repository lưu trữ thông tin `CaptureSession`, trạng thái từng `CaptureStepResult` và tự động ghi log audit events.
- [Database.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/__tests__/Database.test.ts): Unit test suite kiểm tra thao tác get/set/delete trên SQLite và lưu/truy vấn session.

### 2. Giao Diện Sản Xuất trong `@face/ui` (`packages/ui`)
- [GuidedCaptureScreen.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/screens/GuidedCaptureScreen.tsx):
  - Màn hình chụp ảnh hướng dẫn hoàn chỉnh tích hợp: `CameraPreview` (mirrored, aspect ratio), `FaceOverlay` (bounding box, landmarks), `StepProgress` (thanh tiến trình bước chụp), `GuidanceMessage` (câu lệnh hướng dẫn ưu tiên), `StabilityProgress` (thanh tiến trình giữ ổn định), `CountdownTimer` (đếm ngược), `DebugPanel` (FPS, Pose, Quality metrics) và `CameraSelector` (chọn thiết bị).
- [SessionReviewModal.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/SessionReviewModal.tsx):
  - Modal hiển thị lưới xem lại toàn bộ ảnh đã chụp của phiên (ảnh, góc pose, chỉ số chất lượng % và nút Chụp lại / Xác nhận lưu).
- Export các màn hình và components mới trong `packages/ui/src/index.ts`.

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
   Output: `pass 14, fail 0` (toàn bộ 14 unit tests thuộc các package `@face/camera`, `@face/cv-engine`, `@face/face-quality`, `@face/cv-mediapipe`, `@face/workflow-engine`, `@face/database` đều passed).
