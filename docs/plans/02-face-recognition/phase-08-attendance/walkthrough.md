# Phase 8: Attendance & Business Logic — Walkthrough

Đã hoàn thành xây dựng package nghiệp vụ điểm danh tự động Kiosk `@face/attendance-engine` (`packages/attendance-engine`) kết hợp bổ sung `AttendanceRepository` trong `@face/database`, tích hợp cơ chế chống điểm danh trùng (Anti-passback Cooldown Window) và đẩy dữ liệu đồng bộ vào `sync_queue` local-first.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Bổ sung Repository trong `@face/database` (`packages/database`)
- [AttendanceRepository.ts](file:///Users/skyline/PROJECTS/face-capture/packages/database/src/repositories/AttendanceRepository.ts):
  - `recordAttendance`: Lưu bản ghi điểm danh `attendance_records` và tự động sinh bản ghi trong `sync_queue`.
  - `getLastAttendance`: Truy vấn mốc thời gian điểm danh gần nhất của nhân sự để kiểm tra điều kiện chống lặp.
  - Export `AttendanceRepository` trong `packages/database/src/index.ts`.

### 2. Package `@face/attendance-engine` (`packages/attendance-engine`)
- [AttendanceService.ts](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/src/AttendanceService.ts):
  - Tiếp nhận kết quả từ `IdentificationEngine`.
  - Xử lý cửa sổ Cooldown Anti-duplicate (mặc định 5 phút / 300,000ms): Nếu nhân sự vừa điểm danh trong cửa sổ Cooldown, trả về trạng thái `ALREADY_RECORDED`.
  - Phát các sự kiện real-time `recorded`, `already-recorded`, `rejected`.
- [Attendance.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/attendance-engine/src/__tests__/Attendance.test.ts):
  - Unit test suite kiểm tra quy trình điểm danh thành công lần 1, chặn trùng lặp lần 2 trong cửa sổ cooldown, và ghi nhận thành công lần 3 sau khi hết cooldown.
- Export trong `packages/attendance-engine/src/index.ts`.

---

## Kết Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 10 successful, 10 total` (tất cả 12 workspace packages compile 100% không lỗi).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 26, fail 0` (toàn bộ 26 unit tests thuộc tất cả các package đều passed).
