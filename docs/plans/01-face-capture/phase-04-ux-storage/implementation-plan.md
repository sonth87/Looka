# Implementation Plan — Phase 4: UX & Storage

Xây dựng package `@face/database` lưu trữ SQLite local-first (schema tables chuẩn Master Spec: persons, face_profiles, face_samples, attendance, sync_queue) cùng package `@face/storage` quản lý ảnh captured và màn hình giao diện sản xuất `GuidedCaptureScreen` trong `@face/ui`.

## User Review Required

> [!IMPORTANT]
> - **SQLite Local Persistence**: Package `@face/database` sử dụng SQLite thuần (sql.js / embedded) hoạt động offline 100% không phụ thuộc database server ngoài.
> - **Separation of Binary Images & DB**: Ảnh khuôn mặt được lưu tại filesystem (`captures/{sessionId}/{stepId}-{timestamp}.jpg`), còn metadata, pose, quality scores và đường dẫn ảnh được lưu trong SQLite.
> - **Production GuidedCaptureScreen Component**: Giao diện tập hợp đầy đủ CameraPreview, FaceOverlay, StepProgress, GuidanceMessage, StabilityProgress, CountdownTimer, và DebugPanel.

## Open Questions

Không có câu hỏi mở cho Phase 4.

## Proposed Changes

### Package: `@face/database` (`packages/database`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/database/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/database/tsconfig.json)
#### [NEW] [src/schema.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/schema.ts)
- Định nghĩa DDL SQL chuẩn Master Spec Section 40 (`persons`, `face_profiles`, `face_embeddings`, `face_samples`, `attendance_sessions`, `attendance_records`, `sync_queue`, `app_settings`).
#### [NEW] [src/SQLiteStorageAdapter.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/SQLiteStorageAdapter.ts)
- Triển khai `StorageAdapter` interface của `@face/core` với sql.js / in-memory SQLite wrapper.
#### [NEW] [src/repositories/SessionRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/SessionRepository.ts)
- Lưu trữ và truy vấn thông tin `CaptureSession`, `CaptureStepResult`, và metadata.
#### [NEW] [src/__tests__/Database.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/__tests__/Database.test.ts)
- Unit test suite kiểm tra schema DDL, lưu trữ session và ghi log.
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/index.ts)

---

### Package: `@face/ui` (`packages/ui`)

#### [NEW] [src/components/screens/GuidedCaptureScreen.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/screens/GuidedCaptureScreen.tsx)
- Giao diện chụp ảnh hướng dẫn hoàn chỉnh kết hợp: `CameraPreview`, `FaceOverlay`, `StepProgress`, `GuidanceMessage`, `StabilityProgress`, `CountdownTimer`, `DebugPanel`, `CameraSelector`.

#### [NEW] [src/components/workflow/SessionReviewModal.tsx](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/components/workflow/SessionReviewModal.tsx)
- Modal xem lại danh sách ảnh đã chụp sau khi hoàn thành workflow (xem góc pose, chất lượng, chấp nhận/chụp lại).

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)
- Export `GuidedCaptureScreen` và `SessionReviewModal`.

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/database`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Test `SQLiteStorageAdapter` khởi tạo database tables và lưu trữ dữ liệu session mẫu.
