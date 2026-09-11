# Kế hoạch API cho 8 màn CMS — đối chiếu với API hiện có

> Ngày: 2026-09-11 · Trạng thái: **bản thảo để trao đổi, chưa code** · D-Q1–4, 6, 8, 10, 12, 14, 15 đã chốt cùng ngày (§6) · bổ sung §1.1 (dễ mở rộng) và §2.9 (bảng thống kê riêng, action + cron)
> Phạm vi: `Looka/apps/api` (NestJS + Postgres) và sidecar `services/python-ai`.
> Nguồn đối chiếu: 15 controller / 63 route / 17 bảng hiện có; các quyết định đã chốt ngày 2026-09-08 trong
> `campaign-config-sso-card-photo-discussion.md`, `cms-photo-review-plan.md`, `ui-redesign-plan.md`;
> BRD `BRD_QuyTrinh_LamAnhThe_SV_V1.docx`; tài liệu gốc `docs/KE-HOACH-DU-AN.md`, `docs/nguyen-ly-loi-va-da-nghiep-vu.html`.

---

## 0. Tóm tắt điều hành

| # | Màn | Đã có | Có một phần | Chưa có | Mức độ việc |
|---|---|---|---|---|---|
| 1 | Dashboard | 3 route thống kê (`stats/summary`, `stats/timeseries`, `campaigns/:id/stats`) | theo cá nhân, theo kiosk | chờ duyệt, đã in, quá hạn, thời gian chụp, kiosk + người gán, địa điểm | Trung bình |
| 2 | Cấu hình nghiệp vụ | `capture-configurations` (5 route), `capture-angle-presets` (3), `photo-kinds` (3) | góc chụp, card spec | thực thể nghiệp vụ có mã/version/trạng thái, phương thức định danh, điều kiện tiếp nhận, import Excel, catalog bước AI, chế độ in | **Lớn** |
| 3 | Quản lý đợt chụp | CRUD campaign (8), duyệt thành viên (3), stats | danh sách chưa phân trang, chưa gate admin | liên kết nghiệp vụ, SLA giờ, import tài khoản, gán người ↔ kiosk, thống kê tự động/tay | Trung bình |
| 4 | Duyệt ảnh AI | 13 route review đầy đủ (list, detail, reprocess, ai-edit, upload, accept, approve/reject, export) | tìm kiếm (thiếu lớp/ngành/CCCD), làm mịn chưa nối | thống kê duyệt/không duyệt/dùng AI | Nhỏ |
| 5 | Quản lý đợt in thẻ | `GET /v1/review/export` (zip + csv) | — | toàn bộ: đợt in, item in, trạng thái in, gom nhóm lớp/khoa, gán phôi hàng loạt | **Lớn** |
| 6 | Quản lý phôi in | — | — | toàn bộ: phôi, layout mặt trước/sau, biến dữ liệu, logo, preview, đếm lượt dùng | **Lớn** |
| 7 | Quản lý máy in | — | — | toàn bộ: máy in, chế độ in, gắn kiosk, tồn phôi, heartbeat agent | Trung bình |
| 8 | Người dùng & phân quyền | bảng `users`, `GET /v1/me`, 2 guard (`AdminRoleGuard`, `ReviewerRoleGuard`) | `users.roles` là mảng chuỗi, không có API quản lý | CRUD user, roles, permissions, gán nhiều-nhiều, catalog quyền theo endpoint, đồng bộ từ service hệ thống | **Lớn** |

**Ba điểm đảo ngược quyết định ngày 2026-09-08 — đã chốt lại ngày 2026-09-11** (chi tiết ở §6 D-Q2/D-Q3/D-Q4):

1. **Chế độ bấm chụp** (bấm liên tục / chụp 1 lần / tự động AI) nay được yêu cầu nằm trong *nghiệp vụ*, trong khi Q11 đã chốt đây là *cài đặt kiosk*. → **Chốt:** nghiệp vụ đặt mặc định + danh sách cho phép, kiosk chọn trong đó.
2. **Import danh sách tài khoản vào đợt** — bảng `campaign_student_roster` đã bị **xóa** ngày 2026-09-08 (migration `1804000000000`) để chuyển roster về phía desktop (`apps/desktop/src/main/cccdRoster.ts`). Màn 2/3 cần roster ở server. → **Chốt:** tạo lại roster ở server (`campaign_subjects`), kiosk tra cứu qua API có cache offline.
3. **Gán 1 người ↔ 1 kiosk** — tab "Cán bộ chụp" đã bị **gỡ** ngày 2026-09-08 với lý do "không cần phân công". Màn 1/3 yêu cầu lại. → **Chốt:** cần gán; gán đồng thời tự duyệt thành viên (APPROVED).

**Hai nguyên tắc bổ sung (user nêu 2026-09-11)**: (1) mọi chức năng phải thiết kế để **dễ mở rộng về sau** — §1.1 liệt kê các điểm mở rộng; (2) **thống kê có bảng riêng**, cập nhật **theo action** (tăng dần khi có sự kiện) và **cron** (đối soát/tính lại) — §2.9. Dashboard và mọi endpoint stats đọc từ các bảng này, không tính trực tiếp trên `sessions`/`photos`.

Ước lượng backend tổng: **30–38 ngày công** (§5), chưa gồm CMS UI, kiosk và print agent. Các cải thiện ngoài 8 màn ở §8 (I-Q1 và I-Q5 đã chốt, I-Q13 bỏ qua, I-Q2 đang trao đổi).

---

## 1. Quy ước dùng trong tài liệu

- Mọi route đều có prefix `/v1` (URI versioning, không có global prefix — `apps/api/src/main.ts`). Response bọc `{ statusCode, message, data }`; danh sách phân trang là `data: { items, meta }`.
- Ký hiệu: ✅ có sẵn, dùng được ngay · 🟡 có một phần, cần sửa/mở rộng · ❌ chưa có, phải xây mới · ⚠️ vấn đề cần lưu ý.
- Guard hiện có: `SsoAuthGuard` (SSO trường, gắn `req.user`), `AdminRoleGuard` (`users.is_admin`), `ReviewerRoleGuard` (`is_admin` hoặc `roles` chứa `REVIEWER`), `CampaignMemberGuard`, `DeviceCredentialsGuard` (kiosk), `ApiKeyMiddleware` (kiosk web).
- Tên bảng/cột mới viết snake_case theo `SnakeNamingStrategy` hiện dùng.

### 1.1 Nguyên tắc thiết kế để dễ mở rộng

Yêu cầu của user: "các chức năng cần thiết kế sau dễ extend". Áp dụng xuyên suốt bằng 8 quy tắc, mỗi quy tắc chỉ rõ chỗ dùng:

| # | Quy tắc | Áp dụng ở đâu |
|---|---|---|
| E1 | **Catalog trong DB thay vì enum cứng trong code.** Thêm giá trị = thêm dòng, không cần migration/deploy. | Góc chụp (`capture_angle_presets`, đã có) · loại ảnh (`photo_kinds`, đã có) · **bước AI** (`ai_pipeline_steps`, mới) · **phương thức định danh** (`identification_methods`, mới — thay cho CHECK enum) · **biến dữ liệu phôi** (`card_template_fields`, mới, seed từ code) |
| E2 | **Adapter/registry cho mọi tích hợp ngoài.** Một interface, nhiều implementation đăng ký theo `code`; config chỉ lưu `code` + params. | `EligibilityApiClient` (đầu tiên: `DAINAM_STUDENT_INFO`) · `UserDirectoryClient` (D-Q10: viết sẵn hàm gọi, URL qua env, spec cung cấp sau) · `PrintChannel` (`CENTRALIZED_PACKAGE` trước, `AGENT_QUEUE` sau — D-Q8) · `AiSidecarStep` theo `ai_pipeline_steps.sidecar_endpoint` · `StatsCollector` (§2.9) |
| E3 | **Config nghiệp vụ là JSON có `schemaVersion`, validate bằng JSON Schema.** Thêm nhóm tham số mới = tăng `schemaVersion`, version cũ vẫn đọc được (default cho field thiếu). | `workflow_versions.config` |
| E4 | **Quyền theo permission, không theo role cứng.** Thêm bước nghiệp vụ mới = thêm 1 decorator, catalog tự sinh, gán vào role trong CMS. | Vòng duyệt 2 sau này (D-Q14) chỉ là permission `review:approve-round2` + 1 status · mọi route mới |
| E5 | **Trạng thái là `varchar` + CHECK constraint** (convention hiện có), không dùng Postgres enum type. Thêm giá trị = migration đổi CHECK, không lock bảng lâu. | `workflows.status`, `print_items.status`, `printers.status`, … |
| E6 | **Cột `extra jsonb`** cho trường phát sinh chưa biết trước, kèm `metadata` đã có ở `sessions`. | `campaign_subjects.extra`, `print_items.extra`, `users.extra`, `printers.connection` |
| E7 | **Mọi hành động nghiệp vụ ghi bảng sự kiện append-only** (`device_events`, `photo_review_events` đã có; `print_item_events`, `printer_stock_events`, `eligibility_check_logs` mới). Thống kê hoặc hook mới thêm sau vẫn tính lại được từ lịch sử. | §2.9 cron recompute đọc từ các bảng này |
| E8 | **Version bất biến cho cấu hình được tham chiếu lâu dài.** Sửa = tạo version mới; bản ghi cũ giữ nguyên tham chiếu. | `workflow_versions` (D-Q1), `card_templates.version` |

---

## 2. Đối chiếu từng màn

### 2.1 Màn 1 — Dashboard

**Yêu cầu**
- (a) Số ảnh chụp theo ngày *theo cá nhân*, số ảnh chờ CTSV duyệt, số ảnh đã in, ảnh quá hạn xử lý.
- (b) Danh sách đợt đang hoạt động: tên, địa điểm, tổng, chụp được, đã xử lý, đã chụp, chờ duyệt, lỗi chụp, chưa chụp.
- (c) Chi tiết đợt: kiosk đang setup cho đợt, danh sách chụp từng kiosk, người được gán.
- (d) Thời gian chụp từng kiosk, tính từ quét thẻ → chụp xong + gửi lời chào.

**Hiện có** (`apps/api/src/modules/device-management/controllers/campaign.controller.ts`, tính toán trong `services/device-event.service.ts`)

| Endpoint | Trả về | Trạng thái |
|---|---|---|
| `GET /v1/campaigns/stats/summary` | tổng toàn hệ thống + từng campaign: `sessions`, `photos{total,ready,pending,failed}`, `byDevice[]`, `byOperator[]` (**luôn rỗng** ở bản summary) | 🟡 |
| `GET /v1/campaigns/stats/timeseries?days=` | theo ngày: `sessionsCompleted, uploadsSuccess, uploadsFailed, retakes` (từ `device_events`) | 🟡 không lọc theo người |
| `GET /v1/campaigns/:id/stats` | `byDevice[]`, `byOperator[]` (theo `sessions.operator_user_id`), `byDay[]` 30 ngày | ✅ cho (c) một phần |
| `GET /v1/sessions?campaignId&deviceId&from&to&state` | danh sách phiên theo kiosk | ✅ cho "danh sách chụp từng kiosk" |

**Thiếu**

| Nhu cầu | Vì sao chưa làm được | Đề xuất |
|---|---|---|
| Số ảnh chụp theo ngày theo cá nhân | `sessions.operator_user_id` đã có (migration `1796000000000`) nhưng không có endpoint tổng hợp xuyên campaign, không có lọc `operatorUserId`/`from`/`to` | ❌ `GET /v1/dashboard/kpis?from&to&operatorUserId&campaignId` → `{ captured: { total, byDay[] }, pendingReview, printed, overdue }`. Mặc định `operatorUserId` = người đang đăng nhập nếu không truyền. |
| Ảnh chờ CTSV duyệt | `subject_photo_sets.status` có `READY`/`IN_REVIEW` nhưng không có endpoint đếm | ❌ `GET /v1/review/stats?campaignId&from&to` (xem §2.4) và gộp vào `dashboard/kpis` |
| Ảnh đã in | Chưa có khái niệm in (§2.5) | ❌ phụ thuộc `print_items.status = PRINTED` |
| Ảnh quá hạn xử lý | Không có SLA, không có deadline (`campaign-stats.dao.ts` ghi rõ chưa có mốc thời gian) | ❌ thêm `campaigns.processing_sla_hours` (§2.3) và `subject_photo_sets.due_at` = `sessions.completed_at + sla_hours`, ghi lúc tạo set để index được; `overdue = now > due_at AND status NOT IN (APPROVED, REJECTED)` |
| Địa điểm đợt | `campaigns` không có cột địa điểm | ❌ thêm `campaigns.location` (varchar) — hoặc bảng `sites` nếu muốn thống kê theo cơ sở (BA #19). Xem câu hỏi D-Q7. |
| Bộ đếm đợt: tổng / chụp được / đã xử lý / đã chụp / chờ duyệt / lỗi chụp / chưa chụp | Có `quota_planned`, `sessions COMPLETED`, `photos.failed`; **không có** "chưa chụp" vì không có danh sách sinh viên kỳ vọng ở server | 🟡 `GET /v1/dashboard/campaigns/active` → mỗi đợt: `quota` (= `quota_planned` hoặc số dòng roster hợp lệ), `captured` (COUNT DISTINCT `subject_code` phiên COMPLETED), `processed` (set APPROVED), `sessions` (phiên COMPLETED), `pendingReview` (set READY/IN_REVIEW), `captureErrors` (phiên có ảnh `failed` hoặc set `AUTO_FAILED`), `notCaptured` (= roster − captured; NULL nếu không có roster) |
| Kiosk của đợt + người được gán | `devices.campaign_id` có (nullable sau self-enroll); **không có** bảng gán người ↔ kiosk (bị gỡ 2026-09-08) | ❌ `campaign_kiosk_assignments` (§2.3) + `GET /v1/campaigns/:id/kiosks` → kiosk, trạng thái, người gán, số phiên, thời gian trung bình |
| Thời gian chụp từng kiosk (quét thẻ → gửi lời chào) | Chỉ có `sessions.captured_at` (bắt đầu) và `completed_at`; **không có** mốc quét thẻ và mốc kết thúc lời chào; `SESSION_STARTED`/`SESSION_COMPLETED` trong `device_events` có `occurred_at` nhưng chưa ai tính hiệu | ❌ thêm `sessions.identified_at`, `sessions.finished_at`; kiosk gửi kèm trong `SESSION_REPORT`; `GET /v1/campaigns/:id/stats/timing?groupBy=device` → `avg/p50/p95` giây, số phiên đo được |

**Nguồn dữ liệu**: toàn bộ số liệu màn 1 đọc từ **bảng thống kê riêng** (§2.9: `stats_daily_captures`, `stats_campaign_snapshot`, `stats_daily_review`, `stats_daily_print`), được cập nhật theo action và đối soát bằng cron. Endpoint dashboard vì thế là truy vấn nhẹ, không join `photos`.

**API đề xuất cho màn 1**

```
GET  /v1/dashboard/kpis?from&to&operatorUserId&campaignId        ❌ mới
GET  /v1/dashboard/campaigns/active                               ❌ mới (đợt effectiveStatus = OPEN)
GET  /v1/campaigns/:id/kiosks                                     ❌ mới
GET  /v1/campaigns/:id/stats/timing?groupBy=device|operator|day   ❌ mới
GET  /v1/campaigns/:id/stats                                      ✅ giữ, bổ sung byTrigger (§2.3)
GET  /v1/sessions?campaignId&deviceId                             ✅ giữ
GET  /v1/campaigns/stats/summary                                  🟡 điền byOperator, thêm from/to
```

**DB**: `campaigns.location`, `campaigns.processing_sla_hours`, `sessions.identified_at`, `sessions.finished_at`, `subject_photo_sets.due_at` (+ index `(status, due_at)`); các bảng `stats_*` ở §2.9.

**Kiosk**: `SESSION_REPORT` thêm `identifiedAt`, `finishedAt`, `identificationMethod` (§2.2), `operatorUserId` đã có.

---

### 2.2 Màn 2 — Cấu hình nghiệp vụ

**Yêu cầu**
- Danh sách nghiệp vụ: xem/sửa/xóa; trạng thái Nháp / Lưu trữ / Hoạt động.
- Tạo nghiệp vụ gồm: thông tin chung (tên, mã, version, mô tả) · cấu hình camera (chọn góc đã cấu hình, sửa được; chế độ bấm chụp: bấm liên tục theo số cam hoặc số ảnh/cam, chụp 1 lần toàn bộ, tự động AI) · phương thức định danh (QR CCCD, RFID, NFC, Barcode, FaceID, tra cứu tay — multi, có thống kê) · điều kiện tiếp nhận (trang riêng: cấu hình điều kiện, upload Excel hoặc dựa API nào/field nào; danh sách import xem được lỗi) · xử lý AI đầu ra (có/không, mục nào; có trang quản lý các bước AI) · in trực tiếp hay tập trung.

**Hiện có**

| Thành phần | Ở đâu | Trạng thái |
|---|---|---|
| Mẫu chụp dùng lại: `name, description, capture_angles jsonb, card_spec jsonb` | `capture_configurations` — `GET/POST/PATCH/DELETE /v1/capture-configurations` (admin) | 🟡 không có `code`, `version`, `status`; là bản copy-một-lần, campaign **không** tham chiếu tới nó lúc runtime (`capture-configuration.entity.ts` dòng 8–27) |
| Catalog góc chụp | `capture_angle_presets` — `GET/POST/PATCH /v1/capture-angle-presets` | ✅ (xóa = `active:false`) |
| Loại ảnh + card spec + prompt hints | `photo_kinds` — `GET/POST/PATCH /v1/photo-kinds` | ✅ |
| Chế độ bấm chụp | `campaigns.capture_mode/auto_hold_ms/simultaneous_capture` **đã deprecated**, chuyển sang kiosk (Q11) | 🟡 D-Q2 đã chốt: nghiệp vụ đặt `default` + `allowed[]`, kiosk chọn trong đó |
| Phương thức định danh | Không có cột/enum nào; CCCD chỉ là `sessions.metadata.identityNumber` | ❌ |
| Điều kiện tiếp nhận / Excel / API | Không có; `campaign_student_roster` đã xóa; `DainamStudentInfoClient` (`modules/shared/services/dainam-student-info.client.ts`) tồn tại nhưng **chưa nối vào đâu** | ❌ |
| Bước xử lý AI | Sidecar có `/card-photo`, `/background`, `/retouch`, `/edit` (501), `/identity-similarity`; API mới gọi 3/9 route; không có catalog bước | 🟡 |
| Chế độ in | Không có | ❌ |

**Quyết định kiến trúc đề xuất: tách thực thể `workflows` (nghiệp vụ) có version bất biến, campaign tham chiếu đến version.**

Lý do: (1) yêu cầu có `code/version/status` và "sửa" một nghiệp vụ đang dùng không được làm đổi đợt đang chạy — đúng tinh thần snapshot đã chốt cho góc chụp (Q22); (2) `docs/KE-HOACH-DU-AN.md` §11.5 đã có tiền lệ `Workflow` + `WorkflowVersion` bất biến; (3) `docs/nguyen-ly-loi-va-da-nghiep-vu.html` §06 định nghĩa đúng 6 nhóm tham số cần có. `capture_configurations` sẽ được **thay thế** (migrate dữ liệu sang version 1 của workflow tương ứng rồi bỏ bảng), tránh tồn tại 2 khái niệm "mẫu".

```
workflows
  id, code (unique, vd STUDENT_CARD), name, description,
  status DRAFT | ACTIVE | ARCHIVED, current_version_id, created_by_user_id
workflow_versions
  id, workflow_id, version int, config jsonb, published_at, published_by_user_id, note
  unique (workflow_id, version) — KHÔNG BAO GIỜ UPDATE sau khi publish
```

Vòng đời: tạo → `DRAFT` (sửa tự do trên version nháp) → `publish` → `ACTIVE` (version đóng băng) → sửa tiếp = tạo version nháp mới, publish sẽ tăng `version` và trỏ `current_version_id` → `archive` → `ARCHIVED` (campaign mới không chọn được, campaign cũ vẫn chạy). Xóa cứng chỉ khi `DRAFT` và chưa campaign nào trỏ tới.

**Cấu trúc `config` jsonb** (6 nhóm, khớp yêu cầu màn 2):

```jsonc
{
  "capture": {
    "angles": [ /* CaptureStep[] snapshot từ capture_angle_presets, giống campaigns.capture_angles hiện nay */ ],
    "clickMode": {                      // D-Q2 (chốt 2026-09-11): nghiệp vụ đặt mặc định + danh sách cho phép, kiosk chọn trong "allowed"
      "default": "MANUAL_SEQUENTIAL",
      "allowed": ["MANUAL_SEQUENTIAL", "MANUAL_ALL_AT_ONCE", "AUTO_AI"]
    },
    "shotsPerCamera": 1,                // dùng khi MANUAL_SEQUENTIAL
    "cardSourceAngleCode": "FRONT"
  },
  "identification": {
    "methods": ["QR_CCCD", "RFID", "NFC", "BARCODE", "FACE_ID", "MANUAL_LOOKUP"],   // multi
    "lookupKeyField": "citizenId" | "studentCode"
  },
  "eligibility": {
    "mode": "NONE" | "ROSTER" | "EXTERNAL_API" | "ROSTER_AND_API",
    "api": { "clientCode": "DAINAM_STUDENT_INFO", "keyField": "student_code", "requiredFields": ["status"] },
    "rules": [ { "key": "da_dong_phi", "expr": "fee_paid == true", "message": "Sinh viên chưa đóng phí ảnh thẻ" } ],
    "rosterTemplate": "STUDENT_V1"     // cột Excel bắt buộc, xem bên dưới
  },
  "aiProcessing": {
    "enabled": true,
    "steps": [ { "code": "CARD_CROP", "params": {} }, { "code": "BACKGROUND_REPLACE", "params": { "color": "#FFFFFF" } }, { "code": "SKIN_SMOOTH", "params": { "strength": "LIGHT" } } ]
  },
  "output": { "photoKindCode": "STUDENT_CARD", "cardSpec": { /* như hiện nay */ } },
  "printing": { "mode": "DIRECT" | "CENTRALIZED" }
}
```

Rule engine cho `eligibility.rules`: dùng `json-logic-js` hoặc `expr-eval` (không `eval`), đúng khuyến nghị `KE-HOACH-DU-AN.md` §20; mỗi lần đánh giá ghi một dòng `eligibility_check_logs` (session_id, rule_key, passed, message, evaluated_at) để dashboard đếm "lỗi tiếp nhận".

**Catalog bước AI** ("thêm 1 mục quản lý các mục quy trình của AI"):

```
ai_pipeline_steps
  id, code (unique), name_vi, description, sidecar_endpoint (/card-photo | /background | /retouch | /edit),
  params_schema jsonb, default_params jsonb, active, sort_order, is_system
```
Seed 4 bước từ sidecar hiện có. Workflow chỉ chọn `code` + `params`, nên đổi/thêm model không đụng nghiệp vụ.

**Import Excel và điều kiện tiếp nhận** — roster nằm ở **cấp đợt** (màn 3 "số tài khoản được import"), nhưng *khuôn* (cột bắt buộc, cách map) nằm ở nghiệp vụ. Vì vậy:

```
campaign_subject_imports
  id, campaign_id, file_name, fs_file_id, uploaded_by_user_id, status PROCESSING|DONE|FAILED,
  total_rows, valid_rows, error_rows, error_report_fs_file_id, created_at
campaign_subjects
  id, campaign_id, import_id, row_no, subject_code, full_name, citizen_id, class_name, faculty, major,
  date_of_birth, card_valid_until, status VALID|ERROR|DUPLICATE, error_message, extra jsonb
  unique (campaign_id, subject_code) where status = 'VALID'
```
⚠️ Đây chính là bảng `campaign_student_roster` đã bị xóa ngày 2026-09-08 (cột cũ: `student_code, student_name, citizen_id, class_name, major, academic_year`), thêm `faculty`, `date_of_birth`, `card_valid_until` vì phôi in cần (BRD dòng 25). D-Q3 **đã chốt 2026-09-11**: tạo lại ở server; kiosk chuyển sang tra cứu qua API và cache offline, bỏ `response.json`.

**API đề xuất cho màn 2**

```
# Nghiệp vụ
GET    /v1/workflows?status&q&page&limit                 ❌ mới, phân trang
POST   /v1/workflows                                      ❌ mới (tạo DRAFT + version 1 nháp)
GET    /v1/workflows/:id                                  ❌ mới (kèm current version config)
PATCH  /v1/workflows/:id                                  ❌ mới (tên/mô tả; config chỉ khi version đang DRAFT)
POST   /v1/workflows/:id/publish                          ❌ mới (DRAFT→ACTIVE, đóng băng version)
POST   /v1/workflows/:id/versions                         ❌ mới (tạo version nháp mới từ current)
GET    /v1/workflows/:id/versions                         ❌ mới
POST   /v1/workflows/:id/archive                          ❌ mới
DELETE /v1/workflows/:id                                  ❌ mới (chỉ DRAFT, chưa dùng)
GET    /v1/workflows/:id/usage                            ❌ mới (campaign nào đang dùng, version nào)
POST   /v1/workflows/validate                             ❌ mới (validate config theo JSON schema, dry-run rule)

# Catalog dùng chung
GET/POST/PATCH /v1/capture-angle-presets                  ✅ giữ nguyên
GET/POST/PATCH /v1/photo-kinds                            ✅ giữ nguyên
GET/POST/PATCH /v1/ai-pipeline-steps                      ❌ mới
GET    /v1/eligibility/api-clients                        ❌ mới (liệt kê client ngoài + field trả về, để CMS chọn "dựa vào field nào")
POST   /v1/eligibility/test-lookup {clientCode, key}      ❌ mới (thử tra cứu 1 mã để xem field)

# Thống kê phương thức định danh
GET    /v1/campaigns/:id/stats/identification             ❌ mới → { byMethod: { QR_CCCD: n, ... } }
GET    /v1/stats/identification?from&to                   ❌ mới (toàn hệ thống)

# Bỏ đi sau khi migrate
GET/POST/PATCH/DELETE /v1/capture-configurations          🟡 giữ tạm, xóa sau khi CMS chuyển sang workflows
```

**DB**: `workflows`, `workflow_versions`, `ai_pipeline_steps`, `eligibility_check_logs`, `campaign_subject_imports`, `campaign_subjects`; catalog `identification_methods` (`code, name_vi, description, requires_hardware, active, sort_order`, seed 6 dòng — E1) + `sessions.identification_method` (varchar 30, tham chiếu `code`); kiosk gửi `identificationMethod` trong `SESSION_REPORT`.

---

### 2.3 Màn 3 — Quản lý đợt chụp

**Yêu cầu**
- Danh sách: tên, mã, quy trình, thời gian diễn ra – kết thúc, số lượng thực hiện, tiến độ, trạng thái; thao tác xem/sửa/đổi trạng thái.
- Tạo/sửa: tên, quy trình nghiệp vụ, thời gian, số tài khoản import để xử lý ở kiosk, thời gian cam kết xử lý ảnh (giờ).
- Gán người cho từng đợt {1 người ↔ 1 kiosk}; thống kê chụp tự động / chụp tay.

**Hiện có** (`campaign.controller.ts`, `campaign-member.controller.ts`)

| Endpoint | Trạng thái | Ghi chú |
|---|---|---|
| `GET /v1/campaigns` | 🟡 | trả **mảng thường**, không phân trang, không lọc |
| `POST /v1/campaigns`, `PATCH /v1/campaigns/:id`, `DELETE /v1/campaigns/:id` | 🟡 | ⚠️ chỉ `SsoAuthGuard` — **bất kỳ ai đăng nhập cũng xóa được campaign**; phải gate theo quyền (§2.8) |
| `GET /v1/campaigns/:id` | ✅ | có `effectiveStatus` (UPCOMING/OPEN/EXPIRED/PAUSED/CLOSED), `quotaReached`, `requiredCameraCount` |
| Đổi trạng thái | ✅ | `PATCH { manualStatus: PAUSED | CLOSED | null }` |
| `code, cohort, starts_at, expires_at, quota_planned, card_spec, capture_angles, record_video*` | ✅ | migration `1793000000000` |
| Duyệt thành viên `POST .../join`, `GET/PATCH .../members` | ✅ | approval theo đợt, không phải gán kiosk |
| `sessions.operator_user_id`, `photos.trigger_source`, `photos.capture_mode` | ✅ cột | ❌ **chưa có endpoint nào tổng hợp** `trigger_source` |

**Thiếu**

| Nhu cầu | Đề xuất |
|---|---|
| Liên kết nghiệp vụ | `campaigns.workflow_id`, `campaigns.workflow_version_id` (bắt buộc với campaign mới). Kiosk `GET /v1/devices/config` và `GET /v1/campaigns/:id/config` trả `campaign + workflowVersion.config` gộp; `campaigns.capture_angles/card_spec` giữ làm **override tùy chọn** rồi deprecate. |
| Thời gian cam kết xử lý ảnh | `campaigns.processing_sla_hours` int nullable |
| Số tài khoản import | `campaign_subject_imports` / `campaign_subjects` (§2.2) — 4 route import bên dưới; `quota_planned` mặc định = số dòng VALID nếu người dùng không nhập |
| Danh sách có phân trang, lọc, tiến độ | `GET /v1/campaigns?page&limit&status&workflowId&from&to&q` → thêm `workflowName`, `progress { captured, approved, quota, percent }` vào DAO |
| Gán 1 người ↔ 1 kiosk | `campaign_kiosk_assignments (campaign_id, device_id, user_id, assigned_by_user_id, assigned_at, note)`; unique `(campaign_id, device_id)` **và** unique `(campaign_id, user_id)` để đảm bảo 1–1. Khi gán: tự tạo/duyệt `campaign_members` (APPROVED) để kiosk qua `CampaignMemberGuard` mà không phải duyệt tay 2 lần. D-Q4 **đã chốt 2026-09-11** (đảo ngược "không cần phân công" của 2026-09-08). |
| Thống kê tự động / tay | Bổ sung `byTrigger { AUTO, GESTURE, SHUTTER, EXTERNAL }` và `byCaptureMode` vào `GET /v1/campaigns/:id/stats` và `stats/summary` (kế hoạch phase 5 cũ, cột đã có, DAO chưa làm). CMS hiển thị 2 ô "Tự động / Thủ công" theo Q15. |

**API đề xuất cho màn 3**

```
GET    /v1/campaigns?page&limit&status&workflowId&from&to&q     🟡 sửa: phân trang + lọc + progress
POST   /v1/campaigns                                            🟡 sửa: thêm workflowId, processingSlaHours, location
PATCH  /v1/campaigns/:id                                        🟡 sửa: như trên; khóa đổi workflow khi đã có phiên
GET    /v1/campaigns/:id                                        ✅
DELETE /v1/campaigns/:id                                        🟡 gate quyền campaign:delete
POST   /v1/campaigns/:id/status {manualStatus}                  🟡 tùy chọn tách riêng cho rõ; hiện dùng PATCH

# Import tài khoản
POST   /v1/campaigns/:id/subjects/imports (multipart xlsx)      ❌ mới, xử lý nền, trả import id
GET    /v1/campaigns/:id/subjects/imports                       ❌ mới
GET    /v1/campaigns/:id/subjects/imports/:importId             ❌ mới (tổng/hợp lệ/lỗi + link file lỗi)
GET    /v1/campaigns/:id/subjects?status&q&page                 ❌ mới (xem từng dòng, lọc ERROR để biết lỗi ở đâu)
GET    /v1/campaigns/subjects/import-template?workflowId        ❌ mới (tải file Excel mẫu theo rosterTemplate)
DELETE /v1/campaigns/:id/subjects/imports/:importId             ❌ mới (chỉ khi chưa phiên nào khớp)

# Gán người ↔ kiosk
GET    /v1/campaigns/:id/assignments                            ❌ mới
PUT    /v1/campaigns/:id/assignments/:deviceId {userId}         ❌ mới (idempotent, thay người)
DELETE /v1/campaigns/:id/assignments/:deviceId                  ❌ mới
GET    /v1/devices?campaignId&status&q&page                     ❌ mới (hiện chỉ có list theo campaign, không phân trang)

# Thống kê
GET    /v1/campaigns/:id/stats                                  🟡 thêm byTrigger, byCaptureMode, timing
```

**Kiosk**: tra cứu sinh viên tại kiosk chuyển sang `GET /v1/campaigns/:id/subjects/lookup?key=` (đọc `campaign_subjects` + tùy chọn gọi API ngoài theo `eligibility`), thay cho roster local `response.json`. Kiosk vẫn cache offline như hiện nay.

---

### 2.4 Màn 4 — Duyệt ảnh AI

**Yêu cầu**
- Danh sách ảnh đã chụp và được AI làm mịn; tìm theo tên, lớp, chuyên ngành, CCCD, mã SV; thống kê duyệt / không duyệt / dùng AI.
- Sửa ảnh: xem ảnh gốc và ảnh AI, chọn ảnh, viết prompt gửi AI; upload ảnh từ máy thay thế; xem trước các ảnh AI sửa rồi chọn để thay.

**Hiện có** — đây là màn đầy đủ nhất (`photo-review/controllers/review.controller.ts`, guard `ReviewerRoleGuard`)

| Nhu cầu | Endpoint | Trạng thái |
|---|---|---|
| Danh sách + lọc | `GET /v1/review/sets?campaignId&kindId&status&hasAi&hasUpload&missingCard&q&page&limit` | ✅ |
| Xem gốc + các phiên bản | `GET /v1/review/sets/:id` (originals, video, variants, events) | ✅ |
| Tạo lại ảnh 4x6 tự động | `POST /v1/review/sets/:id/reprocess` | ✅ |
| Prompt gửi AI | `POST /v1/review/sets/:id/ai-edit {prompt, region, fromVariantId}` + `GET /v1/review/jobs/:id` | ✅ API · ⚠️ sidecar `/edit` trả **501**, chưa có model (R-Q4 GPU) |
| Xem trước rồi chọn | `POST /v1/review/variants/:id/accept`, `/discard`, `POST /v1/review/sets/:id/current` | ✅ |
| Upload thay thế | `POST /v1/review/sets/:id/upload` (multipart, kiểm tra identity ≥ 0.70/0.85) | ✅ |
| Duyệt / không duyệt | `POST /v1/review/sets/:id/approve`, `/reject` | ✅ |
| Nhật ký | `GET /v1/review/sets/:id/events` | ✅ |
| Xuất gói in | `GET /v1/review/export?campaignId&status` (zip + manifest.csv, admin) | ✅ |

**Thiếu / cần sửa**

| Nhu cầu | Vấn đề | Đề xuất |
|---|---|---|
| Tìm theo lớp / chuyên ngành / CCCD | `subject_photo_sets` chỉ có `subject_code`, `subject_name`; lớp/ngành/CCCD nằm trong `sessions.metadata` jsonb | 🟡 denormalize khi tạo set: thêm `class_name`, `major`, `faculty`, `citizen_id` vào `subject_photo_sets` (lấy từ `sessions.metadata` hoặc `campaign_subjects`); thêm query `className`, `major`, `citizenId`, `subjectCode` tách bạch thay vì chỉ `q` |
| "AI làm mịn" mặc định | Variant `CARD_AUTO` hiện gọi `/card-photo` (crop + nền); sidecar `/retouch` **không được API gọi** | 🟡 chạy pipeline theo `workflow.aiProcessing.steps` (§2.2) thay vì hard-code; nối `/retouch` |
| Nhiều ứng viên AI để chọn | Mỗi `ai-edit` sinh 1 variant | 🟡 thêm `candidates: 1..4` (seed khác nhau) → N variant PROCESSING, chọn 1 accept, còn lại discard |
| Thống kê duyệt / không duyệt / dùng AI | Không có endpoint đếm | ❌ `GET /v1/review/stats?campaignId&from&to&reviewerUserId` → `{ byStatus{...}, approved, rejected, aiEdited (set có variant CARD_AI được accept), uploaded, autoOnly, byReviewer[], avgReviewHours }` |
| Quá hạn | xem §2.1 `due_at` | ❌ thêm lọc `overdue=true` vào `GET /v1/review/sets` |

**API đề xuất cho màn 4**

```
GET  /v1/review/sets?...&className&major&citizenId&subjectCode&overdue   🟡 mở rộng lọc
GET  /v1/review/stats?campaignId&from&to&reviewerUserId                  ❌ mới
POST /v1/review/sets/:id/ai-edit {prompt, region, fromVariantId, candidates}  🟡 thêm candidates
(các route còn lại)                                                       ✅ giữ nguyên
```

---

### 2.5 Màn 5 — Quản lý đợt in thẻ

**Yêu cầu**: danh sách ảnh đã chụp với ảnh thẻ (gen hoặc sửa), thông tin người, trạng thái in, lớp/khoa (gom nhóm); thao tác xem/sửa/đổi trạng thái; thiết kế phôi cho 1 người rồi áp cho nhiều người.

**Hiện có**: ❌ không có gì ngoài `GET /v1/review/export` (zip ảnh APPROVED + csv để bàn giao IT). Không có bảng, cột hay route nào về in. Tài liệu gốc cũng chưa thiết kế (BA `print_packages` chỉ là gói theo từng ảnh, `template_id` là varchar rời).

**Thiết kế đề xuất**

```
print_batches
  id, code, name, campaign_id (nullable), default_template_id, printer_id (nullable),
  mode DIRECT|CENTRALIZED, status DRAFT|READY|PRINTING|DONE|CANCELLED,
  created_by_user_id, item_count, printed_count, failed_count, sent_at, done_at
print_items
  id, batch_id (nullable — item có thể tồn tại trước khi vào đợt), set_id → subject_photo_sets,
  variant_id → photo_variants (ảnh thẻ dùng để in, chốt tại thời điểm render),
  subject_code, full_name, class_name, faculty, extra jsonb (dob, card_valid_until, barcode...),
  template_id (override từng người), rendered_front_fs_file_id, rendered_back_fs_file_id, rendered_at,
  status PENDING|RENDERED|QUEUED|PRINTING|PRINTED|FAILED|REPRINT_REQUESTED|CANCELLED,
  printer_id, printed_at, error_message, reprint_of_item_id
  unique (set_id) where status not in (CANCELLED, FAILED)   — 1 người 1 thẻ đang hiệu lực
print_item_events
  id, item_id, from_status, to_status, source SYSTEM|PRINT_AGENT|MANUAL, actor_user_id, message, at
```

Nguồn dữ liệu người: `subject_photo_sets` (đã denormalize §2.4) ưu tiên; thiếu thì tra `campaign_subjects`; thiếu nữa thì để trống và đánh dấu `missingFields[]` để CMS sửa tay (`PATCH /v1/print/items/:id`).

Trạng thái `PRINTED` chỉ được đặt bởi **print agent** (callback) hoặc thao tác thủ công có ghi `source = MANUAL` — đúng quyết định BA #14 ("đã in" = xác nhận in vật lý).

**API đề xuất cho màn 5**

```
# Item (danh sách chính của màn)
GET    /v1/print/items?campaignId&batchId&status&className&faculty&q&page&limit    ❌ mới
GET    /v1/print/items/groups?campaignId&groupBy=className|faculty                ❌ mới (đếm theo nhóm để "gom nhóm")
GET    /v1/print/items/:id                                                        ❌ mới (kèm ảnh thẻ, preview render)
PATCH  /v1/print/items/:id {templateId?, extra?, status?}                         ❌ mới
POST   /v1/print/items/:id/render                                                 ❌ mới (render lại mặt trước/sau)
GET    /v1/print/items/:id/preview?side=front|back                                ❌ mới (PNG, link ký)
POST   /v1/print/items/:id/reprint                                                ❌ mới
POST   /v1/print/items/bulk {setIds | filter}                                     ❌ mới (tạo item từ set APPROVED)
POST   /v1/print/items/bulk-template {itemIds | filter, templateId}               ❌ mới ("thiết kế 1 người rồi áp nhiều người")

# Đợt in
GET    /v1/print/batches?status&campaignId&page                                   ❌ mới
POST   /v1/print/batches {name, campaignId, defaultTemplateId, printerId, mode}   ❌ mới
GET    /v1/print/batches/:id                                                      ❌ mới
PATCH  /v1/print/batches/:id                                                      ❌ mới
POST   /v1/print/batches/:id/items {itemIds}                                      ❌ mới
DELETE /v1/print/batches/:id/items/:itemId                                        ❌ mới
POST   /v1/print/batches/:id/render                                               ❌ mới (render toàn bộ, job nền)
POST   /v1/print/batches/:id/send                                                 ❌ mới (DIRECT → xếp hàng cho agent; CENTRALIZED → gói zip/PDF)
GET    /v1/print/batches/:id/package                                              ❌ mới (tải gói in tập trung; thay dần review/export)
POST   /v1/print/batches/:id/cancel                                               ❌ mới

# Print agent (kiosk/PC có máy in) — auth bằng device credentials hoặc printer token
GET    /v1/print/queue?printerId                                                  ❌ mới (agent poll)
POST   /v1/print/items/:id/status {status, message}                               ❌ mới (callback PRINTING/PRINTED/FAILED)
```

⚠️ **In trực tiếp (DIRECT) cần một print agent chạy trên máy có máy in** (Electron kiosk hoặc PC IT): poll hàng đợi, đẩy ảnh render vào spooler Windows, báo trạng thái. Đây là scope mới ngoài API (D-Q8).

---

### 2.6 Màn 6 — Quản lý phôi in

**Yêu cầu**: danh sách phôi (trạng thái, tên, số lượt dùng); trang tạo phôi: màu sắc, biến dữ liệu, tọa độ/kích cỡ, mặt trước/sau, logo; thêm/di chuyển mục thông tin.

**Hiện có**: ❌ không có. Chỉ có `card_spec` (kích thước ảnh thẻ 4x6, dpi, nền) — là *ảnh*, không phải *phôi*. Gợi ý duy nhất trong BRD: các trường trên thẻ = Họ tên, Khoa, Ngày sinh, Mã SV, Barcode, Thời hạn thẻ; **tên dài ≥ 13 ký tự thì giảm font 12 → 10**.

**Thiết kế đề xuất**

```
card_templates
  id, code (unique), name, description, status DRAFT|ACTIVE|ARCHIVED, version int,
  card_size { widthMm: 85.6, heightMm: 54 }  (CR80 mặc định), dpi 300|600,
  front jsonb, back jsonb (cùng schema layout), created_by_user_id, published_at, archived_at
card_template_assets
  id, template_id, kind LOGO|BACKGROUND|FONT, fs_file_id, file_name, width, height
usage_count = COUNT(print_items.template_id) — tính, không lưu
```

Schema `layout` (front/back):

```jsonc
{
  "background": { "color": "#FFFFFF", "assetId": null },
  "elements": [
    { "id": "photo", "type": "PHOTO", "field": "cardPhoto", "x": 6, "y": 12, "w": 24, "h": 32, "unit": "mm", "z": 1 },
    { "id": "name", "type": "TEXT", "field": "fullName", "x": 34, "y": 14, "w": 46, "h": 8,
      "font": { "family": "Roboto", "size": 12, "weight": 700, "color": "#1A1A1A" },
      "autoShrink": { "minSize": 10, "maxChars": 12 }, "align": "left", "uppercase": true },
    { "id": "code", "type": "TEXT", "field": "studentCode", ... },
    { "id": "barcode", "type": "BARCODE", "field": "studentCode", "symbology": "CODE128", ... },
    { "id": "logo", "type": "IMAGE", "assetId": "…", ... },
    { "id": "label1", "type": "STATIC_TEXT", "text": "THẺ SINH VIÊN", ... }
  ]
}
```

Danh sách biến dữ liệu (`field`) là catalog cố định trong code, trả qua API để CMS dựng bảng chọn: `fullName, studentCode, citizenId, className, faculty, major, dateOfBirth, cardValidUntil, cohort, campaignCode, cardPhoto, qrPayload`. Thêm biến = thêm vào catalog + nguồn dữ liệu, không đổi schema.

Render: **server-side** bằng `sharp` + SVG (hoặc `@napi-rs/canvas`), xuất PNG đúng dpi, để kết quả in ở kiosk và in tập trung giống hệt nhau (D-Q13).

**API đề xuất cho màn 6**

```
GET    /v1/card-templates?status&q&page          ❌ mới (kèm usageCount)
POST   /v1/card-templates                         ❌ mới
GET    /v1/card-templates/:id                     ❌ mới
PATCH  /v1/card-templates/:id                     ❌ mới (ACTIVE đã dùng → tự tăng version, không sửa đè)
POST   /v1/card-templates/:id/duplicate           ❌ mới
POST   /v1/card-templates/:id/publish             ❌ mới
POST   /v1/card-templates/:id/archive             ❌ mới
DELETE /v1/card-templates/:id                     ❌ mới (chỉ DRAFT, usageCount = 0)
POST   /v1/card-templates/:id/assets (multipart)  ❌ mới (logo/nền → file-service)
DELETE /v1/card-templates/:id/assets/:assetId     ❌ mới
POST   /v1/card-templates/:id/preview {setId | sampleData, side}   ❌ mới (PNG xem thử)
GET    /v1/card-templates/fields                  ❌ mới (catalog biến)
```

---

### 2.7 Màn 7 — Quản lý máy in

**Yêu cầu**: danh sách máy in (tên, chế độ in, gắn ở đâu, thiết bị kết nối, số phôi còn); thao tác xem/sửa/cập nhật phôi; trang tạo/quản lý.

**Hiện có**: ❌ không có.

**Thiết kế đề xuất**

```
printers
  id, name, model, print_mode SINGLE_SIDE|DUPLEX, usage_mode DIRECT|CENTRALIZED,
  location (varchar) hoặc site_id, device_id → devices (kiosk gắn máy, nullable),
  connection jsonb { type: USB|NETWORK|AGENT, address, spoolerName },
  status ONLINE|OFFLINE|ERROR|DISABLED, last_seen_at, last_error,
  blank_stock int, blank_stock_updated_at, low_stock_threshold int, default_template_id, agent_token_hash
printer_stock_events
  id, printer_id, delta int, reason REFILL|PRINT|ADJUST|WASTE, resulting_stock, actor_user_id, note, at
```

`blank_stock` giảm 1 mỗi `print_items → PRINTED` (ghi `reason = PRINT`); nạp phôi ghi `REFILL`. Dashboard cảnh báo khi `blank_stock <= low_stock_threshold`.

**API đề xuất cho màn 7**

```
GET    /v1/printers?status&campaignId&q&page        ❌ mới
POST   /v1/printers                                  ❌ mới
GET    /v1/printers/:id                              ❌ mới (kèm stock, hàng đợi, 20 sự kiện gần nhất)
PATCH  /v1/printers/:id                              ❌ mới
POST   /v1/printers/:id/stock {delta, reason, note}  ❌ mới ("update phôi")
GET    /v1/printers/:id/stock-events?page            ❌ mới
POST   /v1/printers/:id/disable | /enable            ❌ mới
POST   /v1/printers/:id/test-print                   ❌ mới (đẩy 1 job test vào hàng đợi)
POST   /v1/printers/:id/token                        ❌ mới (cấp/rotate token cho agent)
POST   /v1/printers/:id/heartbeat {status, error}    ❌ mới (agent gọi, auth bằng token)
```

---

### 2.8 Màn 8 — Người dùng và phân quyền

**Yêu cầu**: danh sách quản trị viên lấy từ service hệ thống; gán người ↔ quyền nhiều-nhiều; thêm người (tên, chức danh, email, mã, SĐT, ảnh thẻ), phân quyền ngay hoặc sau; danh sách quyền truy cập từng đầu API.

**Hiện có**

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| `users` (`sso_user_code` unique, `email`, `display_name`, `is_admin`, `roles jsonb`, `last_login_at`) | 🟡 | tự tạo khi đăng nhập SSO lần đầu (`sso-auth.guard.ts` `upsertUser`); admin đầu tiên bootstrap từ `ADMIN_EMAILS`; **không có API nào** để thăng admin hay gán `REVIEWER` — phải sửa DB tay |
| `GET /v1/me` | ✅ | trả `{ id, ssoUserCode, email, displayName, isAdmin, roles, staffInfo }` |
| `AdminRoleGuard`, `ReviewerRoleGuard`, check inline `req.user.isAdmin` | 🟡 | 2 vai trò cứng; không có `@Roles()`/`@Permission()`; `SharedModule.controllers = []` |
| Quyền theo endpoint | ❌ | không có bảng permission, không có catalog |
| Đồng bộ từ "service hệ thống" | ❌ | LOGIN.md chỉ mô tả `/auth/profile`, `/auth/logout`, `/auth/refresh-token`; **chưa biết SSO có API danh bạ cán bộ hay không** (D-Q10) |

**Thiết kế đề xuất: RBAC chuẩn, quyền gắn với endpoint bằng decorator, catalog sinh tự động.**

```
users  (+ cột mới) title, code, phone, avatar_fs_file_id, status ACTIVE|DISABLED, source SSO|MANUAL|SYNC
roles            id, code (unique), name, description, is_system
permissions      id, code (unique, vd campaign:write), group, description, http_method, path   — sinh từ decorator lúc boot
role_permissions role_id, permission_id
user_roles       user_id, role_id, granted_by_user_id, granted_at
```

- Mỗi handler khai báo `@RequirePermission('campaign:write')`; `PermissionsGuard` (sau `SsoAuthGuard`) kiểm tra `is_admin` **hoặc** user có role chứa permission. Lúc boot, quét metadata để upsert bảng `permissions` → "danh sách các quyền được truy cập vào các đầu API" luôn khớp code.
- Thay thế dần `AdminRoleGuard`/`ReviewerRoleGuard`/check inline; migrate `users.roles` jsonb (`REVIEWER`) sang `user_roles`. Giữ `is_admin` làm super-admin.
- Role seed đề xuất (theo swimlane BRD): `ADMIN`, `CTSV` (đợt chụp, duyệt thành viên, duyệt ảnh), `TRUYEN_THONG` (duyệt ảnh, AI edit, upload), `HAU_CAN` (vận hành kiosk, bổ sung SV), `IT_PRINT` (đợt in, phôi, máy in), `VIEWER` (dashboard).
- Người thêm tay (`source = MANUAL`) khớp với tài khoản SSO khi đăng nhập lần đầu theo `email` → gộp thành 1 dòng, giữ role đã gán.

**API đề xuất cho màn 8**

```
# Users
GET    /v1/users?q&roleCode&status&source&page                ❌ mới
POST   /v1/users {displayName, title, email, code, phone, roleIds?}   ❌ mới (thêm tay)
GET    /v1/users/:id                                          ❌ mới
PATCH  /v1/users/:id                                          ❌ mới
POST   /v1/users/:id/avatar (multipart)                       ❌ mới
POST   /v1/users/:id/disable | /enable                        ❌ mới
PUT    /v1/users/:id/roles {roleIds}                          ❌ mới (thay toàn bộ)
POST   /v1/users/sync                                         ❌ mới (gọi `UserDirectoryClient` — E2; URL qua env `USER_DIRECTORY_URL`, hàm fetch + map viết sẵn, spec API sẽ được cung cấp sau — D-Q10)
GET    /v1/users/sync/status                                  ❌ mới

# Roles
GET    /v1/roles                                              ❌ mới (kèm số user, số permission)
POST   /v1/roles                                              ❌ mới
GET    /v1/roles/:id                                          ❌ mới
PATCH  /v1/roles/:id                                          ❌ mới (is_system: chỉ đổi mô tả)
DELETE /v1/roles/:id                                          ❌ mới (không system, không còn user)
PUT    /v1/roles/:id/permissions {permissionCodes}            ❌ mới
GET    /v1/roles/:id/users?page                               ❌ mới

# Permissions
GET    /v1/permissions?group                                  ❌ mới (catalog: code, method, path, mô tả)
GET    /v1/me/permissions                                     ❌ mới (CMS ẩn/hiện menu)
GET    /v1/me                                                 ✅
```

⚠️ Phải làm **trước** các màn khác vì mọi route mới đều cần `@RequirePermission`; đồng thời vá lỗ hổng campaign CUD hiện chỉ có `SsoAuthGuard`.

---

### 2.9 Mô-đun thống kê — bảng riêng, cập nhật theo action và cron

Yêu cầu của user: "các mục statistic cần có bảng riêng để thống kê, chạy cron để thống kê hoặc là theo action". Hiện nay mọi số liệu được tính lúc đọc bằng `COUNT`/`GROUP BY` trên `sessions`, `photos`, `device_events` (`device-event.service.ts`), sẽ chậm dần theo dữ liệu và không lưu được các chỉ số cần mốc thời gian (p50/p95, quá hạn). Thay bằng một module `stats` độc lập.

**Bảng thống kê** (tất cả có `computed_at`, khóa duy nhất theo chiều gộp; mọi cột đếm mặc định 0)

| Bảng | Khóa | Cột đếm | Phục vụ |
|---|---|---|---|
| `stats_daily_captures` | `(date, campaign_id, device_id, operator_user_id)` | `sessions_started, sessions_completed, subjects_captured, photos_total, photos_ready, photos_failed, retakes, cb_help, by_trigger jsonb {AUTO,GESTURE,SHUTTER,EXTERNAL}, by_capture_mode jsonb, timing_count, timing_sum_ms, timing_min_ms, timing_max_ms, timing_p50_ms, timing_p95_ms` | Màn 1 (a)(c)(d), màn 3 tự động/tay |
| `stats_daily_identification` | `(date, campaign_id, device_id, method)` | `count, failed_count` | Màn 2 thống kê phương thức |
| `stats_daily_review` | `(date, campaign_id, reviewer_user_id)` | `sets_created, approved, rejected, ai_requested, ai_accepted, uploaded, auto_failed, review_sum_hours` | Màn 4 thống kê, màn 1 "chờ duyệt" theo ngày |
| `stats_daily_print` | `(date, campaign_id, printer_id)` | `rendered, printed, failed, reprints, blank_used` | Màn 5/7, màn 1 "đã in" |
| `stats_campaign_snapshot` | `(campaign_id)` — 1 dòng/đợt | `quota, roster_valid, sessions, subjects_captured, processed, pending_review, capture_errors, not_captured, printed, overdue, in_progress_now, last_capture_at` | Màn 1 (b) danh sách đợt, màn 3 tiến độ |
| `stats_jobs` | `id` | `kind (DAILY_RECOMPUTE, SNAPSHOT_REFRESH, REBUILD), range_from, range_to, scope jsonb, status, started_at, finished_at, rows_written, error, triggered_by_user_id` | Vận hành, `GET /v1/stats/jobs` |

Cột `date` tính theo `Asia/Ho_Chi_Minh` (giữ convention của `byDay` hiện tại). `device_id`/`operator_user_id`/`reviewer_user_id`/`printer_id` cho phép NULL (gộp "không rõ"); tổng toàn hệ thống = `SUM` qua các dòng.

**Hai đường cập nhật, dùng song song**

1. **Theo action (tăng dần, gần thời gian thực).** `StatsCollectorService.apply(event)` được gọi ngay sau khi hành động nghiệp vụ ghi xong, **trong cùng transaction** với bảng sự kiện nguồn để thừa hưởng tính idempotent của nguồn (kiosk gửi lại batch không đếm đôi). Câu lệnh là `INSERT … ON CONFLICT (khóa) DO UPDATE SET cột = cột + n`. Điểm móc:
   - `DeviceEventService.recordBatch` — `SESSION_STARTED`, `CAPTURE_TRIGGERED`, `SESSION_COMPLETED`, `SESSION_REPORT` (ảnh, trigger, timing, phương thức định danh), `RETAKE`, `CB_HELP_INTERVENTION`, `UPLOAD_*`.
   - `SessionService.completeSession` (kiosk web).
   - `PhotoReviewService` — tạo set, `approve`, `reject`, `ai-edit`, `accept`, `upload`, `AUTO_FAILED`.
   - `PrintService` — `status` callback từ agent hoặc thao tác tay (`PRINTED`, `FAILED`, reprint), kèm trừ tồn phôi.
   - `CampaignSubjectImportService` — sau import xong cập nhật `roster_valid`, `not_captured` của snapshot.
2. **Cron (đối soát và các chỉ số không cộng dồn được).** Dùng `@nestjs/schedule` đã có trong `app.module.ts` (các worker outbox đang dùng `@Cron`):
   - `*/5 * * * *` — `SNAPSHOT_REFRESH`: tính lại `stats_campaign_snapshot` cho mọi đợt `effectiveStatus = OPEN` (và đợt vừa đóng trong 24h) từ bảng nguồn; đây là nơi tính `overdue` (cần `now`), `in_progress_now` (SESSION_STARTED chưa COMPLETED trong 15 phút), `not_captured`.
   - `0 1 * * *` — `DAILY_RECOMPUTE`: tính lại toàn bộ 4 bảng `stats_daily_*` cho **D-1 và D-2** từ `sessions`, `photos`, `device_events`, `photo_review_events`, `print_item_events`, `eligibility_check_logs`; ghi đè dòng cũ. Đây là bước sửa lệch nếu đường action bỏ sót, và là nơi tính `timing_p50_ms`/`timing_p95_ms` (`percentile_cont`).
   - Khóa chống chạy trùng bằng `pg_try_advisory_lock` (nhiều replica API).
3. **Tính lại thủ công**: `POST /v1/stats/rebuild { from, to, campaignId? }` tạo job `REBUILD` chạy nền, dùng khi sửa logic đếm hoặc nhập dữ liệu cũ.

**Mở rộng (E2)**: mỗi họ chỉ số là một `StatsCollector` đăng ký trong `StatsModule` với 2 hàm `onEvent(event)` và `recompute(date, scope)`. Thêm chỉ số mới = thêm 1 collector + bảng/cột của nó; dashboard controller và cron không đổi.

**Endpoint đổi nguồn dữ liệu** (giữ nguyên response shape, thêm trường):

```
GET  /v1/campaigns/:id/stats            🟡 đọc từ stats_daily_captures + snapshot; thêm byTrigger, byCaptureMode, timing, byIdentification
GET  /v1/campaigns/stats/summary        🟡 đọc từ snapshot; byOperator có dữ liệu; thêm from/to
GET  /v1/campaigns/stats/timeseries     🟡 đọc từ stats_daily_captures
GET  /v1/dashboard/*                    ❌ mới, đọc hoàn toàn từ stats_*
GET  /v1/review/stats                   ❌ mới, đọc từ stats_daily_review
GET  /v1/campaigns/:id/stats/identification, /v1/stats/identification   ❌ mới, đọc từ stats_daily_identification

# Vận hành
POST /v1/stats/rebuild {from, to, campaignId?}   ❌ mới (permission stats:rebuild)
GET  /v1/stats/jobs?kind&status&page             ❌ mới
GET  /v1/stats/health                            ❌ mới (lần chạy cuối, độ trễ, job lỗi)
```

**Lưu ý**: danh sách chi tiết (vd. "các set quá hạn") vẫn truy vấn bảng nguồn bằng index (`subject_photo_sets(status, due_at)`); bảng `stats_*` chỉ giữ **số đếm**, không thay thế bảng nguồn.

---

## 3. Tổng hợp endpoint mới / sửa

| Module | Mới | Sửa | Giữ nguyên | Ghi chú |
|---|---|---|---|---|
| dashboard | 4 | 1 | 1 | `kpis`, `campaigns/active`, `campaigns/:id/kiosks`, `stats/timing` |
| workflows + catalog | 16 | 0 | 6 | thay `capture-configurations` (5 route bỏ sau migrate) |
| campaigns | 11 | 4 | 4 | import (6), assignments (3), devices list (1), stats identification (1) |
| review | 1 | 2 | 12 | `review/stats`; mở rộng lọc + `candidates` |
| print | 22 | 0 | 0 | items 10, batches 10, agent 2 |
| card-templates | 12 | 0 | 0 | |
| printers | 10 | 0 | 0 | |
| users / roles / permissions | 19 | 0 | 1 | |
| stats (vận hành) | 3 | 1 | 0 | `rebuild`, `jobs`, `health`; `stats/timeseries` đổi nguồn |
| **Tổng** | **98** | **8** | **24** | |

---

## 4. Tổng hợp thay đổi DB

**Bảng mới (24)**: `workflows`, `workflow_versions`, `ai_pipeline_steps`, `identification_methods`, `eligibility_check_logs`, `campaign_subject_imports`, `campaign_subjects`, `campaign_kiosk_assignments`, `print_batches`, `print_items`, `print_item_events`, `card_templates`, `card_template_assets`, `card_template_fields`, `printers`, `printer_stock_events`, `roles`, `permissions` (+ 2 bảng nối `role_permissions`, `user_roles`), và 6 bảng thống kê `stats_daily_captures`, `stats_daily_identification`, `stats_daily_review`, `stats_daily_print`, `stats_campaign_snapshot`, `stats_jobs` (§2.9).

**Cột mới**:
- `campaigns`: `workflow_id`, `workflow_version_id`, `processing_sla_hours`, `location`
- `sessions`: `identified_at`, `finished_at`, `identification_method`
- `subject_photo_sets`: `class_name`, `major`, `faculty`, `citizen_id`, `due_at`
- `users`: `title`, `code`, `phone`, `avatar_fs_file_id`, `status`, `source`

**Bỏ / deprecate**: `capture_configurations` (sau migrate sang `workflow_versions`); `campaigns.capture_angles`, `campaigns.card_spec` chuyển thành override tùy chọn; `users.roles` jsonb sau khi migrate sang `user_roles`; 3 cột `capture_mode/auto_hold_ms/simultaneous_capture` đã deprecated từ trước.

Sơ đồ quan hệ các thực thể mới (rút gọn):

```mermaid
erDiagram
  workflows ||--o{ workflow_versions : "có"
  workflow_versions ||--o{ campaigns : "được dùng bởi"
  campaigns ||--o{ campaign_subject_imports : "import"
  campaign_subject_imports ||--o{ campaign_subjects : "dòng"
  campaigns ||--o{ campaign_kiosk_assignments : "gán"
  devices ||--o{ campaign_kiosk_assignments : ""
  users ||--o{ campaign_kiosk_assignments : ""
  campaigns ||--o{ sessions : ""
  sessions ||--o{ subject_photo_sets : "tạo set"
  subject_photo_sets ||--o{ photo_variants : ""
  subject_photo_sets ||--o| print_items : "1 thẻ hiệu lực"
  print_batches ||--o{ print_items : ""
  card_templates ||--o{ print_items : "phôi"
  card_templates ||--o{ card_template_assets : ""
  printers ||--o{ print_items : "in bởi"
  printers ||--o{ printer_stock_events : ""
  users ||--o{ user_roles : ""
  roles ||--o{ user_roles : ""
  roles ||--o{ role_permissions : ""
  permissions ||--o{ role_permissions : ""
```

---

## 5. Phân kỳ đề xuất

| Kỳ | Nội dung | Phụ thuộc | Ước lượng |
|---|---|---|---|
| **P0** | D-Q1..D-Q4 **đã chốt 2026-09-11**; D-Q5..D-Q15 chốt dần trước kỳ liên quan (D-Q10 trước P1 sync, D-Q8/D-Q13 trước P5/P6). | — | — |
| **P1 — RBAC nền + bảo vệ PII** | `roles/permissions/user_roles`, `@RequirePermission` + `PermissionsGuard`, catalog sinh tự động, CRUD users/roles, migrate `users.roles`, gate lại toàn bộ route hiện có (vá campaign CUD); `UserDirectoryClient` stub (D-Q10); **mã hóa CCCD + `citizen_id_hash`/`last4` + permission `subject:view-pii`** (I-Q1). Audit log (I-Q2) chỉ khi được chốt. | P0 | 5–6 ngày |
| **P2 — Nghiệp vụ** | `workflows` + `workflow_versions` + validate schema, `ai_pipeline_steps`, migrate `capture_configurations`, `campaigns.workflow_*`, gộp config cho `devices/config` và `campaigns/:id/config`. | P1 | 5–6 ngày |
| **P3 — Đợt chụp mở rộng** | Phân trang/lọc campaigns, `processing_sla_hours`, `location`, roster import (xlsx, job nền, file lỗi), lookup tại kiosk, `campaign_kiosk_assignments`, `sessions.identification_method/identified_at/finished_at`, `byTrigger`. | P2 | 5–6 ngày |
| **P4 — Mô-đun thống kê + dashboard + review** | `StatsModule`: 6 bảng `stats_*`, `StatsCollector` registry, móc action vào 5 service, 2 cron (`SNAPSHOT_REFRESH`, `DAILY_RECOMPUTE`) + advisory lock, `rebuild/jobs/health`; chuyển 3 endpoint stats cũ sang đọc bảng mới; `dashboard/*`, `review/stats`, `due_at` + overdue, denormalize `subject_photo_sets`, nối `/retouch` theo pipeline, `candidates`. | P3 | 4–5 ngày |
| **P5 — Phôi in** | `card_templates` + assets + render engine (sharp/SVG) + preview + catalog biến. | P1 | 5–6 ngày |
| **P6 — Đợt in + máy in** | `print_items/batches/events`, `printers` + stock, `PrintChannel` adapter với `CENTRALIZED_PACKAGE` (gói PNG/PDF thay `review/export`); API hàng đợi + callback + heartbeat thiết kế sẵn nhưng `AGENT_QUEUE` và print agent Electron **để kỳ sau** (D-Q8). | P4, P5 | 5–7 ngày |
| **Ngoài API** | Kiosk: gửi thêm 3 trường trong `SESSION_REPORT`, đọc `clickMode` từ workflow, lookup roster server; **print agent** trong Electron; CMS 8 màn. | song song | chưa ước lượng |

Tổng backend **30–38 ngày công** (chưa gồm purge job I-Q5 ~1 ngày ở P4 và audit log I-Q2 ~1 ngày nếu chốt). P5 chạy song song với P2–P4 được. Giữ nguyên quy tắc dự án: **không commit cho đến khi test end-to-end từng kỳ**.

---

## 6. Câu hỏi cần trao đổi (D-Q)

Các câu 1–4 quyết định kiến trúc và 6, 8, 10, 12, 14, 15 — **đã chốt ngày 2026-09-11**. Còn mở: D-Q5, D-Q7, D-Q9, D-Q11, D-Q13 (đều có mặc định kỹ thuật, làm theo mặc định nếu không có ý kiến khác).

| # | Câu hỏi | Đề xuất mặc định |
|---|---|---|
| **D-Q1** | Nghiệp vụ: tách `workflows` + `workflow_versions` bất biến (campaign ghim version) và **thay thế** `capture_configurations`, hay chỉ thêm cột `code/version/status` vào `capture_configurations`? | **ĐÃ CHỐT 2026-09-11.** Tách, vì "sửa nghiệp vụ đang dùng" phải không ảnh hưởng đợt đang chạy, và `capture_configurations` không có liên kết runtime nào để tận dụng. |
| **D-Q2** | Chế độ bấm chụp (liên tục / 1 lần / tự động AI) nằm trong nghiệp vụ — **đảo ngược Q11** (2026-09-08: là cài đặt kiosk). Chọn: (a) nghiệp vụ quyết định hoàn toàn, bỏ cài đặt kiosk; (b) nghiệp vụ đặt *mặc định + danh sách cho phép*, kiosk chọn trong đó; (c) giữ Q11, bỏ mục này khỏi nghiệp vụ. | **ĐÃ CHỐT 2026-09-11: (b).** Giữ được cả hai yêu cầu, thống kê tự động/tay vẫn đúng. |
| **D-Q3** | Tạo lại roster ở server (`campaign_subjects`) — **đảo ngược** việc xóa `campaign_student_roster` ngày 2026-09-08. Kiosk sẽ tra cứu qua API (cache offline) thay cho `response.json`. Cột Excel bắt buộc là gì? (đề xuất: mã SV, họ tên, CCCD, lớp, khoa, ngành, ngày sinh, thời hạn thẻ) | **ĐÃ CHỐT 2026-09-11: Có.** Server là nguồn sự thật, dashboard mới đếm được "chưa chụp" và phôi mới có Khoa/ngày sinh. Cột Excel bắt buộc lấy theo đề xuất. |
| **D-Q4** | Gán 1 người ↔ 1 kiosk — **đảo ngược** "không cần phân công" (2026-09-08). Xác nhận cần; và việc gán có tự động **duyệt thành viên** (APPROVED) không? | **ĐÃ CHỐT 2026-09-11: Có; gán = tự duyệt** để không phải làm 2 bước. |
| D-Q5 | Phương thức định danh nào thực sự có phần cứng: QR CCCD (đã có `apps/cccd-scanner`), RFID/NFC (cần đầu đọc), FaceID (embedding sidecar hiện là **mock**), Barcode, tra cứu tay? Thống kê chỉ cần enum, nhưng kiosk phải báo đúng phương thức đã dùng. | Làm enum đủ 6, kiosk triển khai dần; FaceID để sau. |
| D-Q6 | "Ảnh quá hạn xử lý": mốc = `sessions.completed_at + processing_sla_hours`; quá hạn khi set chưa APPROVED. Hay tính đến lúc **đã in**? | **ĐÃ CHỐT 2026-09-11.** Tính đến APPROVED (khâu CTSV); in có KPI riêng (`stats_daily_print`). |
| D-Q7 | "Địa điểm" đợt chụp: text tự do hay bảng `sites` (cơ sở/điểm chụp) để lọc thống kê theo cơ sở (BA #19)? | Text tự do trước, `sites` khi cần. |
| D-Q8 | In trực tiếp tại kiosk cần **print agent** trong Electron (spooler Windows, model máy in thẻ nào, CR80, in 2 mặt?). Đây là scope mới ngoài API — ai làm, khi nào? | **ĐÃ CHỐT 2026-09-11.** In tập trung (gói PDF/PNG) trước; API hàng đợi/callback thiết kế sẵn; print agent Electron làm kỳ sau. |
| D-Q9 | Dữ liệu trên phôi (Khoa, ngày sinh, thời hạn thẻ, barcode) lấy từ đâu: roster import (D-Q3) hay API sinh viên ngoài (`DainamStudentInfoClient` chưa nối)? | Roster import trước; API ngoài bổ sung khi có spec. |
| D-Q10 | "Danh sách quản trị viên lấy từ service hệ thống" — service nào, endpoint nào? SSO hiện chỉ có `/auth/profile`. Cần spec danh bạ cán bộ. | **ĐÃ CHỐT 2026-09-11.** Trước mắt thêm tay + tự tạo khi đăng nhập; P1 **viết sẵn `UserDirectoryClient`** (hàm gọi API + map về `users`, URL/token qua env) và `POST /v1/users/sync` gọi client đó; user sẽ cung cấp đường dẫn API sau, khi đó chỉ điền config và map field. |
| D-Q11 | AI sửa theo prompt: sidecar `/edit` đang 501, chưa có GPU (R-Q4). Chấp nhận màn 4 chạy đủ luồng nhưng nút "AI sửa" báo lỗi rõ ràng cho đến khi có model? | Chấp nhận; ưu tiên nối `/retouch` (đã có, chạy CPU) cho "làm mịn". |
| D-Q12 | Dashboard "theo cá nhân" = cán bộ chụp (`operator_user_id`) hay người đang đăng nhập xem số của mình? | **ĐÃ CHỐT 2026-09-11.** Cá nhân = cán bộ chụp (`operator_user_id`); lọc `operatorUserId`, mặc định = người đăng nhập; admin (permission `stats:read-all`) chọn người khác. Chiều gộp `stats_daily_captures` giữ `operator_user_id`. |
| D-Q13 | Render phôi ở server (sharp/SVG, PNG đúng dpi) hay ở CMS (canvas)? | Server — in ở kiosk và in tập trung ra cùng một ảnh. |
| D-Q14 | Duyệt ảnh: giữ **1 vai trò REVIEWER** (R-Q2) hay 2 vòng CTSV + Truyền thông như BA? | **ĐÃ CHỐT 2026-09-11.** Giữ 1 vòng; RBAC mới cho phép thêm vòng 2 sau bằng permission riêng (E4). |
| D-Q15 | Đơn vị "ảnh" trong dashboard: 1 sinh viên = 1 phiên (đề xuất) hay đếm từng file ảnh? | **ĐÃ CHỐT 2026-09-11.** Đếm phiên/sinh viên (`subjects_captured`) là chỉ số chính; số file (`photos_total`) là chỉ số phụ trong cùng bảng. |

---

## 7. Điểm rủi ro đã thấy trong code hiện tại (nên vá trong P1)

1. `POST/PATCH/DELETE /v1/campaigns` chỉ có `SsoAuthGuard` — người dùng thường xóa được campaign.
2. `GET /v1/campaigns/stats/summary` trả `byOperator = []` — dashboard toàn hệ thống không có số theo cán bộ.
3. `GET /v1/campaigns`, `GET /v1/campaigns/:id/devices` trả mảng không phân trang — CMS list sẽ không có `{items, meta}`.
4. Sidecar `/embed` và `/liveness` là **mock** nhưng tự nhận `model_family: "ArcFace-Python"` — không dùng cho FaceID định danh cho đến khi thay model thật.
5. `DainamStudentInfoClient` đã viết nhưng chưa nối — cần xác nhận spec API sinh viên trước khi dựa vào nó cho điều kiện tiếp nhận.

---

## 8. Câu hỏi cải thiện dự án ngoài phạm vi 8 màn (I-Q)

User hỏi ngày 2026-09-11: "còn câu hỏi nào để giúp tôi cải thiện project không?". Dưới đây là các điểm phát hiện trong lúc rà soát code và tài liệu, mỗi điểm kèm bằng chứng, đề xuất và kỳ nên làm. Nhóm A quan trọng nhất vì liên quan pháp lý và không thể bổ sung hồi tố.

### A. An ninh và dữ liệu cá nhân

| # | Vấn đề (bằng chứng) | Đề xuất | Kỳ |
|---|---|---|---|
| I-Q1 | **Số CCCD lưu plaintext** trong `sessions.metadata.identityNumber`, tìm kiếm được qua `GET /v1/students?q=`; roster mới (D-Q3) sẽ thêm `citizen_id`, ngày sinh. Thiết kế gốc (`DESIGN-photo-station.md` §1.5) chỉ lưu hash sha256+pepper và 4 số cuối. Đây là dữ liệu cá nhân theo Nghị định 13/2023. | **ĐÃ CHỐT 2026-09-11, làm ở P1.** Mã hóa tại chỗ (pgcrypto hoặc app-level AES) cho `citizen_id`, lưu thêm `citizen_id_hash` để tra cứu và `citizen_id_last4` để hiển thị; permission riêng `subject:view-pii` mới xem đầy đủ; mọi lần xem đầy đủ ghi audit. | P1 (trước khi import roster thật) |
| I-Q2 | **Không có audit log** cho thao tác quản trị: đổi nghiệp vụ, publish version, gán quyền, xóa campaign, gửi in, xem ảnh gốc. `grep audit_log` trong `apps/api/src` = 0. BA §14.3 nhấn mạnh: "ghi thiếu ngay từ đầu sẽ không thể bổ sung lại về sau". | *Đang trao đổi, chưa chốt — user 2026-09-11: "trao đổi chưa code".* Đề xuất: bảng `audit_logs` INSERT-only (`actor_user_id, actor_type, action, entity_type, entity_id, before jsonb, after jsonb, ip, at`), interceptor ghi tự động cho mọi route có `@Audited()`; không bao giờ UPDATE/DELETE. | P1 |
| I-Q3 | CMS lưu `access_token`/`refresh_token` trong **cookie không HttpOnly** (`apps/cms/src/auth/authCookies.ts`, chính comment trong file thừa nhận rủi ro XSS). | Ngắn hạn: CSP nghiêm + không render HTML từ dữ liệu người dùng. Dài hạn: API làm BFF, đặt cookie HttpOnly + SameSite, CMS không chạm token. | Sau P1 |
| I-Q4 | Đường kiosk web vẫn dùng **1 `API_KEY` tĩnh dùng chung** (`ApiKeyMiddleware`), không quy được hành động về máy/người nào. Desktop kiosk đã có device credentials + user token. | Bỏ api-key: kiosk web cũng self-enroll lấy device credentials, gửi kèm user token → mọi phiên có `device_id` + `operator_user_id`. | P3 |
| I-Q5 | **Không có chính sách lưu trữ/xóa.** Bytes ảnh, video, variant nằm vĩnh viễn trong Postgres (`upload_outbox.content`, `video_upload_outbox.content`, `variant_upload_outbox.content` — không có job xóa `content` sau `DONE`); video ước ~19 GB/đợt (§7.3 D); kiosk không dọn local; BRD IV.3 để TBD "chính sách lưu trữ/xóa". | **ĐÃ CHỐT 2026-09-11** (N/M/X để dạng config `retention.*`, số cụ thể chốt sau). Thời hạn theo loại: ảnh thẻ chính thức (vĩnh viễn theo QĐ-F), ảnh gốc (N năm), video (M tháng), bản `content` trong Postgres (xóa sau khi `fs_status = READY` + X ngày). Job cron purge + luồng "yêu cầu xóa dữ liệu" của sinh viên (BA `erasure`). | P4 |
| I-Q6 | `campaigns.consent_content/consent_version` có nhưng **chưa hiển thị đồng ý tại kiosk** và chưa ghi `consent_version` vào phiên (U-Q8, §7.3 B còn mở). | Màn S8 hiện consent, cán bộ bấm "SV đã đồng ý", `sessions.consent_version` + `consented_at`; báo cáo đếm phiên thiếu consent. | P3 (kiosk) |

### B. Toàn vẹn dữ liệu và vận hành

| # | Vấn đề | Đề xuất | Kỳ |
|---|---|---|---|
| I-Q7 | Photo-review và `device_events` **không có FK** tới `campaigns`/`sessions`/`photos`/`users` (chính sách "module boundary", `1800000000000-CreatePhotoReview.ts`). Rủi ro dòng mồ côi khi xóa campaign/phiên, không cascade, không RESTRICT. | Giữ tách module ở code nhưng **thêm FK ở DB** với `ON DELETE RESTRICT` cho các tham chiếu campaign/session/user; hoặc tối thiểu job kiểm tra toàn vẹn hằng đêm ghi vào `stats_jobs`. Các bảng mới trong plan này đều có FK. | P2 |
| I-Q8 | **Ba worker outbox gần như copy-paste** (`upload-worker`, `video-upload-worker`, `variant-upload-worker`), 3 bảng cùng schema. Đã dùng `FOR UPDATE SKIP LOCKED` nên an toàn nhiều replica; nhưng mỗi sửa lỗi phải làm 3 lần. | Gộp thành 1 `outbox` generic (`kind` = PHOTO/VIDEO/VARIANT, `ref_id`) + 1 worker; migrate dữ liệu; giữ API bên ngoài không đổi. | Sau P6 (refactor) |
| I-Q9 | `GET /v1/health` chỉ `SELECT 1`; sidecar `/api/v1/health` **hardcode `models_loaded: true`**; không kiểm tra file-service, SSO. Không có metrics/alert. | Health tổng hợp `{db, fileService, sidecar, sso, statsLag, outboxBacklog}` + trạng thái `DEGRADED` có lý do; sidecar báo model thật đã load; xuất Prometheus metrics (outbox depth, cron lag, sidecar latency). | P4 |
| I-Q10 | Sidecar `/embed` và `/liveness` là **mock** nhưng tự nhận `model_family: "ArcFace-Python"`; `/background` là `grabCut` placeholder (docstring ghi TODO BiRefNet/rembg). Nếu bật FaceID (D-Q5) hoặc dùng nền tự động cho ảnh chính thức sẽ ra dữ liệu sai. | Feature flag `AI_REAL_MODELS_REQUIRED=true` ở production: sidecar từ chối phục vụ route mock; đổi `model_family` thành `MOCK`; đánh giá BiRefNet trên ~50 ảnh thật trước khi dùng cho ảnh chính thức. | P2 (flag), P4 (BiRefNet) |
| I-Q11 | `apps/cccd-scanner` là app Electron riêng, OCR **mặt trước** CCCD rồi **ghi file `response.json`** cho kiosk `cccdWatcher.ts` đọc. Với roster ở server (D-Q3), hợp đồng file-drop này không còn khớp; OCR mặt trước kém tin cậy hơn QR mặt sau (tài liệu `he-thong-chup-anh-the-sinh-vien.html` §04 khuyên lấy 12 số từ trường đầu của QR). | Scanner gửi kết quả qua IPC/localhost HTTP thay vì file; kiosk gọi `GET /v1/campaigns/:id/subjects/lookup`; chuẩn hóa QR mặt sau là phương thức chính, OCR là fallback; ghi `identification_method` tương ứng. | P3 |
| I-Q12 | Script migrate DB **hỏng trên Windows** (nhúng cú pháp env Unix, ghi trong memory 2026-09-08); migration có khoảng trống số (1794–1799, 1802 đã xóa). | Sửa script dùng `cross-env`; thêm bước CI "migrate DB trống + chạy test"; ghi README quy ước đánh số. | P1 |

### C. Chất lượng mã và quy trình

| # | Vấn đề | Đề xuất | Kỳ |
|---|---|---|---|
| I-Q13 | **Không có CI** (không có `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile` trong `Looka/`). Commit gần nhất `dc1a00a 2026-09-10 "chore: update"` gói cả ngày làm việc 158 file. | **BỎ QUA theo quyết định user 2026-09-11.** Giữ lại để tham khảo: CI tối thiểu `turbo run build` (17 package), test 4 nhóm (api, workflow-engine, ui, desktop) + `pytest` sidecar, migrate DB trống, lint; commit theo kỳ P1…P6 với message mô tả. | — |
| I-Q14 | `apps/cms/src/api.ts` viết tay >1000 dòng; plan thêm ~100 route → nguy cơ lệch DTO giữa API và CMS. | Sinh client TypeScript từ Swagger (`/docs-json`) bằng `openapi-typescript` hoặc `orval` trong build CMS; DTO dùng chung đặt ở `packages/core`. | P1 |
| I-Q15 | Chưa có test end-to-end CMS (Playwright, §7.3 G) và chưa chạy ma trận phần cứng video V1–V7 (§3.10). | Playwright cho 8 màn theo kỳ; lịch test phần cứng trước pilot. | Song song |
| I-Q16 | Mã chết/lỗi thời: `apps/cms/src/components/DevicesPanel.tsx` không ai import; `apps/web` là demo, dễ nhầm với CMS; 3 cột deprecated trên `campaigns`; `capture_configurations` sau migrate. | Dọn theo từng kỳ; đổi mô tả `apps/web/package.json` cho rõ là demo kiosk. | P2 |
| I-Q17 | Hiệu năng: `GET /v1/campaigns` và `GET /v1/campaigns/:id/devices` trả mảng không phân trang; `GET /v1/students/:code` mint view-link cho **mọi** ảnh của mọi phiên. | Phân trang (đã trong plan); view-link mint lười theo yêu cầu (`POST /photos/:id/view-link` đã có) thay vì mint hàng loạt. | P3 |

### D. Sản phẩm

| # | Vấn đề | Đề xuất | Kỳ |
|---|---|---|---|
| I-Q18 | BRD dòng 4: thông báo lịch chụp cho SV qua **App Mydainam trước 7–10 ngày** — chưa có trong hệ thống nào. | Adapter `NotificationChannel` (E2) với `MYDAINAM_PUSH` khi có API; trước mắt xuất danh sách + mẫu thông báo (BRD IV.2). | Sau P3 |
| I-Q19 | Chưa quyết ai được **xem ảnh gốc** của SV và có watermark/ghi log không (`KE-HOACH-DU-AN.md` §40.2: watermark tên người xem, log trước khi trả URL). | Permission `photo:view-original`, view-link mang `viewerId` (đã có) + ghi `audit_logs`, watermark tùy chọn. | P1 (permission), P4 (watermark) |
| I-Q20 | Nhiều replica API? Cache SSO profile là `Map` trong process (60 s), cron dùng advisory lock, outbox đã `SKIP LOCKED`. Nếu chạy 1 instance thì đủ; nếu ≥2 cần Redis cho cache và rate-limit. | Xác nhận topology triển khai (1 hay N instance, có reverse proxy không) để chốt có Redis hay không. | P0 |
