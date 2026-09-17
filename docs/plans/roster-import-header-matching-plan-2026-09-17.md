# Plan: Đọc file roster import theo TÊN cột thay vì THỨ TỰ cột

Ngày: 2026-09-17
Phạm vi: sửa `CampaignSubjectService.parseWorkbook()` (roster Excel import,
`apps/api/src/modules/device-management/services/campaign-subject.service.ts`).
Tài liệu trao đổi — chưa code, chỉ code khi user xác nhận đi tiếp.

## 1. Vấn đề thực tế (đã xác minh)

User gửi 1 file thật (SharePoint, "14.09.26 - Copy.xlsx") — cột thực tế:

```
STT | MSSV | HỌ VÀ TÊN SINH VIÊN | Năm sinh | Lớp | KHOA | Niên khoá
```

Hệ thống hiện tại (`ROSTER_COLUMNS`, dòng 52-65 file trên) định nghĩa đúng 8
cột theo THỨ TỰ CỨNG:

```
1. Mã SV  2. Họ tên  3. CCCD  4. Lớp  5. Khoa  6. Ngành  7. Ngày sinh  8. Thời hạn thẻ
```

`parseWorkbook()` (dòng 754-818) đọc dữ liệu **HOÀN TOÀN theo vị trí cột**
(`get(1)`, `get(2)`, …, `excelRow.getCell(7)`, …) — **không hề đọc tên ở
dòng header** để xác nhận cột nào là cột nào (dòng 768-775 chỉ dùng header
để tìm cột "extra" NGOÀI 8 cột đã biết, không dùng để map 8 cột đó).

Hệ quả: nếu import file thật ở trên ngay bây giờ, dữ liệu sẽ **lắp sai cột
hoàn toàn** từ cột 3 trở đi — vì file có thêm cột STT ở đầu, thiếu CCCD/Ngành,
và thứ tự Ngày sinh/Lớp/Khoa khác hẳn:

| Vị trí cột | Hệ thống hiểu là | File thật thực ra là |
|---|---|---|
| 3 | CCCD | Năm sinh |
| 4 | Lớp | Lớp *(trùng vị trí — may mắn đúng)* |
| 5 | Khoa | Khoa *(trùng vị trí — may mắn đúng)* |
| 6 | Ngành | Niên khoá |
| 7 | Ngày sinh | *(không có cột 7)* |
| 8 | Thời hạn thẻ | *(không có cột 8)* |

→ CCCD sẽ nhận nhầm giá trị ngày sinh, Ngành sẽ nhận nhầm "Niên khoá", và
2 cột cuối rỗng — **không có lỗi/cảnh báo nào hiển thị**, import "thành
công" với dữ liệu sai.

## 2. Quyết định đã chốt (AskUserQuestion)

1. Đổi cách đọc: theo **TÊN cột** (có danh sách alias cho mỗi field), không
   theo thứ tự — file mẫu tải từ CMS (`buildTemplate()`) giữ nguyên, chỉ
   phần đọc file upload trở nên linh hoạt hơn.
2. Phạm vi: chỉ cần xử lý tốt file này + thiết kế dễ thêm alias sau (khi
   gặp file của khoa/phòng ban khác, chỉ cần thêm chuỗi vào danh sách, không
   sửa logic).
3. Thiếu cột bắt buộc (không khớp được "Mã SV" hoặc "Họ tên"): từ chối cả
   file ngay từ đầu, báo lỗi rõ — không fallback về đọc theo vị trí.

## 3. Thiết kế

### 3.1. Chuẩn hoá tên cột để so khớp

Header text được chuẩn hoá trước khi so khớp: bỏ phần trong dấu ngoặc (ví
dụ "(yyyy-mm-dd)"), bỏ dấu tiếng Việt, hạ chữ thường, gộp khoảng trắng, trim.
Ví dụ "Ngày sinh (yyyy-mm-dd)" và "NGÀY SINH" và "ngay sinh" đều chuẩn hoá
về cùng 1 khoá so khớp.

### 3.2. Bảng alias (điểm mở rộng chính — thêm khoa/phòng ban mới chỉ cần thêm chuỗi vào đây)

```ts
const HEADER_ALIASES: Record<keyof ParsedRowFields, string[]> = {
  subjectCode: ['Mã SV', 'MSSV', 'Mã số SV', 'Mã số sinh viên'],
  fullName: ['Họ tên', 'Họ và tên', 'Họ và tên sinh viên'],
  citizenId: ['CCCD', 'Số CCCD', 'CMND/CCCD', 'Số CMND', 'CMND'],
  className: ['Lớp'],
  faculty: ['Khoa'],
  major: ['Ngành', 'Chuyên ngành'],
  // "Năm sinh" trong file thật chứa NGÀY sinh đầy đủ (ví dụ 04/12/2005),
  // không phải chỉ năm — coi là alias hợp lệ của dateOfBirth.
  dateOfBirth: ['Ngày sinh', 'Năm sinh'],
  // "Niên khoá" trong file thật chứa giá trị dạng ngày (30-06-2028), khớp
  // ngữ nghĩa với "thời hạn thẻ" hơn là "khoá học" (thường ghi dạng
  // "K18"/"2018-2022") — map vào cardValidUntil, nhưng đây là suy luận
  // theo DỮ LIỆU THẬT quan sát được, không phải quy ước chính thức đã xác
  // nhận với khoa liên quan; nếu một file khác dùng "Niên khoá" với nghĩa
  // "khoá học" thật, cần tách alias này ra riêng khi gặp.
  cardValidUntil: ['Thời hạn thẻ', 'Hạn thẻ', 'Niên khoá'],
};

// Cột không mang dữ liệu (số thứ tự) — nhận diện và BỎ QUA, không rơi vào
// "extra" (extra chỉ dành cho cột lạ CÓ THỂ hữu ích, STT thì không).
const IGNORED_HEADERS = ['STT', 'Số TT', 'TT', 'No', 'No.'];
```

### 3.3. Thay đổi `parseWorkbook()`

1. Đọc dòng header (row 1), với MỖI cell: chuẩn hoá text (3.1), so khớp với
   `HEADER_ALIASES` (mỗi field khớp được 1 cột, cột đầu tiên khớp thắng nếu
   trùng — log warning nếu có khớp trùng) → xây `columnByField: Partial<Record<FieldKey, number>>`.
   Cell khớp `IGNORED_HEADERS` → bỏ qua hẳn. Cell không khớp gì cả → như cũ,
   vào `extraHeaders`.
2. Kiểm tra bắt buộc: nếu `columnByField.subjectCode` hoặc `columnByField.fullName`
   không tìm được → `throw BadRequestException` NGAY, TRƯỚC khi đọc bất kỳ
   dòng dữ liệu nào — message liệt kê rõ tên cột bắt buộc không tìm thấy và
   gợi ý các alias đã thử, ví dụ: `Không tìm thấy cột "Mã SV" (hoặc tương
   đương: MSSV, Mã số SV, Mã số sinh viên) trong file.`
3. Vòng lặp đọc từng dòng: thay `get(1)`/`get(2)`/… bằng
   `get(columnByField.subjectCode)`/`get(columnByField.fullName)`/…, dùng
   `undefined` (cột không có trong file này) như đang xử lý optional field
   hiện tại — field không map được cột nào thì cứ để `null`, không lỗi
   (đúng hành vi optional hiện có, ví dụ file không có CCCD/Ngành như file
   mẫu vừa xem).
4. `buildTemplate()` — GIỮ NGUYÊN, vẫn xuất đúng 8 cột theo tên chuẩn hiện
   tại (không đổi trải nghiệm CMS→Excel mẫu).

### 3.4. Không đổi

- Cấu trúc DB (`campaign_subjects`), DTO, response shape, error-report format
  (`buildErrorReport`) — không đổi gì.
- `extra` jsonb — vẫn hoạt động như cũ cho cột lạ không khớp alias nào và
  không phải cột bị bỏ qua (STT).

## 4. Kiểm thử

- Unit test mới cho `parseWorkbook()`:
  - File đúng cấu trúc `ROSTER_COLUMNS` hiện tại (regression — không đổi
    hành vi cho file đã hoạt động đúng từ trước).
  - File thật dạng đã xem (STT, MSSV, HỌ VÀ TÊN SINH VIÊN, Năm sinh, Lớp,
    KHOA, Niên khoá) — xác nhận map đúng field, STT bị bỏ qua, không có
    CCCD/Ngành (đúng, vì file không có) vẫn import được các field khác.
  - File thiếu cột "Mã SV"/tương đương — xác nhận từ chối cả file, đúng
    message.
  - File có cột lạ không khớp alias nào — vẫn rơi vào `extra` như cũ.
- Build + test suite api hiện có.
- Live: import thử chính file SharePoint đã xem (tải xuống thủ công, hoặc
  operator tự tải rồi import) vào 1 campaign dev, xác nhận map đúng từng
  field.
