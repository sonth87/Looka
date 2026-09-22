# Zadig — WinUSB driver installer, bundled

Xem `docs/plans/canon-tethered-capture-plan-2026-09-21.md` (mục driver
WinUSB).

## Vì sao đóng gói Zadig thay vì tự động hoá bằng `wdi-simple.exe`

Đã thử build `wdi-simple.exe` (CLI có `--silent`) từ mã nguồn
[pbatard/libwdi](https://github.com/pbatard/libwdi) qua MSYS2/MinGW —
build thành công, nhưng driver package nó tạo ra bị Windows từ chối trên
máy có bật **Memory Integrity (Core Isolation/HVCI)**: lỗi thật gặp phải
`0xE000022F "Driver package does not contain a catalog file, and Code
Integrity is enforced"`. Nguyên nhân: bản tự build không có chứng chỉ ký
số thật (không có `--with-wdkdir`/cert thật để nhúng), nên `.cat` tự ký bị
từ chối bất kể có chạy quyền Admin hay không.

Bản **Zadig chính thức** (`zadig-2.9.exe`, tải từ GitHub release, xác nhận
chữ ký Authenticode hợp lệ của "Akeo Consulting" — tác giả thật của cả
Zadig lẫn libwdi) **không bị chặn** — cài driver thành công thật trên máy
đã bật Memory Integrity. Đây là lý do file trong thư mục này là Zadig, không
phải `wdi-simple.exe`.

**Đánh đổi phải chấp nhận**: Zadig **không có tham số dòng lệnh** (đã kiểm
tra `zadig.c` — không có `getopt`/parse argv nào), nên không silent hoá
được — người dùng vẫn phải tự mở, chọn đúng camera trong danh sách
(**Options → List All Devices** trước, vì máy ảnh không nằm trong danh
sách mặc định), chọn WinUSB, bấm Install/Replace Driver, và xác nhận UAC.
Đóng gói file này vào app chỉ giải quyết được "không cần tự đi tải Zadig ở
đâu đó" — KHÔNG giải quyết được "hoàn toàn không cần thao tác tay". Muốn
silent hoá thật thì cần mua chứng chỉ ký số thật (EV code-signing) cho bản
build riêng, một quyết định/chi phí ngoài phạm vi code.

**Máy ảnh Canon EOS lộ RA 2 interface USB riêng** (ví dụ R6 Mark II:
`Canon Digital Camera (Interface 0)` = MI_00, interface PTP thật gphoto2
cần; `iAP Interface (Interface 1)` = MI_01, giao diện riêng của Canon,
KHÔNG dùng) — phải cài WinUSB cho **cả 2** interface, không chỉ 1.

## Cách dùng

`CameraSetupScreen.tsx`'s bảng "MÁY ẢNH CANON QUA DÂY (GPHOTO2)" có nút mở
thẳng file này (`shell.openPath`) khi "Kiểm tra kết nối" báo chưa nhận được
máy — không cần tìm file thủ công trong thư mục cài đặt.

Chạy `pnpm dev`/`pnpm package:win:dir` cũng tự nhận file đặt ở đây, giống
hệt cách `gphoto2-win/`'s README mô tả cho `gphoto2.exe`.
