# Kế hoạch: Trang CMS duyệt ảnh (Photo Review)

> **Trạng thái:** bản thảo để product owner duyệt — chưa code. Ngày lập:
> 2026-09-08. Là tài liệu thứ ba, đi cùng
> `campaign-config-sso-card-photo-discussion.md` (mục 3.5 ảnh thẻ, 3.6 AI
> local) và `ui-redesign-plan.md` (CMS C0–C4).
>
> Yêu cầu gốc của product owner (2026-09-08): một trang CMS **khác với CMS
> hiện tại**, chỉ hiển thị ảnh của các campaign, với 7 chức năng ở mục 1.

---

## 0. Tóm tắt

- **Trang "Duyệt ảnh"** là khu vực riêng (route `/review`, menu riêng, vai
  trò riêng `REVIEWER`) trong `apps/cms` — không trộn với trang quản trị
  campaign/thiết bị. Đơn vị làm việc là **hồ sơ ảnh** của một người trong
  một campaign (N ảnh gốc các góc + các **phiên bản** ảnh thẻ 4x6).
- **Ba nguyên tắc cứng:** (1) ảnh gốc đã chụp **không bao giờ** bị sửa
  hay xóa; (2) mọi ảnh thẻ (tự động, sửa AI, tải lên) là một **phiên bản
  mới** có số thứ tự, có người tạo, có lý do; (3) hồ sơ **bị khóa** mọi
  hành động cho tới khi ảnh thẻ 4x6 tự động (crop + nền + làm mịn) đã tạo
  xong.
- **Sửa bằng AI theo prompt** là bước *thủ công, có người duyệt, có rào
  chắn nhận dạng* — khác với pipeline tự động (Q9: chỉ làm mịn + thay nền
  deterministic). Khuyến nghị model **Qwen-Image-Edit 2511** (Apache 2.0)
  trên GPU 24 GB, chạy sau ComfyUI/Diffusers trong sidecar Python, với
  bảo vệ vùng mặt + dán lại vùng nhận dạng + kiểm tra độ giống bằng
  embedding (facenet-pytorch/AdaFace, MIT — **không** dùng weights
  InsightFace vì phi thương mại).
- **Lưu trữ:** thư mục `card/<năm>/<sessionId>/` **cùng cấp** với
  `face/<năm>/<sessionId>/` (ảnh các góc) và `video/…` trên file-server,
  cùng tenant — mở Explorer (mirror) thấy ngay cạnh nhau.
- **Mở rộng:** "loại ảnh" (`photo_kinds`) là cấu hình, không phải code;
  ảnh thẻ SV chỉ là loại đầu tiên, các loại khác dùng đúng trang và đúng
  hành động này.

---

## 1. Bảy yêu cầu → cách đáp ứng

| # | Yêu cầu | Cách đáp ứng | Mục |
|---|---|---|---|
| 1 | Chưa có ảnh 4x6 làm mịn → không thao tác được gì trên hồ sơ SV đó | Hồ sơ có trạng thái `PENDING_AUTO`/`AUTO_FAILED` → mọi nút mờ, chỉ hiện lý do và tiến độ; mở khóa khi phiên bản `CARD_AUTO` đạt `READY` | 4 |
| 2 | Xem ảnh gốc, xem ảnh 4x6 đã tạo & làm mịn | Trang chi tiết: N ảnh gốc theo góc + video (chỉ xem), ảnh thẻ hiện tại cỡ lớn, so sánh trước/sau bằng thanh trượt | 5.2 |
| 3 | Nút "Sửa lại bằng AI", nhập prompt | Modal prompt + gợi ý an toàn + chọn vùng, chạy nền trên GPU, xem trước, chỉ số giống nhau, **người duyệt bấm chấp nhận** mới thành phiên bản mới | 5.3, 6 |
| 4 | Thay bằng ảnh tải lên | Modal tải file → kiểm tra (1 mặt, độ phân giải, **đối chiếu nhận dạng với ảnh gốc**) → chạy pipeline 4x6 → phiên bản `CARD_UPLOAD` | 5.4 |
| 5 | Ảnh thay thế liên quan tới ảnh thẻ, không xóa ảnh chụp cũ | Ảnh gốc bất biến; phiên bản chỉ `DISCARDED` (ẩn), không xóa; con trỏ "ảnh thẻ hiện tại" chuyển được qua lại | 2, 4 |
| 6 | Ảnh sửa AI lưu vào folder cùng cấp với ảnh các góc | `card/<năm>/<sessionId>/<loại>-v<n>.jpg` cạnh `face/<năm>/<sessionId>/…`, kèm `.json` ghi prompt/model/độ giống | 3 |
| 7 | Sau này nhiều loại ảnh khác, hành động vẫn vậy | Bảng `photo_kinds` (tên, chuẩn ảnh, bộ kiểm tra, gợi ý prompt); trang lọc theo loại; component không đổi | 2, 5.6 |

Ngoài 7 mục, trang tên là "duyệt ảnh" nên đề xuất thêm **Duyệt / Từ chối
hồ sơ** (mục 5.5) — cần product owner xác nhận (R-Q2).

---

## 2. Mô hình dữ liệu

```
photo_kinds ──< subject_photo_sets ──< photo_variants
                       │                     │
                       └──< photo_review_events (nhật ký)
sessions ──< photos (ảnh gốc, đã có) ─── photo_variants.source_photo_id
```

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `photo_kinds` (loại ảnh) | `code` (STUDENT_CARD, STAFF_CARD, …), `label_vi`, `card_spec` mặc định (cỡ, dpi, nền, làm mịn), `quality_profile` (bộ kiểm tra), `prompt_hints[]`, `active` | Thay cho enum `campaigns.purpose`; campaign trỏ `kind_id` |
| `subject_photo_sets` (hồ sơ ảnh) | `campaign_id`, `subject_code`, `subject_name`, `kind_id`, `source_session_id` (phiên mới nhất đã duyệt), `status` (`PENDING_AUTO` → `READY` → `IN_REVIEW` → `APPROVED` / `REJECTED`; nhánh `AUTO_FAILED`), `current_card_variant_id`, `updated_at` | Một hồ sơ / người / campaign; phiên mới thay `source_session_id` và tạo lại `CARD_AUTO` (phiên cũ vẫn giữ) |
| `photo_variants` (phiên bản ảnh thẻ) | `set_id`, `version` (1, 2, 3… trong hồ sơ), `kind` (`CARD_AUTO` / `CARD_AI` / `CARD_UPLOAD`), `derived_from_variant_id`, `source_photo_id` (ảnh gốc góc ảnh thẻ), `fs_file_id`, `virtual_path`, `bytes`, `sha256`, `width/height/dpi`, `status` (`PROCESSING` / `READY` / `FAILED` / `DISCARDED`), `prompt`, `region_mode`, `model_id`, `algorithm_version`, `seed`, `identity_similarity`, `quality_report` (jsonb), `created_by_user_id`, `created_at`, `note` | Không bao giờ `DELETE`; `DISCARDED` = ẩn khỏi danh sách nhưng còn trong lịch sử |
| `photo_review_events` (nhật ký) | `set_id`, `variant_id?`, `action` (`AUTO_GENERATED`, `AUTO_FAILED`, `REPROCESS`, `AI_REQUESTED`, `AI_ACCEPTED`, `AI_DISCARDED`, `UPLOAD_REPLACED`, `SET_CURRENT`, `APPROVED`, `REJECTED`, `VIEWED_ORIGINAL`), `actor_user_id`, `payload`, `at` | Bắt buộc cho mọi hành động; hiện trong tab "Lịch sử" |

Ảnh gốc: bảng `photos` hiện có (đã có `step_type`, `camera_role`,
`fs_file_id`, `virtual_path`) — **không thêm cột, không sửa hàng**.

---

## 3. Lưu trữ trên file-server (yêu cầu 6)

Đường dẫn ảo hiện có (theo `docs/photo-upload-storage-flow.md`):

| Nguồn | Ảnh các góc | Video |
|---|---|---|
| Kiosk | `face/<năm>/<sessionId>/<stepId>-<attempt>.jpg` | `video/<năm>/<sessionId>/<streamId>.webm` |
| Web | `sessions/<sessionId>/<stepId>-<attempt>.jpg` | — |

Đề xuất thư mục **cùng cấp** cho ảnh thẻ, cả hai nguồn:

```
<tenant>/face/2026/<sessionId>/step-front-1.jpg      ← ảnh gốc (không đổi)
<tenant>/face/2026/<sessionId>/step-left-1.jpg
<tenant>/video/2026/<sessionId>/<streamId>.webm
<tenant>/card/2026/<sessionId>/auto-v1.jpg           ← pipeline tự động
<tenant>/card/2026/<sessionId>/auto-v1.json          ← tham số, phiên bản thuật toán, quality_report
<tenant>/card/2026/<sessionId>/ai-v2.jpg             ← sửa AI (đã chấp nhận)
<tenant>/card/2026/<sessionId>/ai-v2.json            ← prompt, model, seed, độ giống
<tenant>/card/2026/<sessionId>/ai-v3.discarded.jpg   ← bản AI bị hủy (nếu giữ — R-Q6)
<tenant>/card/2026/<sessionId>/upload-v4.jpg         ← ảnh tải lên đã qua pipeline 4x6
<tenant>/card/2026/<sessionId>/upload-v4.source.jpg  ← file gốc người dùng tải lên
```

- Ghi bằng `FileStorageService.clientForTenant(<tenant của phiên>)` (đã
  có, dùng cho view-link) để file nằm **đúng tenant của kiosk đã chụp**.
  Với web (đường `sessions/…`), API tạo `card/<năm>/<sessionId>/…` cùng
  tenant của API — vẫn cùng cấp.
- Thư mục mirror plaintext (`FS_MIRROR_ROOT/<tenant>/<app>/card/…`) nếu
  bật cho phép cán bộ IT mở Explorer lấy ảnh — đúng ý "lấy ra cho tiện".
- Tên file mang **loại + phiên bản**, không mang tên người (riêng tư);
  mã SV nằm trong `photo_variants` và trong `X-Metadata` không định danh.

---

## 4. Trạng thái hồ sơ và quy tắc khóa (yêu cầu 1, 5)

```
phiên chụp được xác nhận
        │  (tạo/cập nhật hồ sơ, source_session_id = phiên này)
        ▼
  PENDING_AUTO ──worker sinh CARD_AUTO──► READY ──cán bộ mở──► IN_REVIEW ──► APPROVED
        │                                   ▲                       │
        └── lỗi ──► AUTO_FAILED ──[Tạo lại]─┘                       └──► REJECTED (ghi chú)
```

- **Khóa** = `status ∈ {PENDING_AUTO, AUTO_FAILED}` hoặc
  `current_card_variant_id IS NULL`. Khi khóa: thẻ trong danh sách có
  băng "Đang tạo ảnh 4x6… (hàng đợi: 12)" hoặc "Tạo ảnh 4x6 lỗi: mặt quá
  nhỏ / nền không tách được"; trang chi tiết mở được để **xem** ảnh gốc
  nhưng mọi nút hành động mờ. Ngoại lệ duy nhất đề xuất: nút **"Tạo lại
  ảnh 4x6"** khi `AUTO_FAILED` (R-Q1 — nếu product owner muốn tuyệt đối
  không có hành động nào thì hệ thống tự thử lại 3 lần rồi báo IT).
- Khi SV được chụp lại (phiên mới): hồ sơ về `PENDING_AUTO`, phiên bản cũ
  vẫn giữ và đánh dấu "từ phiên 08/09 09:41"; ảnh thẻ hiện tại chuyển sang
  bản tự động mới **trừ khi** đã `APPROVED` → giữ bản đã duyệt, hiện cảnh
  báo "có phiên chụp mới hơn" để cán bộ tự quyết.
- Ảnh gốc của mọi phiên (kể cả phiên bị chụp lại) **không xóa** — đúng
  yêu cầu 5 và đúng quyết định "phiên cũ vẫn giữ" (Q20).

---

## 5. Giao diện

### 5.1. Danh sách hồ sơ ảnh

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Duyệt ảnh   Campaign [2026DOT01 ▾]  Loại [Ảnh thẻ SV ▾]  Trạng thái [Tất cả ▾]│
│ [ ] chỉ hồ sơ có sửa AI  [ ] chỉ ảnh tải lên  [ ] thiếu ảnh 4x6   Tìm [    ] │
│ 312 hồ sơ · 280 sẵn sàng · 20 đang tạo · 4 lỗi · 8 đã duyệt                 │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│ [4x6]    │ [4x6]    │ [🔒 đang │ [4x6]    │ [⚠ lỗi]  │ [4x6]    │ [4x6]    │
│ 2210xxxx │ 2210yyyy │  tạo…]   │ 2210wwww │ 2210vvvv │ 2210uuuu │ 2210tttt │
│ N.V.A    │ T.T.B    │ 2210zzzz │ P.T.D    │ H.V.E    │ …        │ …        │
│ ✔ Đã duyệt│ Sẵn sàng│ L.V.C    │ AI v2    │ Tạo lỗi  │ Upload v3│ Sẵn sàng │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

- Lưới thẻ (mặc định) hoặc bảng; thẻ khóa hiện ổ khóa + lý do, không có
  nút. Badge: **Sẵn sàng · Đang duyệt · Đã duyệt · Từ chối · Đang tạo ·
  Lỗi**; nhãn phụ **AI v2 / Upload v3 / Fallback** (ảnh gốc chụp thay bằng
  CENTER — từ metadata `fallback: true`).
- Chọn nhiều → hành động hàng loạt **chỉ** cho "Duyệt" và "Tạo lại ảnh
  4x6" (không cho AI/upload hàng loạt).

### 5.2. Chi tiết hồ sơ ảnh

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← Danh sách   2210xxxx · Nguyễn Văn A · CNTT-K20 · 2026DOT01     [Sẵn sàng]    │
├────────────────────┬──────────────────────────────────┬───────────────────────┤
│ ẢNH GỐC (chỉ xem)  │ ẢNH THẺ HIỆN TẠI — v2 (AI)       │ PHIÊN BẢN             │
│ [Thẳng] [Trái 30°] │ ┌──────────────────────────────┐ │ ● v2 AI · 09/09 10:12 │
│ [Phải 30°] [Trên]  │ │                              │ │   "bỏ lóa kính trái"  │
│ [Dưới] …           │ │        (ảnh 4x6 lớn)          │ │   giống 0,93 · N.T.H  │
│ 10 ảnh · 6 vòng    │ │                              │ │   [Đặt hiện tại] [Xem]│
│ Phiên 08/09 09:41  │ └──────────────────────────────┘ │ ○ v1 Tự động · 08/09  │
│ (PC-A101, Tự động) │ [◄ so sánh với gốc ►] [Tải về]    │   giống 0,98          │
│ Video: 2 (xem)     │ Kiểm tra: mặt 0,74 ✔ · mắt mở ✔  │   [Đặt hiện tại] [Xem]│
│                    │ · nền đều ✔ · độ nét ✔            │                       │
├────────────────────┴──────────────────────────────────┴───────────────────────┤
│ [Sửa bằng AI]  [Thay bằng ảnh tải lên]  [Tạo lại ảnh 4x6]     [Từ chối] [Duyệt]│
│ Lịch sử: 10:12 N.T.H chấp nhận AI v2 · 09:45 hệ thống tạo v1 · …               │
└───────────────────────────────────────────────────────────────────────────────┘
```

- Bên trái: ảnh gốc theo góc (click phóng to), video (trình phát), thông
  tin phiên; **không có nút sửa/xóa** nào ở cột này.
- Giữa: ảnh thẻ hiện tại + thanh trượt so sánh với ảnh gốc góc thẳng +
  kết quả kiểm tra chất lượng (`quality_report`, dùng lại bộ kiểm tra
  `packages/face-quality` và `docs/card-photo-quality-checks.md`).
- Phải: lịch sử phiên bản, mới nhất trên; "Đặt hiện tại" đổi con trỏ
  (ghi nhật ký), không xóa gì.
- Khi khóa: thanh nút thay bằng "🔒 Đang tạo ảnh 4x6… / Tạo lỗi: … [Tạo
  lại]".

### 5.3. Modal "Sửa bằng AI" (yêu cầu 3)

```
┌──────────────────────────────────────────────────────────────────┐
│ Sửa bằng AI — từ v2 (AI)                                          │
│ Yêu cầu: [ Bỏ lóa trên kính, giữ nguyên khuôn mặt              ] │
│ Gợi ý: (bỏ lóa kính) (gọn tóc lòa xòa) (thẳng cổ áo) (nền trắng đều)│
│        (bỏ bụi/vết trên nền) (cân sáng hai bên mặt)               │
│ Vùng được sửa: (•) Ngoài khuôn mặt  ( ) Kính  ( ) Tóc  ( ) Toàn ảnh*│
│ * Toàn ảnh: vùng mắt–mũi–miệng vẫn được dán lại từ ảnh gốc        │
│ ┌────────────┐   ┌────────────┐   Độ giống với gốc: 0,93 ✔        │
│ │  trước     │   │   sau      │   Thời gian: 12 s · Qwen-Image-Edit│
│ └────────────┘   └────────────┘   Seed: 4181                      │
│ AI không làm: đổi biểu cảm, mở mắt, bỏ hẳn kính, làm gầy mặt,     │
│ tô đẹp — các yêu cầu này bị từ chối trước khi chạy.               │
│                       [Hủy]  [Chạy lại]  [Chấp nhận → thành v3]   │
└──────────────────────────────────────────────────────────────────┘
```

- Chạy nền (job), modal hiện tiến độ; kết quả **chỉ thành phiên bản khi
  bấm Chấp nhận**. Bản chạy thử không chấp nhận: lưu `DISCARDED` (để
  audit, R-Q6) hoặc bỏ.
- Độ giống: ≥ 0,85 xanh; 0,70–0,85 vàng (cho chấp nhận kèm xác nhận);
  < 0,70 đỏ **không cho chấp nhận**. Ngưỡng cấu hình theo loại ảnh.
- Bộ lọc prompt: từ khóa cấm (cười, mở mắt, bỏ kính, gầy, trẻ, đẹp, đổi
  mắt/mũi/miệng…) → từ chối với giải thích; danh sách cấu hình trong
  `photo_kinds.prompt_hints`.

### 5.4. Modal "Thay bằng ảnh tải lên" (yêu cầu 4)

- Chọn JPG/PNG ≤ 20 MB → kiểm tra tự động: đúng 1 khuôn mặt, mặt ≥ 600 px,
  không bị cắt, **đối chiếu nhận dạng với ảnh gốc góc thẳng** (chống nhầm
  người — độ giống < 0,70 chặn, 0,70–0,85 cảnh báo "có thể không phải
  cùng người", R-Q8) → chạy đúng pipeline 4x6 (crop, nền, làm mịn nếu
  loại ảnh bật) → xem trước → "Dùng ảnh này" → `CARD_UPLOAD` v(n+1), đặt
  làm hiện tại, lưu cả file nguồn (`upload-vN.source.jpg`).
- Ảnh tải lên **không** thay ảnh gốc góc thẳng; ảnh gốc vẫn là tham chiếu
  FaceID (nguyên tắc từ tài liệu cũ).

### 5.5. Duyệt / Từ chối (đề xuất thêm)

- `APPROVED`: khóa hồ sơ khỏi sửa AI/tải lên (mở lại bằng "Mở khóa" có
  ghi chú); `REJECTED`: ghi chú lý do, hiện cho kiosk ở danh sách "đã
  chụp" (badge "Cần chụp lại") và cho CMS trang Sinh viên.
- Một vai `REVIEWER` duyệt, hay hai vai (CTSV + TT như đã nêu trong các
  buổi trước) cùng duyệt một ảnh — R-Q2. Nếu hai vai: `approvals[]` với
  hai chữ ký, `APPROVED` khi đủ hai.

### 5.6. Loại ảnh khác (yêu cầu 7)

Một loại ảnh = một hàng cấu hình: tên, chuẩn ảnh (`card_spec`), bộ kiểm
tra, gợi ý prompt, từ cấm, ngưỡng độ giống, có duyệt hai vai hay không.
Ví dụ sau này: "Ảnh thẻ cán bộ", "Ảnh hồ sơ tuyển sinh", "Ảnh thẻ thư
viện". Trang lọc theo loại; mọi màn 5.1–5.5 không đổi.

---

## 6. Sửa bằng AI theo prompt — model và rào chắn (yêu cầu 3)

### 6.1. Model chạy local (khảo sát 2026-09)

| Xếp hạng | Model | Giấy phép | VRAM | Ghi chú |
|---|---|---|---|---|
| 1 | **Qwen-Image-Edit 2511** (Alibaba) | Apache 2.0 — thương mại được | 24 GB (fp8/GGUF ~16 GB) | Giữ nhận dạng tốt nhất trong nhóm mở; có chế độ sửa theo vùng; Diffusers/ComfyUI |
| 2 | **Step1X-Edit v1.2** (StepFun) | Apache 2.0 | 24 GB | Có chế độ sửa vùng chính xác |
| 3 | **HiDream-E1.1** | MIT | 24 GB | Giấy phép sạch nhất, chậm hơn |
| — | FLUX.1 Kontext / FLUX.2 [dev] | **phi thương mại** | — | Chất lượng cao nhưng phải mua giấy phép BFL — không dùng |
| — | SDXL inpaint + ControlNet (+ IP-Adapter-FaceID) | SDXL được; **IP-Adapter-FaceID kéo theo InsightFace phi thương mại** | 8–16 GB | Phương án dự phòng nếu chỉ có GPU 16 GB: sửa theo mask, không FaceID |

Độ trễ thực tế 5–20 giây/ảnh trên RTX 4090; không hứa dưới 2 giây.
**Phần cứng khuyến nghị:** một RTX 4090 24 GB (hoặc RTX 6000 Ada / L40S
48 GB nếu muốn dư). Không có GPU 24 GB → chỉ làm 5.4 (tải lên) và hoãn
5.3, hoặc dùng SDXL inpaint 16 GB với chức năng hạn chế (R-Q4).

### 6.2. Rào chắn nhận dạng — bắt buộc, không phụ thuộc model

1. **Mask trước khi sửa:** tách mặt (MediaPipe/SAM) → mặc định chỉ sửa
   **ngoài** mặt; vùng "Kính"/"Tóc" là mask con; "Toàn ảnh" vẫn bảo vệ
   vùng mắt–mũi–miệng.
2. **Dán lại vùng nhận dạng:** sau khi model trả ảnh, dán lại vùng
   mắt–mũi–miệng từ ảnh gốc bằng `cv2.seamlessClone` — model **không thể**
   đổi nhận dạng dù prompt có nói gì.
3. **Kiểm tra độ giống:** embedding trước/sau bằng facenet-pytorch hoặc
   AdaFace (MIT); dưới ngưỡng → không cho chấp nhận.
4. **Bộ lọc prompt** (5.3) chặn yêu cầu đổi biểu cảm/hình học.
5. **Con người chấp nhận:** không bao giờ tự đặt bản AI làm ảnh hiện tại.
6. **Truy vết:** prompt, model, seed, độ giống, người bấm — trong
   `photo_variants` và file `.json` cạnh ảnh.

### 6.3. Những gì AI không được hứa

Đổi biểu cảm, mở mắt đang nhắm, bỏ hẳn kính, gầy mặt/trẻ hóa/"làm đẹp",
vẽ lại mống mắt sau lóa che đồng tử, ranh giới sửa vô hình khi zoom
pixel. Các yêu cầu này bị từ chối ở bộ lọc prompt; nếu cần thì **chụp
lại**.

### 6.4. Tích hợp

- Sidecar `services/python-ai` thêm `POST /edit` (ảnh + prompt + vùng →
  ảnh + độ giống + seed), gọi ComfyUI HTTP API (`/prompt`, `/history`)
  hoặc Diffusers trực tiếp; `POST /identity-similarity`; `POST /card-photo`
  (đã có trong kế hoạch 3.6.2) dùng chung cho tải lên.
- `apps/api`: hàng đợi job (theo mẫu `UploadWorkerService` cron +
  `FOR UPDATE SKIP LOCKED` đã có) → `photo_variants.status`; tối đa 1–2
  job AI đồng thời trên một GPU.

---

## 7. API

| Endpoint | Vai trò | Mô tả |
|---|---|---|
| `GET /v1/review/sets?campaignId&kindId&status&hasAi&hasUpload&missingCard&q&page` | REVIEWER | Danh sách hồ sơ + ảnh thẻ hiện tại (view-link ngắn hạn) |
| `GET /v1/review/sets/:id` | REVIEWER | Hồ sơ + ảnh gốc + video + phiên bản + nhật ký |
| `POST /v1/review/sets/:id/reprocess` | REVIEWER/ADMIN | Tạo lại `CARD_AUTO` (R-Q1) |
| `POST /v1/review/sets/:id/ai-edit` `{prompt, region, fromVariantId}` | REVIEWER | Tạo job; 422 nếu prompt vi phạm |
| `GET /v1/review/jobs/:id` | REVIEWER | Tiến độ, kết quả tạm (view-link) |
| `POST /v1/review/variants/:id/accept` / `discard` | REVIEWER | Chấp nhận thành phiên bản / hủy |
| `POST /v1/review/sets/:id/upload` (multipart) | REVIEWER | Kiểm tra + pipeline + phiên bản `CARD_UPLOAD` |
| `POST /v1/review/sets/:id/current` `{variantId}` | REVIEWER | Đổi ảnh thẻ hiện tại |
| `POST /v1/review/sets/:id/approve` / `reject` `{note}` | REVIEWER (hoặc hai vai) | Duyệt / từ chối |
| `GET /v1/review/sets/:id/events` | REVIEWER | Nhật ký |
| `GET/POST/PATCH /v1/photo-kinds` | ADMIN | Loại ảnh |
| `GET /v1/review/export?campaignId&status=APPROVED` | ADMIN | Gói ảnh đã duyệt (zip theo mã SV) — cho in thẻ (R-Q9) |

Guard: `SsoAuthGuard` (đã sửa để gắn `req.user`) + `ReviewerRoleGuard`
mới (role từ SSO hoặc `users.roles[]`).

---

## 8. Quyền, riêng tư, nhật ký

- `REVIEWER` xem/sửa/duyệt; `ADMIN` thêm cấu hình loại ảnh, xuất gói.
- Mọi view-link ảnh gốc ngắn hạn (đã có cơ chế); tải về ảnh gốc ghi
  `VIEWED_ORIGINAL` vào nhật ký.
- Không hiện tên người trong tên file trên file-server.
- Ảnh gốc là dữ liệu sinh trắc: trang này không cho xóa; xóa theo chính
  sách lưu trữ là việc của quy trình riêng (ngoài phạm vi).

---

## 9. Thứ tự làm và ước lượng

| Bước | Nội dung | Phụ thuộc | Ước lượng |
|---|---|---|---|
| R1 | `photo_kinds`, `subject_photo_sets`, `photo_variants`, `photo_review_events` + migration; hook từ "phiên xác nhận" → tạo hồ sơ; worker `CARD_AUTO` ghi vào `card/<năm>/<sessionId>/` | Pipeline ảnh thẻ (giai đoạn 4 của tài liệu thảo luận) | 3 ngày |
| R2 | Trang danh sách + chi tiết + khóa + phiên bản + nhật ký; `ReviewerRoleGuard` | R1, `SsoAuthGuard` gắn `req.user` | 5 ngày |
| R3 | Thay bằng ảnh tải lên + đối chiếu nhận dạng + pipeline 4x6 | R1, sidecar `/card-photo`, `/identity-similarity` | 3 ngày |
| R4 | Sửa bằng AI: sidecar `/edit`, hàng đợi job, modal, rào chắn, bộ lọc prompt | GPU 24 GB, R2 | 7–8 ngày + 2 ngày đánh giá model trên ảnh thật |
| R5 | Duyệt/Từ chối (một hoặc hai vai), phản hồi về kiosk/Sinh viên, xuất gói | R2 | 2–3 ngày |
| R6 | Loại ảnh thứ hai để chứng minh mở rộng (cấu hình, không code) | R1–R5 | 1 ngày |

Tổng ~21–23 ngày công, chưa tính mua GPU. R3 và R5 có thể làm trước R4
nếu GPU chưa có. Không commit cho tới khi test tay từng bước được xác
nhận (quy tắc dự án).

---

## 10. Câu hỏi cần chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| R-Q1 | Khi tạo ảnh 4x6 tự động **lỗi**, có cho nút "Tạo lại" (một hành động) dù hồ sơ đang khóa không? | Có, chỉ nút đó; hoặc hệ thống tự thử 3 lần |
| R-Q2 | Duyệt **một vai** (REVIEWER) hay **hai vai** (CTSV + TT) cùng duyệt? | Bắt đầu một vai; mô hình `approvals[]` để bật hai vai sau |
| R-Q3 | Ai được sửa AI / tải lên: mọi REVIEWER hay chỉ ADMIN? | REVIEWER |
| R-Q4 | Có GPU ≥ 24 GB cho AI sửa ảnh không? | Nếu không: làm R3/R5 trước, R4 sau khi có GPU |
| R-Q5 | Prompt tự do hay chỉ chọn từ gợi ý? | Tự do + bộ lọc từ cấm + gợi ý |
| R-Q6 | Bản AI **bị hủy** có lưu để audit không? | Lưu `DISCARDED`, dọn sau 30 ngày |
| R-Q7 | Trang này nằm trong `apps/cms` (route `/review`) hay app riêng? | Route riêng trong `apps/cms`, menu và vai trò riêng |
| R-Q8 | Ảnh tải lên có **bắt buộc** đối chiếu nhận dạng với ảnh gốc không? | Bắt buộc; < 0,70 chặn, 0,70–0,85 cảnh báo |
| R-Q9 | Xuất gói ảnh đã duyệt để in thẻ (bàn giao IT) có thuộc trang này không? | Có, nút "Xuất gói" cho ADMIN, zip theo mã SV + CSV |
| R-Q10 | Hồ sơ đã **APPROVED** rồi SV chụp lại: tự chuyển ảnh hiện tại sang bản mới hay giữ bản đã duyệt? | Giữ bản đã duyệt + cảnh báo, cán bộ tự quyết |
