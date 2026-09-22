# gphoto2 Windows binaries — chỗ đặt file

Xem `docs/plans/canon-tethered-capture-plan-2026-09-21.md` (Bước 0, Bước 6).

Thư mục này **cố ý rỗng trong git** — file nhị phân thật sự (.exe/.dll) do
người triển khai tự tải về theo Bước 0 của plan, không commit vào repo
(binary lớn, tải từ MSYS2, không phải mã nguồn Looka).

## Cần đặt gì vào đây

Sau khi hoàn thành Bước 0 (cài + kiểm tra gphoto2 tay trên kiosk thật),
sao chép các file sau từ bản cài MSYS2 (`mingw-w64-x86_64-gphoto2` +
`mingw-w64-x86_64-libgphoto2`) vào thẳng thư mục này (không tạo thư mục
con):

- `gphoto2.exe`
- Toàn bộ `.dll` mà `gphoto2.exe` cần lúc chạy (dùng `ldd gphoto2.exe`
  trong MSYS2 shell, hoặc Dependency Walker/`dumpbin /dependents` trên
  Windows thường, để liệt kê chính xác — số lượng DLL phụ thuộc bản
  MSYS2/MinGW cụ thể, không cố định).
- Thư mục `iolibs/`/`camlibs/` của libgphoto2 nếu bản build của bạn nạp
  camera driver theo kiểu plugin động (kiểm tra bằng cách chạy thử
  `gphoto2.exe --auto-detect` từ đúng thư mục này trước khi coi là xong).

Sau khi đặt file xong, `apps/desktop/electron-builder.json`'s
`extraResources` đã trỏ sẵn vào thư mục này — `pnpm package:win`/
`package:win:dir` sẽ tự đóng gói theo, không cần sửa gì thêm.

**Chạy `pnpm dev` (chưa đóng gói) cũng tự nhận file đặt ở đây luôn** —
`tetheredCamera.ts`'s `gphoto2BinaryPath()` kiểm tra đúng thư mục này
trước khi rơi về `gphoto2` trên PATH, nên KHÔNG cần set biến môi trường
`GPHOTO2_BIN` hay sửa PATH hệ thống chỉ để test tay ở Bước 0 — đặt file
vào đây một lần là dùng được cho cả dev lẫn bản đóng gói thật.

## Driver WinUSB — xem `resources/zadig-win/README.md`

**KHÔNG dùng `wdi-simple.exe` nữa** — đã thử build từ mã nguồn, bị Windows
Memory Integrity từ chối vì không có chứng chỉ ký số thật (chi tiết trong
`zadig-win/README.md`). Bản Zadig chính thức, có chữ ký hợp lệ, đóng gói
riêng ở `apps/desktop/resources/zadig-win/`.
