# Plan: Xuất ảnh thẻ đã duyệt theo campaign + Filter lớp/khoa

Ngày: 2026-09-17
Phạm vi: 2 yêu cầu mới, độc lập với Phase D/E (xem
`upload-identity-and-workflow-cleanup-plan-2026-09-17.md`). Chia làm
Phase F (export ảnh thẻ đã duyệt + nâng chuẩn ảnh thẻ) và Phase G (filter
lớp/khoa theo dữ liệu thật). Đã xác nhận hướng đi qua AskUserQuestion — xem
"Quyết định đã chốt" ở mỗi phần. Đây là **tài liệu trao đổi/thiết kế**,
CHƯA code — chỉ code khi user xác nhận đi tiếp, theo đúng quy ước của các
phase trước.

---

## Phase F — Xuất ảnh thẻ đã duyệt theo campaign

### F.1. Hiện trạng (đã xác minh qua đọc code)

Có 2 pipeline ảnh HOÀN TOÀN KHÁC NHAU trong hệ thống, dễ nhầm:

1. **"Ảnh thẻ" (ID photo, chân dung)** — pipeline AI xử lý ảnh
   (`services/python-ai/src/models/card_photo_pipeline.py`): crop theo
   landmark mặt, thay nền màu đơn sắc, resize theo bảng pixel cố định, xuất
   **JPEG chất lượng 95** (`services/python-ai/src/models/image_codec.py:52-56`).
   Kết quả được lưu thành 1 `photo_variants` row (`kind` = CARD_AUTO/CARD_AI/
   CARD_UPLOAD), và `subject_photo_sets.current_card_variant_id` trỏ tới
   variant được CHỌN LÀM CHÍNH. Khi `subject_photo_sets.status = 'APPROVED'`
   → đây chính là "ảnh đã được duyệt" cho sinh viên đó.
2. **"Thẻ đã in" (card layout đầy đủ)** — module `card-template`
   (`CardTemplateRenderService`), composite logo/tên/vạch/barcode + ảnh thẻ ở
   trên vào layout thẻ, xuất **PNG** (`card-template-render.service.ts:118`).
   Đây là thứ nằm trong file `.zip` "package in" hiện có
   (`GET /v1/print/batches/:id/package`,
   `PrintPackageService.buildPackage`), tên file
   `${subjectCode}-front.png`/`${subjectCode}-back.png` + `manifest.csv`
   (cột `subject_code,full_name,class_name,status`) — **scope theo 1 ĐỢT IN
   (batch), không phải theo campaign**, và **không lọc theo status** (mọi
   item trong batch đều vào manifest, ảnh bị bỏ qua nếu chưa render xong).

`CardSpec.backgroundColor` hiện chỉ nhận hex (`#RGB`/`#RRGGBB`) —
`hex_to_bgr` (`services/python-ai/src/models/background_removal.py:34-46`) —
một chuỗi dạng `rgb(246,114,32)` sẽ KHÔNG được nhận diện (bị bỏ qua, giữ nền
gốc, chỉ log warning). Quy đổi: `rgb(246,114,32)` = hex `#F67220` — hex NÀY
thì hệ thống đã hỗ trợ sẵn, không cần sửa code parser.

Bảng pixel hiện tại (`CARD_PHOTO_PIXEL_TABLE`,
`services/python-ai/src/models/card_photo_pipeline.py:24-29`):

| size | dpi | pixel hiện tại |
|---|---|---|
| 3x4 | 300 | 354×472 (= mức Minimum) |
| 3x4 | 600 | 709×945 |
| 4x6 | 300 | 472×709 (= mức Minimum) |
| 4x6 | 600 | 945×1417 |

Mặc định `backgroundColor` hiện là `'#FFFFFF'` ở **3 nơi**:
`apps/cms/src/components/CardSpecFields.tsx:15` (`DEFAULT_CARD_SPEC`),
`services/python-ai/src/api/routes/card_photo.py:17` (Pydantic field
default, dùng nếu campaign/workflow không gửi `backgroundColor`), và
`services/python-ai/src/api/routes/background.py:16` (route xoá nền riêng,
không đi qua card-photo pipeline).

### F.2. Quyết định đã chốt (AskUserQuestion)

1. **Nguồn ảnh cho export**: ảnh thẻ đơn (chân dung) từ
   `subject_photo_sets.current_card_variant_id`, KHÔNG phải PNG thẻ đã in.
2. **Vị trí tính năng**: export MỚI, riêng biệt, scope theo CAMPAIGN (không
   phải theo 1 đợt in/batch).
3. **Nền cam `#F67220`**: đặt làm chuẩn MẶC ĐỊNH MỚI cho toàn hệ thống
   (thay `'#FFFFFF'`), áp dụng từ nay về sau — KHÔNG hồi tố các ảnh đã duyệt
   trước đó (xem F.5 — điểm cần lưu ý).
4. **Độ phân giải**: nâng lên mức Recommended (600×800 cho 3x4, 600×900 cho
   4x6).

### F.3. Thiết kế — nâng chuẩn ảnh thẻ

**a) Nền mặc định** — đổi `'#FFFFFF'` → `'#F67220'` ở cả 3 nơi liệt kê ở
F.1 (`CardSpecFields.tsx`, `card_photo.py`, `background.py`). Test helper
`services/python-ai/src/tests/test_card_photo.py:44` cũng nên đổi default
theo (giữ test nhất quán với chuẩn mới), các chỗ test khác ĐANG chủ động
truyền `background_color="#FFFFFF"` để test riêng nhánh đó thì giữ nguyên
(test hành vi với input cụ thể, không phải test default).

**b) Độ phân giải** — sửa `CARD_PHOTO_PIXEL_TABLE`
(`card_photo_pipeline.py:24-29`), chỉ đổi 2 dòng ứng với dpi=300 (dpi=600
đã lớn hơn mức Recommended từ trước, giữ nguyên):
```python
CARD_PHOTO_PIXEL_TABLE: dict[Tuple[str, int], Tuple[int, int]] = {
    ("3x4", 300): (600, 800),   # trước: (354, 472) — mức Minimum
    ("3x4", 600): (709, 945),   # giữ nguyên — đã > Recommended
    ("4x6", 300): (600, 900),   # trước: (472, 709) — mức Minimum
    ("4x6", 600): (945, 1417),  # giữ nguyên — đã > Recommended
}
```
Lưu ý: hệ thống hiện KHÔNG ghi metadata DPI (EXIF density) vào file JPEG —
"dpi" trong `CardSpec` chỉ dùng để chọn bucket pixel ở bảng trên, không có
ý nghĩa vật lý nào khác. Dòng "DPI: 300 DPI nếu dùng để in" trong yêu cầu
gốc chỉ mang tính lưu ý cho người vận hành/máy in, không cần thêm code.

**c) Đối chiếu các tiêu chí còn lại trong yêu cầu gốc** (không cần sửa
code, chỉ ghi nhận):
- Format JPG, Color RGB, Aspect ratio 3:4/2:3 — **đã đúng sẵn** (pipeline
  luôn xuất JPEG RGB, và 2 size hiện có (3x4, 4x6) vốn đã đúng 2 tỉ lệ này).
- File size (50KB min / 100KB-1MB recommended / 2-5MB max) — JPEG quality
  95 ở độ phân giải mới (600×800/600×900, ảnh chân dung nền đơn sắc) nhiều
  khả năng vẫn nằm trong dải Recommended, nhưng **chưa verify bằng số đo
  thật** — cần đo lại 1 ảnh thật sau khi đổi độ phân giải (bước kiểm thử ở
  F.6), không cần đổi quality số ngay từ đầu nếu đo ra vẫn hợp lệ.
- Face requirements (chính diện, mắt nhìn camera, không bị che, không
  nghiêng đầu) — hiện là hướng dẫn/kỳ vọng chất lượng khi OPERATOR duyệt
  ảnh bằng mắt (không có kiểm tra tự động). Pipeline có xoay theo đường mắt
  (`_rotate_to_level_eyes`) nhưng không tự động TỪ CHỐI ảnh nghiêng/bị che.
  **Đề xuất**: giữ nguyên là tiêu chí thủ công (operator tự đánh giá khi
  duyệt) trong lần này — thêm kiểm tra tự động (AI chấm điểm góc mặt/che
  khuất) là một hạng mục riêng, lớn hơn, nên tách phase khác nếu cần.

### F.4. Thiết kế — export mới theo campaign

Endpoint mới (đề xuất): `GET /v1/campaigns/:id/export-approved-photos` —
đặt trong `device-management` module (cạnh `CampaignController`) hoặc
`photo-review` module (cạnh set-listing) — quyết định cụ thể lúc code dựa
theo module nào đang có quyền truy cập thuận tiện hơn tới cả
`campaign_subjects` (roster) và `subject_photo_sets`/`photo_variants`
(ảnh đã duyệt); nhiều khả năng cần đọc chéo module bằng raw SQL (đúng
convention hiện có, ví dụ `CampaignService.bulkCapturedCounts`).

Nội dung file `.zip` trả về (dùng lại `archiver`, theo đúng pattern
`PrintPackageService.buildPackage`):

1. **`danh-sach-sinh-vien.csv`** (hoặc `.xlsx`, quyết định lúc code) — TOÀN
   BỘ roster của campaign, từ `campaign_subjects` (không lọc theo đã chụp/
   duyệt hay chưa — đây là danh sách sinh viên CỦA ĐỢT, không phải danh
   sách ảnh). Cột: `subjectCode, fullName, citizenId, className, faculty,
   major, status` (status là trạng thái dòng roster — VALID/INVALID, xem
   `campaign-subject.entity.ts`).
2. **`danh-sach-anh-da-duyet.csv`** — chỉ những `subject_photo_sets` có
   `status = 'APPROVED'` của campaign này. Cột: `subjectCode, fullName,
   className, faculty, approvedAt, fileName` (fileName = `${subjectCode}.jpg`,
   khớp đúng tên file ảnh đi kèm trong zip).
3. **`{subjectCode}.jpg`** — 1 file mỗi sinh viên có set APPROVED, lấy bytes
   qua `current_card_variant_id` → `photo_variants.fsFileId` → file-storage
   (dùng lại helper tải file theo `fsFileId` đang có trong
   `PrintPackageService`).

Nút "Xuất ảnh đã duyệt" ở CMS — đặt tại `CampaignDetail.tsx` (cạnh các tab
hiện có) hoặc `ReviewListPage.tsx` khi đã chọn 1 campaign cụ thể — quyết
định cụ thể lúc code, có thể đặt cả 2 nơi cùng gọi 1 endpoint.

### F.5. Điểm cần lưu ý (không phải quyết định, chỉ ghi nhận rủi ro)

- Đổi nền mặc định KHÔNG hồi tố — ảnh đã duyệt TRƯỚC khi đổi default vẫn
  giữ nền cũ (thường là trắng) trong file export. Nếu cần đồng bộ toàn bộ
  ảnh cũ sang nền cam mới, đó là một tác vụ "xử lý lại ảnh đã duyệt"
  riêng (chạy lại AI pipeline cho từng set), lớn hơn nhiều so với phạm vi
  phase này — CHƯA làm ở đây, cần trao đổi riêng nếu user muốn.
- Ảnh của các set đã duyệt trước Phase F cũng có thể đang ở độ phân giải
  Minimum cũ (354×472/472×709) chứ không phải Recommended mới — cùng lý do
  trên (không hồi tố).

### F.6. Kiểm thử

- Python: cập nhật/thêm test cho `get_target_pixels` (giá trị mới), test
  default background mới; đo thử file size thật ở độ phân giải mới.
- API: test cho endpoint export mới (roster đầy đủ + chỉ set APPROVED có
  ảnh + đúng tên file `{subjectCode}.jpg`).
- Build api + cms + python-ai, chạy test suite hiện có (không regress).
- Live: chụp + duyệt thử 1 sinh viên sau khi đổi default, xác nhận ảnh ra
  đúng nền cam + đúng độ phân giải mới; xuất zip 1 campaign thật, mở kiểm
  tra cả 2 file danh sách + ảnh.

---

## Phase G — Filter lớp/khoa theo dữ liệu thật (Duyệt ảnh + In thẻ)

### G.1. Hiện trạng (đã xác minh qua đọc code)

`className`/`faculty` là cột text tự do (không phải catalog/enum), tồn tại
ở 3 bảng, denormalize dần từ roster gốc:
`campaign_subjects` (nguồn gốc, từ Excel import) →
`subject_photo_sets` (copy lúc tạo set) → `print_items` (copy lúc thêm vào
đợt in). Không có bảng danh mục lớp/khoa nào.

- **Duyệt ảnh** (`ListSetsQueryDto`) — backend ĐÃ hỗ trợ `className`/
  `major` (exact match), **CHƯA có `faculty`** dù entity đã có cột. CMS
  (`ReviewListPage.tsx`) **CHƯA wire filter nào trong 3 field này lên UI**
  (chỉ có campaignId/kindId/status/hasAi/hasUpload/missingCard/overdue/q).
- **In thẻ theo đợt in** (`PrintBatchDetailPage.tsx`) — backend
  (`ListPrintItemsQueryDto`) đã hỗ trợ cả `className` VÀ `faculty`, CMS đã
  wire cả 2 nhưng dạng Ô NHẬP TỰ DO (`<input>` text), không phải dropdown
  chọn từ dữ liệu thật.
- **In thẻ theo campaign** (`CampaignPrintStatusPage.tsx`) — đã có filter
  campaign (chính là mục đích màn này) + `className` (ô nhập tự do),
  **CHƯA có `faculty`**.
- Không có sẵn endpoint "lấy danh sách giá trị duy nhất" nào để dựng
  dropdown — điểm gần nhất là `GET /print/items/groups?groupBy=className|faculty`
  (chỉ dùng để hiển thị panel đếm số lượng theo lớp trong
  `PrintBatchDetailPage.tsx`, chưa dùng để populate filter).

### G.2. Thiết kế

**a) Endpoint "giá trị duy nhất" dùng chung** — đề xuất:
`GET /v1/campaigns/:id/subjects/distinct-values?field=className|faculty`
(đặt trong `device-management` module, cạnh `CampaignSubjectController`) —
query `SELECT DISTINCT field FROM campaign_subjects WHERE campaign_id = $1
AND field IS NOT NULL ORDER BY field`. Lấy từ `campaign_subjects` (roster
gốc, đầy đủ nhất) chứ không phải từ `subject_photo_sets`/`print_items` (2
bảng đó chỉ có dữ liệu của những sinh viên ĐÃ có set/đã vào đợt in — hẹp
hơn danh sách lớp/khoa thật của cả đợt). Dùng chung cho cả Duyệt ảnh và In
thẻ, luôn cần `campaignId` đã chọn trước (dropdown lớp/khoa chỉ có ý nghĩa
trong phạm vi 1 campaign).

**b) Backend — thêm `faculty` vào Duyệt ảnh**:
`apps/api/src/modules/photo-review/dto/list-sets-query.dto.ts` thêm field
`faculty` (exact match, cùng khai báo với `className`/`major` hiện có);
`PhotoReviewService.listSets` thêm điều kiện SQL tương ứng (mirror dòng
870-877 hiện có).

**c) CMS — Duyệt ảnh** (`ReviewListPage.tsx`): thêm 3 dropdown "Lớp" /
"Khoa" / "Chuyên ngành" (className/faculty/major), populate qua endpoint
(a) khi đã chọn campaign, disable/rỗng khi chưa chọn campaign.

**d) CMS — In thẻ theo campaign** (`CampaignPrintStatusPage.tsx`): đổi
`classNameFilter` từ input tự do sang dropdown (endpoint (a)); thêm mới
dropdown `facultyFilter` (backend `ListPrintItemsQueryDto` đã hỗ trợ sẵn,
chỉ cần wire UI).

**e) CMS — In thẻ theo đợt in** (`PrintBatchDetailPage.tsx`): đổi 2 ô nhập
tự do `classNameFilter`/`facultyFilter` hiện có sang dropdown (cùng
endpoint (a), dùng `campaignId` của batch đang xem).

### G.3. Kiểm thử

- Backend: test cho endpoint distinct-values (đúng giá trị, loại trùng,
  loại null, sort) + test `faculty` filter mới ở Duyệt ảnh.
- Build cms + api, chạy test suite hiện có.
- Live: 1 campaign đã import roster thật, xác nhận dropdown lớp/khoa hiện
  đúng danh sách thật (không phải danh sách cứng), filter đúng kết quả ở
  cả 3 màn.

---

## Tổng kết thay đổi DB

- **Không có migration Postgres mới** cho Phase G (chỉ thêm filter/endpoint
  đọc dữ liệu đã có).
- Phase F **không cần migration** cho phần export (chỉ đọc dữ liệu có sẵn +
  đóng gói zip); phần "nâng chuẩn ảnh thẻ" là đổi hằng số/default trong code
  Python + CMS, không đụng schema DB.
