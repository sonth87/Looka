# Implementation Plan — Phase 8: Attendance & Business Logic

Xây dựng package quản lý nghiệp vụ điểm danh tự động Kiosk `@face/attendance-engine` (`packages/attendance-engine`) kết hợp bổ sung `AttendanceRepository` trong `@face/database` để xử lý nhận diện real-time, chống điểm danh trùng (Cooldown Window / Anti-passback), lưu lịch sử điểm danh và đẩy dữ liệu vào `sync_queue` offline-first.

## User Review Required

> [!IMPORTANT]
> - **Anti-Duplicate Cooldown Window**: Khi một nhân sự đã điểm danh thành công (`RECORDED`), trong khoảng thời gian Cooldown (mặc định 5 phút / 300,000ms), nếu nhân sự đó đứng trước Kiosk thêm lần nữa, hệ thống sẽ trả về trạng thái `ALREADY_RECORDED` để tránh tạo dữ liệu trùng lặp.
> - **Offline-First Sync Queue Integration**: Tất cả các bản ghi điểm danh `attendance_records` được ghi trực tiếp vào SQLite local đồng thời tự động đẩy payload vào bảng `sync_queue` để sẵn sàng đồng bộ lên cloud khi có Internet.

## Open Questions

Không có câu hỏi mở cho Phase 8.

## Proposed Changes

### Package: `@face/database` (`packages/database`)

#### [NEW] [src/repositories/AttendanceRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/AttendanceRepository.ts)
- Lưu trữ bản ghi điểm danh `attendance_records`, kiểm tra lịch sử điểm danh gần nhất của nhân sự `getLastAttendance(personId)`, và ghi log vào `sync_queue`.

#### [MODIFY] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/index.ts)
- Export `AttendanceRepository`.

---

### Package: `@face/attendance-engine` (`packages/attendance-engine`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/tsconfig.json)

#### [NEW] [src/AttendanceService.ts](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/src/AttendanceService.ts)
- Tiếp nhận kết quả từ `IdentificationEngine`, kiểm tra điều kiện Cooldown Anti-duplicate window, ghi nhận điểm danh `RECORDED` / `ALREADY_RECORDED` / `REJECTED`, và phát tín hiệu sự kiện real-time.

#### [NEW] [src/__tests__/Attendance.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/src/__tests__/Attendance.test.ts)
- Unit test suite kiểm thử quy trình điểm danh thành công, quy trình chặn điểm danh trùng trong cửa sổ cooldown, và ghi dữ liệu đồng bộ vào sync_queue.

#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/src/index.ts)

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/attendance-engine`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Kiểm tra `AttendanceService` nhận dạng nhân sự A lần 1 trả về `RECORDED`, và nhận dạng nhân sự A lần 2 ngay sau 10 giây trả về `ALREADY_RECORDED`.
