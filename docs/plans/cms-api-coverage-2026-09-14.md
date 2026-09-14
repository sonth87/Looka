# Đối chiếu API hiện có với 8 màn CMS — theo yêu cầu chi tiết 2026-09-14

> Nguồn: đọc trực tiếp source code `Looka/apps/api/src` (controller/DTO/DAO/entity/migration thật —
> không suy đoán từ `cms-8-screens-api-plan.md`, chỉ dùng plan đó làm bối cảnh), cộng với build-test
> thực tế (`npm run start` = `nest build`). Yêu cầu 8 màn lấy nguyên văn từ user (ưu tiên hơn plan cũ
> nếu lệch nhau). Chỉ ghi phần **quan trọng đã có API thật**; phần thiếu chỉ ghi 1 dòng, không phân tích thêm.

## ✅ Cập nhật 2026-09-14 (sau khi agent phân tích xong)

Agent phân tích snapshot lúc `modules/stats` (P4) đang code dở, thấy **8 lỗi TypeScript chặn build**
và route `GET /v1/campaigns/:id/kiosks` "code chết chưa gắn". Cả hai đã được sửa ngay sau đó, trong
cùng phiên làm việc: **build sạch** (`nest build` chạy lại nhiều lần, 0 lỗi), và route
`GET /v1/campaigns/:id/kiosks` đã được gắn vào `CampaignKioskAssignmentController`. Toàn bộ nội dung
bên dưới (viết bởi agent, dựa trên đọc source thật) vẫn đúng — chỉ riêng khung cảnh báo gốc và dòng
"❌ Không có route" ở Màn 1 (kiosks) đã lỗi thời, được sửa lại ngay bên dưới cho khớp trạng thái hiện
tại. Phần còn lại của báo cáo (Màn 2–8, phần `class_id`) không bị ảnh hưởng.

## Tóm tắt

**Cập nhật 2026-09-14 (lần 2)**: khi báo cáo này viết lần đầu, Màn 5/6/7 đúng là chưa có API nào —
đúng như bản dưới đây mô tả tại thời điểm đó. Ngay sau đó, trong cùng phiên làm việc, cả 3 màn đã
được code xong (P5 — phôi in, rồi P6 — đợt in + máy in). Tất cả 8/8 màn nay đều có độ phủ API đáng kể.
Chi tiết đã cập nhật trực tiếp vào từng mục Màn 5/6/7 bên dưới thay vì giữ nguyên bản cũ.

- **8/8 màn có độ phủ API đáng kể**: Màn 2 (nghiệp vụ), 3 (đợt chụp), 4 (duyệt ảnh AI — đầy đủ nhất),
  5 (đợt in thẻ), 6 (phôi in), 7 (máy in), 8 (người dùng/RBAC) đều có CRUD/lifecycle chính đầy đủ.
- **Dashboard (Màn 1) đã có code đầy đủ** (build sạch, mọi route đã mount) — xem cập nhật đầu
  trang; `GET /v1/campaigns/:id/kiosks` (kiosk + người gán) nay đã gắn route, không còn là code chết.
- Phần còn thiếu ngoài API (không thuộc phạm vi báo cáo này): CMS frontend cho 8 màn, và print agent
  Electron thật cho chế độ in trực tiếp (DIRECT) — quyết định D-Q8 để lại cho kỳ sau, chỉ có API
  hàng đợi/callback/heartbeat thiết kế sẵn.

---

## Màn 1 — Dashboard

Toàn bộ endpoint bên dưới thuộc `modules/stats`, đã build sạch và mount vào app (xem cập nhật đầu trang).

| Yêu cầu | Endpoint | Response fields | Ghi chú |
|---|---|---|---|
| Ảnh chụp theo ngày theo cá nhân, chờ duyệt, đã in, quá hạn | `GET /v1/dashboard/kpis?from&to&operatorUserId&campaignId` | `DashboardKpisDao`: `captured{total, byDay[{date,count}]}`, `pendingReview`, `printed`, `overdue` | Mặc định `operatorUserId` = người đăng nhập nếu không truyền; `printed` luôn = 0 (chưa có module in) |
| Danh sách đợt đang hoạt động (tên/địa điểm/tổng/chụp được/xử lý/chụp/chờ duyệt/lỗi/chưa chụp) | `GET /v1/dashboard/campaigns/active` | `DashboardActiveCampaignDao[]`: `campaignId, name, code?, location?, quota?, captured, processed, sessions, pendingReview, captureErrors, notCaptured?, overdue, inProgressNow, lastCaptureAt?` | Khớp gần đủ 7 chỉ số yêu cầu; `notCaptured` = `null` nếu campaign chưa có roster |
| Chi tiết đợt — kiosk đang setup + người được gán | `GET /v1/campaigns/:id/kiosks` | `CampaignKioskSummaryDao[]{deviceId, deviceName, status, assignedUserId?, assignedUserEmail?, assignedUserDisplayName?, sessionsCompleted}` | Nằm ở `device-management` (`CampaignKioskAssignmentController`), không phải `stats` — timing riêng từng kiosk lấy qua `GET /v1/campaigns/:id/stats/timing?groupBy=device`, không lặp lại ở đây |
| Thời gian chụp mỗi kiosk (quét thẻ → chụp xong gửi lời chào) | `GET /v1/campaigns/:id/stats/timing?groupBy=device\|operator\|date&from&to` | `CampaignTimingRowDao[]`: `key (string\|null), count, avgMs, p50Ms, p95Ms` | `p50Ms/p95Ms` = `null` cho tới khi cron `DAILY_RECOMPUTE` (01:00 mỗi ngày, chỉ chạy ở `SERVICE_TYPE=worker`/`all`) đã chạy qua ngày đó |
| (phụ) Thống kê phương thức định danh của 1 đợt / toàn hệ thống | `GET /v1/campaigns/:id/stats/identification`, `GET /v1/stats/identification?from&to` | `IdentificationStatsDao`: `{ byMethod: Record<string, number> }` | — |
| (phụ) Vận hành thống kê | `POST /v1/stats/rebuild`, `GET /v1/stats/jobs`, `GET /v1/stats/health` | job `{jobId}`; `Pagination<StatsJobDao>`; `StatsHealthDao{snapshotRefresh, dailyRecompute}` | Không liên quan trực tiếp màn 1 nhưng cùng module |

**Endpoint cũ (module `device-management`, từ P3, đọc trực tiếp từ `sessions`/`photos`/`device_events` — chưa chuyển sang đọc bảng `stats_*`)**:

| Endpoint | Response fields | Ghi chú |
|---|---|---|
| `GET /v1/campaigns/:id/stats` | `CampaignStatsDao`: `campaignId, deviceCount, sessionsCompleted, uploadSuccess, uploadFailed, retakes, cbHelpInterventions, sessions, photos{total,ready,pending,failed}, byDevice[{deviceId,deviceName,sessions,photosReady,photosFailed,lastCaptureAt?}], byOperator[{operatorUserId\|null,operatorName,sessions,photosReady,photosFailed,lastCaptureAt?}], byDay[{date,sessions,photos}] (30 ngày), byTrigger[{key,count}], byCaptureMode[{key,count}]` | **Không có timing** (đã xác nhận đọc thẳng code `DeviceEventService` — không đụng tới mốc thời gian nào) |
| `GET /v1/campaigns/stats/summary` | `AllCampaignsStatsDao`: tổng toàn hệ thống + `campaigns[]` (như trên nhưng `byOperator/byTrigger/byCaptureMode` luôn rỗng) | — |
| `GET /v1/campaigns/stats/timeseries?days=` | `{ points: [{date, sessionsCompleted, uploadsSuccess, uploadsFailed, retakes}] }` | — |

### Kiểm tra `class_id` (yêu cầu mới của user — cho tính năng báo GVCN theo lớp sau này)

**Xác nhận: KHÔNG có `class_id`/`classId` ở bất kỳ đâu trong `apps/api/src`** — grep toàn bộ mã nguồn
(entity, DAO, service, migration) cho `class_id|classId` cho **0 kết quả**. Không có bảng `classes`
nào tồn tại.

Năng lực gần nhất hiện có: `campaign_subjects.class_name` (`varchar(100) nullable`) — cột **text tự
do**, đọc thẳng từ cột thứ 4 của file Excel roster khi import (`campaign-subject.service.ts`,
`className: get(4) || null`), không có validate, không đối chiếu với danh mục nào. Giá trị này sau đó
được copy tiếp (denormalize) sang `subject_photo_sets.class_name` (migration `1816000000000`) và
`sessions.metadata.className` — vẫn chỉ là cùng một chuỗi text, không có nguồn id nào khác.

**Kết luận: đây là một khoảng trống thật.** Không có id lớp ổn định để join/group — hai biến thể chính
tả của cùng một lớp (`"CNTT01"` vs `"CNTT 01"` vs `"cntt01"`) sẽ bị hệ thống coi là 2 nhóm khác nhau
khi gộp theo `class_name`; và kể cả gộp đúng, cũng không có bảng nào ánh xạ lớp → GVCN để biết gửi
thông báo cho ai. Muốn làm tính năng "báo GVCN theo lớp" cần thêm ít nhất một bảng `classes` (id ổn
định, tên chuẩn hoá) + cơ chế map `campaign_subjects.class_name` (text tự do) về `class_id` đó, cộng
với nguồn dữ liệu GVCN (hiện chưa có ở đâu trong hệ thống).

---

## Màn 2 — Cấu hình nghiệp vụ (`modules/workflow`, đã build/wire vào app — không phụ thuộc lỗi §build)

| Yêu cầu | Endpoint | Response fields | Ghi chú |
|---|---|---|---|
| (a) Danh sách nghiệp vụ, Xem/Sửa/Xóa, trạng thái Nháp/Lưu trữ/Hoạt động | `GET /v1/workflows?status&q&page&limit` | `Pagination<WorkflowReadModel>`: `id, code, name, description, status (DRAFT\|ACTIVE\|ARCHIVED), currentVersionId, currentVersion, currentConfig, campaignCount, createdAt, updatedAt` | — |
| Sửa thông tin chung | `PATCH /v1/workflows/:id` | `WorkflowResult{id,code,name,description,status,currentVersionId}` | Chỉ sửa tên/mô tả; không sửa `code`/config qua route này |
| Xóa | `DELETE /v1/workflows/:id` | `{id}` | Chỉ khi `DRAFT` và chưa campaign nào dùng |
| (a) Tạo nghiệp vụ (tên/mã/mô tả) + version | `POST /v1/workflows` | `WorkflowResult` | Tạo `DRAFT` + version 1 nháp; `version` là số nguyên tăng dần ở `workflow_versions`, không phải field nhập tay |
| Publish / tạo version mới / lưu trữ | `POST /v1/workflows/:id/publish`, `POST /v1/workflows/:id/versions`, `POST /v1/workflows/:id/archive` | `WorkflowResult` / `WorkflowVersionResult{id,workflowId,version,isDraft}` | `publish`: DRAFT→ACTIVE, đóng băng version; `versions`: nhân bản version đã publish thành nháp mới; `archive`: chỉ từ ACTIVE |
| Xem lịch sử version / nơi đang dùng | `GET /v1/workflows/:id/versions`, `GET /v1/workflows/:id/usage` | `WorkflowVersionSummary[]{id,version,isDraft,publishedAt,note}`; `WorkflowUsageReadModel[]{campaignId,campaignName,campaignCode,workflowVersionId,version}` | — |
| Validate cấu hình (dry-run) | `POST /v1/workflows/validate` | `{valid: boolean, errors: string[]}` | Không ghi DB |
| (b) Cấu hình camera: góc chụp sửa được + chế độ bấm chụp | `PUT /v1/workflows/:id/config` (ghi), đọc qua `currentConfig`/`GET /v1/workflows/:id` | `config.capture`: `{ angles[], clickMode: {default, allowed[]}, shotsPerCamera?, cardSourceAngleCode? }` | `clickMode` đúng yêu cầu D-Q2: `default` (áp mặc định) + `allowed[]` (kiosk chỉ chọn trong danh sách này); giá trị enum thật là `MANUAL_SEQUENTIAL\|MANUAL_ALL_AT_ONCE\|AUTO_AI` (≈ liên tục / 1 lần toàn bộ / tự động AI) |
| (c) Phương thức định danh (multi-select) | cùng route trên | `config.identification`: `{ methods: ['QR_CCCD','RFID','NFC','BARCODE','FACE_ID','MANUAL_LOOKUP'], lookupKeyField }` | Thống kê theo phương thức → xem màn 1 (`GET /v1/campaigns/:id/stats/identification`, `/v1/stats/identification`) — không có endpoint riêng trong module `workflow` |
| (d) Điều kiện tiếp nhận — trang cấu hình riêng | cùng route trên + `GET /v1/eligibility/api-clients`, `POST /v1/eligibility/test-lookup` | `config.eligibility`: `{ mode: NONE\|ROSTER\|EXTERNAL_API\|ROSTER_AND_API, api?{clientCode,keyField,requiredFields}, rules?[{key,expr,message}], rosterTemplate? }`; `api-clients` → `[{code,name,fields[]}]` (1 mục cứng: `DAINAM_STUDENT_INFO`); `test-lookup{clientCode,key}` → `{success,message,sampleRecord}` | Chỉ preview để xem field mẫu, **chưa phải đánh giá rule thật**; `rules[].expr` chỉ kiểm tra không rỗng, chưa parse/evaluate |
| Import Excel + danh sách lỗi | ❌ **Không có trong module này** | — | Import thật nằm ở cấp **đợt chụp** (màn 3: `POST /v1/campaigns/:id/subjects/imports`), không phải cấp nghiệp vụ; `rosterTemplate` chỉ là 1 field string tham chiếu trong config |
| (e) Xử lý AI đầu ra + trang quản lý bước AI | cùng route trên + `GET/POST/PATCH /v1/ai-pipeline-steps` | `config.aiProcessing`: `{enabled, steps:[{code,params}]}`; catalog `AiPipelineStepReadModel[]{id,code,nameVi,description,sidecarEndpoint,paramsSchema,defaultParams,active,sortOrder,isSystem}` | Không có `DELETE` cho catalog (chỉ tạo/sửa/xem) |
| (f) In trực tiếp hay tập trung | cùng route trên | `config.printing: {mode: DIRECT\|CENTRALIZED}` | Chỉ là 1 field cấu hình lưu sẵn; phía sau (in thật) chưa có gì (màn 5/6/7 = 0%) |

Ghi chú thêm: `capture-configuration.controller.ts` (API cũ trước khi có `workflows`) **vẫn còn sống**,
mọi route trả header `Deprecation: true`, doc comment ghi rõ đã bị thay thế — không nên dùng cho CMS
mới.

---

## Màn 3 — Quản lý đợt chụp (`modules/device-management`, đã wire vào app)

| Yêu cầu | Endpoint | Response fields | Ghi chú |
|---|---|---|---|
| Danh sách (tên/mã/quy trình/thời gian/số lượng/tiến độ/trạng thái) | `GET /v1/campaigns?page&limit&status&workflowId&from&to&q` | Không truyền `page` → mảng `CampaignDao[]` (tương thích ngược); truyền `page` → `Pagination<CampaignDao>` + mỗi item có thêm `workflowName`, `progress{captured,approved,quota,percent}` | `CampaignDao` đầy đủ: `id,name,description?,purpose,code?,cohort?,startsAt?,expiresAt?,quotaPlanned?,manualStatus?,effectiveStatus (PAUSED\|CLOSED\|UPCOMING\|OPEN\|EXPIRED),quotaReached,requiredCameraCount,captureAngles?,cardSpec?,recordVideo,workflow?{id,code,versionId,version},processingSlaHours?,location?,createdAt,updatedAt` |
| Xem chi tiết | `GET /v1/campaigns/:id` | `CampaignDao` (như trên, `progress` = null ở route này) | `workflow`/`captureAngles`/`cardSpec` được merge từ version đã ghim khi cột riêng của campaign là null |
| Tạo/sửa (tên, quy trình, thời gian, số tài khoản import, SLA giờ) | `POST /v1/campaigns`, `PATCH /v1/campaigns/:id` | Body chấp nhận: `name, workflowVersionId, startsAt, expiresAt, quotaPlanned, processingSlaHours, location, ...` → trả `CampaignDao` | `PATCH` là partial update; "số tài khoản import" tương ứng `campaign_subjects` (xem dưới), không phải field trực tiếp trên campaign |
| Đổi trạng thái | `PATCH /v1/campaigns/:id` với `{ manualStatus: 'PAUSED'\|'CLOSED'\|null }` | `CampaignDao` | **Không có endpoint riêng cho đổi trạng thái** — dùng chung PATCH, cùng quyền `campaign:write` với sửa thông tin |
| Xóa | `DELETE /v1/campaigns/:id` | `{id}` | Gate quyền `campaign:delete`; 409 nếu còn devices/sessions |
| Import tài khoản (Excel) | `POST /v1/campaigns/:id/subjects/imports` (multipart field `file`, ≤10MB) | `CampaignSubjectImportDao{id,campaignId,fileName,uploadedByUserId?,status(PROCESSING\|DONE\|FAILED),totalRows,validRows,errorRows,errorReportUrl?,failureReason?,createdAt}` | `errorReportUrl` đôi khi `null` dù `errorRows>0` (lỗi biết trước, do file-service dev chậm nhất quán) |
| Xem danh sách import / theo dòng / lỗi ở đâu | `GET .../subjects/imports`, `GET .../subjects/imports/:id`, `GET .../subjects?status&q&page`, `GET /v1/campaigns/subjects/import-template` | `CampaignSubjectDao{id,campaignId,importId,rowNo,subjectCode,fullName,citizenId?,className?,faculty?,major?,dateOfBirth?,cardValidUntil?,status(VALID\|ERROR\|DUPLICATE),errorMessage?,createdAt}` | Lọc `?status=ERROR` chính là cách "xem lỗi ở đâu"; `errorMessage` có lý do cụ thể (vd `"Mã SV \"X\" đã có trong đợt này"`) |
| Gán 1 người ↔ 1 kiosk | `GET/PUT/DELETE /v1/campaigns/:id/assignments/:deviceId`, `GET /v1/campaigns/:id/assignments` | `CampaignKioskAssignmentDao{id,campaignId,deviceId,deviceName?,userId,userEmail?,userDisplayName?,assignedByUserId?,assignedAt,note?}` | `PUT` body `{userId, note?}`; tự động duyệt (APPROVED) thành viên; 409 nếu người đó đã gán kiosk khác cùng đợt |
| Xem kiosk đã gán cho mình | `GET /v1/me/assignments?campaignId`, `assignedDevices[]` trong `GET /v1/me/campaigns` | như trên / `DeviceDao[]` | `GET /v1/me/campaigns` trả thêm `membership{status}` |
| Thống kê chụp tự động/chụp tay | `GET /v1/campaigns/:id/stats` | `byTrigger[{key,count}]` (AUTO/GESTURE/SHUTTER/EXTERNAL), `byCaptureMode[{key,count}]` (AUTO/MANUAL/OFF) | Đã tính đúng theo P3, dữ liệu cũ gộp vào `key: null` |

---

## Màn 4 — Duyệt ảnh AI (`modules/photo-review` — màn đầy đủ nhất, đã build/wire vào app)

| Yêu cầu | Endpoint | Response fields | Ghi chú |
|---|---|---|---|
| Danh sách ảnh + tìm theo tên/lớp/ngành/CCCD/mã SV | `GET /v1/review/sets?campaignId&kindId&status&hasAi&hasUpload&missingCard&q&className&major&citizenId&subjectCode&overdue&page&limit` | `Pagination<ReviewSetListItemDao>`: `id,campaignId,subjectCode,subjectName?,kindId,kindCode?,sourceSessionId,status,currentCardVariantId?,currentCardViewUrl?,currentCardViewUrlExpiresAt?,hasAi,hasUpload,className?,major?,faculty?,citizenId?,dueAt?,overdue,createdAt,updatedAt` | Đã xác nhận **tất cả filter đều thật, khớp chính xác** (`className/major/citizenId/subjectCode` so khớp tuyệt đối; `q` chỉ tìm mờ trên `subjectCode`/`subjectName`) |
| Thống kê duyệt/không duyệt/dùng AI | `GET /v1/review/stats?campaignId&from&to&reviewerUserId` | `ReviewStatsDao`: `byStatus{...}, approved, rejected, aiEdited, uploaded, autoOnly, byReviewer[{reviewerUserId,reviewerName,approved,rejected}], avgReviewHours` | Route nằm ngay trong `review.controller.ts` (không phải module `stats` chết) — **có thật, hoạt động độc lập** với lỗi build ở đầu tài liệu |
| Xem ảnh gốc + các phiên bản | `GET /v1/review/sets/:id` | Kế thừa list item + `originalPhotos[]{id,stepId,stepType?,cameraRole?,attempt,mimeType,fsFileId?,capturedAt?}`, `videos[]`, `variants[]` (`PhotoVariantDao`), `events[]` (50 gần nhất) | — |
| Tạo lại ảnh 4x6 tự động | `POST /v1/review/sets/:id/reprocess` | `PhotoVariantDao` (variant `CARD_AUTO` mới) | Route duy nhất chạy được khi set đang khóa |
| Chọn ảnh, viết prompt gửi AI | `POST /v1/review/sets/:id/ai-edit {prompt, region?, fromVariantId?}` | `PhotoVariantDao` (variant `CARD_AI` mới) | **Không có "candidates"** — mỗi lần gọi luôn tạo đúng 1 biến thể, chưa có xem-trước-nhiều-rồi-chọn trong 1 lần gọi (phải gọi lặp lại N lần rồi tự so trong `variants[]`) |
| Xem trước rồi chọn thay | `POST /v1/review/variants/:id/accept`, `/discard`, `POST /v1/review/sets/:id/current {variantId}` | `PhotoVariantDao` / `ReviewSetListItemDao` | Không cho discard variant đang là current |
| Upload ảnh máy tính thay thế | `POST /v1/review/sets/:id/upload` (multipart field `file`, ≤20MB) | `UploadVariantResultDao{variant, identitySimilarity?, identityWarning}` | Chặn cứng nếu độ giống khuôn mặt < 0.70 (so với ảnh gốc mặt trước); cảnh báo (không chặn) nếu 0.70–0.85 |
| Duyệt / không duyệt | `POST /v1/review/sets/:id/approve`, `/reject {note?}` | `ReviewSetListItemDao` | — |
| Nhật ký | `GET /v1/review/sets/:id/events?page&limit` | `Pagination<ReviewEventDao>` | — |
| Xuất gói (bàn giao IT) | `GET /v1/review/export?campaignId&status` | Zip (ảnh + `manifest.csv`) | Chỉ admin |

---

## Màn 5 — Quản lý đợt in thẻ (`modules/print`, đã build/wire vào app, **cập nhật 2026-09-14 — P6**)

**✅ Đã có đầy đủ API**, xây dựng ngay sau khi báo cáo này được viết lần đầu (lúc đó đúng là chưa có
gì, phần cảnh báo cũ đã lỗi thời). `print_batches`/`print_items`/`print_item_events` thật, có
entity/controller/migration (`1818000000000-Print.ts`).

| Yêu cầu | Endpoint | Ghi chú |
|---|---|---|
| Danh sách ảnh + trạng thái in, gom nhóm lớp/khoa | `GET /v1/print/items?campaignId&batchId&status&className&faculty&q&page`, `GET /v1/print/items/groups?campaignId&groupBy=className\|faculty` | `groups` trả đếm theo từng trạng thái trong mỗi nhóm |
| Xem/sửa/đổi trạng thái | `GET/PATCH /v1/print/items/:id` | `PATCH` chỉ nhận `templateId?/extra?/status?` (status chỉ `CANCELLED`\|`PRINTED`, các chuyển trạng thái khác có route riêng) |
| Render + xem trước | `POST /v1/print/items/:id/render`, `GET /v1/print/items/:id/preview?side=` | Dùng lại render engine của Màn 6 (P5) |
| In lại | `POST /v1/print/items/:id/reprint` | Item gốc chuyển `REPRINT_REQUESTED`, tạo item mới |
| Thiết kế 1 người áp cho nhiều người | `POST /v1/print/items/bulk-template {itemIds\|filter, templateId}` | |
| Tạo item từ set đã duyệt | `POST /v1/print/items/bulk {setIds\|filter}` | |
| Đợt in | `GET/POST/PATCH /v1/print/batches`, `.../items`, `.../render`, `.../send`, `.../package`, `.../cancel` | `.../package` thay dần `review/export` cũ (zip PNG trước/sau + manifest.csv) |
| Print agent (DIRECT) | `GET /v1/print/queue?printerId`, `POST /v1/print/items/:id/status` | Auth bằng token máy in riêng (không qua SSO) — **chỉ có API, chưa có agent thật chạy trên máy in** (đúng quyết định D-Q8, để kỳ sau) |

## Màn 6 — Quản lý phôi in (`modules/card-template`, đã build/wire vào app, **cập nhật 2026-09-14 — P5**)

**✅ Đã có đầy đủ API**, xây dựng ngay sau khi báo cáo này được viết lần đầu (lúc đó đúng là chưa có
gì). `card_templates`/`card_template_assets` thật, render server-side (`sharp`+SVG+`bwip-js`).

| Yêu cầu | Endpoint | Ghi chú |
|---|---|---|
| Danh sách phôi (trạng thái, tên, số lượt dùng) | `GET /v1/card-templates?status&q&page` | `usageCount` là `COUNT` thật từ `print_items` (P6) |
| Tạo/sửa phôi: màu sắc, biến dữ liệu, tọa độ/kích cỡ, mặt trước/sau, logo | `POST/PATCH /v1/card-templates/:id`, `.../assets` (multipart) | Layout `front`/`back` validate bằng zod; sửa khi `ACTIVE` đã dùng thì tự tăng `version` |
| Catalog biến dữ liệu | `GET /v1/card-templates/fields` | 12 field: fullName/studentCode/citizenId/className/faculty/major/dateOfBirth/cardValidUntil/cohort/campaignCode/cardPhoto/qrPayload |
| Xem thử | `POST /v1/card-templates/:id/preview {setId\|sampleData, side}` | Trả PNG thật, render từ dữ liệu SV thật (nếu có `setId`) hoặc dữ liệu mẫu |
| Nhân bản/Publish/Lưu trữ/Xóa | `.../duplicate`, `.../publish`, `.../archive`, `DELETE :id` | Xóa chỉ khi DRAFT + chưa dùng |

## Màn 7 — Quản lý máy in (`modules/print`, đã build/wire vào app, **cập nhật 2026-09-14 — P6**)

**✅ Đã có đầy đủ API**, cùng module với Màn 5 (`printers`/`printer_stock_events`).

| Yêu cầu | Endpoint | Ghi chú |
|---|---|---|
| Danh sách máy in (tên, chế độ in, gắn ở đâu, thiết bị, số phôi còn) | `GET /v1/printers?status&campaignId&q&page` | |
| Xem/sửa | `GET/PATCH /v1/printers/:id` | Kèm hàng đợi hiện tại + 20 sự kiện phôi gần nhất |
| Cập nhật phôi (nạp/trừ) | `POST /v1/printers/:id/stock {delta,reason,note}`, `GET .../stock-events` | |
| Bật/tắt, test in, cấp token cho agent | `.../disable`, `.../enable`, `.../test-print`, `.../token`, `.../heartbeat` | Token chỉ hiện 1 lần lúc cấp (không lưu lại được) |

---

## Màn 8 — Người dùng và phân quyền (`modules/identity`, đã wire vào app)

| Yêu cầu | Endpoint | Response fields | Ghi chú |
|---|---|---|---|
| (a) Danh sách quản trị viên lấy từ service hệ thống | `GET /v1/users?q&roleCode&status&source&page&limit` | `Pagination<UserReadModel>`: `id,ssoUserCode?,email,displayName?,title?,code?,phone?,avatarFsFileId?,isAdmin,status(ACTIVE\|DISABLED),source(SSO\|MANUAL\|SYNC),roleCodes[],lastLoginAt?,createdAt` | Danh sách đọc từ Postgres nội bộ, **không lấy trực tiếp từ hệ thống ngoài** |
| Đồng bộ từ hệ thống ngoài | `POST /v1/users/sync`, `GET /v1/users/sync/status` | `UserDirectorySyncStatus{status(IDLE\|RUNNING\|SUCCESS\|FAILED),startedAt?,finishedAt?,upsertedCount,error?}` | **Chỉ là stub**: `fetch(USER_DIRECTORY_URL)` — báo lỗi ngay nếu chưa cấu hình env; field-mapping là đoán chừng, chưa có spec API thật từ trường; trạng thái chỉ lưu in-memory (mất khi restart) |
| (c) Thêm người dùng (tên/chức danh/email/mã/SĐT) + phân quyền ngay hoặc sau | `POST /v1/users {displayName, title?, email, code?, phone?, roleIds?}` | `{id}` | Khớp đúng các field yêu cầu; `roleIds` optional = "phân quyền ngay hoặc để sau" |
| Ảnh thẻ | `POST /v1/users/:id/avatar` (multipart field `file`, ≤5MB) | `{id, avatarFsFileId}` | Gọi riêng, sau khi đã có `id` user (không gộp chung với tạo user) |
| Sửa hồ sơ / khóa-mở | `PATCH /v1/users/:id {displayName?,title?,code?,phone?}`, `POST /v1/users/:id/disable`, `/enable` | `{id}` | Không sửa email qua route này |
| (b) Gán người ↔ quyền nhiều-nhiều | `PUT /v1/users/:id/roles {roleIds[]}` (thay toàn bộ) **+** `PUT /v1/roles/:id/permissions {permissionCodes[]}` (thay toàn bộ) | `SetUserRolesResult{userId,roleCodes[]}` / `RoleResult` | **Không có gán trực tiếp người↔quyền** — RBAC đi qua 2 bước: người↔vai trò, vai trò↔quyền |
| Quản lý vai trò | `GET/POST/PATCH/DELETE /v1/roles`, `GET /v1/roles/:id/users?page` | `RoleReadModel{id,code,name,description?,isSystem,permissionCodes[],userCount,createdAt,updatedAt}` | Xóa chặn nếu `isSystem` |
| (d) Danh sách quyền theo API | `GET /v1/permissions` | `PermissionReadModel[]{id,code,group,method,path,description}` | Tự sinh lúc boot từ `@RequirePermission` trên mọi controller — nhưng **`method` luôn `null`** (bug nhỏ, quét tĩnh không lấy được HTTP verb) và `path` không có tiền tố `/v1` |
| Quyền của người đang đăng nhập | `GET /v1/me/permissions` | `{isAdmin, roleCodes[], permissionCodes[]}` | — |

---

*Hết. Chi tiết field từng DTO/DAO xem đúng file nguồn được trích trong bảng trên nếu cần đối chiếu sâu hơn.*
