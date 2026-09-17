# Plan: Theo dõi người chụp/upload + Dọn màn Tạo Workflow

Ngày: 2026-09-17
Phạm vi: 2 yêu cầu mới của user, độc lập với nhau, chia làm Phase D (theo dõi
người chụp/upload) và Phase E (dọn workflow: bỏ JSON nâng cao + sửa check
roster). Đã xác nhận hướng đi qua AskUserQuestion — xem mục "Quyết định đã
chốt" ở mỗi phần.

## Nguyên tắc triển khai

Giống các phase trước trong cùng đợt việc: code trực tiếp (Sonnet), build +
test xanh mới sang phase kế, migration (nếu có) chạy thử ở dev DB, KHÔNG
commit tới khi user xác nhận test end-to-end xong.

---

## Phase D — Theo dõi "ai chụp" / "ai upload"

### D.1. Hiện trạng & nguyên nhân (đã xác minh qua đọc code, không suy đoán)

Luồng hiện tại: kiosk chụp → lưu local (SQLite outbox, `apps/desktop`) →
cron/worker upload lên `apps/api` → `apps/api` lưu Postgres + tự upload tiếp
lên file-service qua cron riêng (`UploadWorkerService`).

- `sessions.operator_user_id` **đã tồn tại** (migration
  `apps/api/src/shared/database/migrations/1796000000000-SessionOperatorUser.ts`),
  nhưng chỉ được ghi qua 1 đường: sự kiện `SESSION_REPORT` — một device-event
  được kiosk gửi **SAU KHI** operator bấm "Xác nhận & Lưu hồ sơ", theo lô/batch
  (`apps/api/src/modules/capture/services/capture-report.service.ts:119-165`,
  `applySessionReport`).
- Trong khi đó, ảnh đã được **upload lên Postgres NGAY** khi cron kiosk gửi
  từng ảnh qua `POST /v1/devices/photos` →
  `PhotoService.addDevicePhoto` (`apps/api/src/modules/capture/services/photo.service.ts:307-403`).
  Hàm này TỰ upsert một dòng `sessions` tối giản ngay tại chỗ:
  ```sql
  INSERT INTO sessions (id, source, device_id, campaign_id, status)
  VALUES ($1, 'KIOSK', $2, $3, 'IN_PROGRESS')
  ON CONFLICT (id) DO NOTHING
  ```
  (dòng 339-345) — **không hề set `operator_user_id`**.
- Hệ quả: có một khoảng thời gian ảnh đã nằm trong Postgres (và có thể đã lên
  file-service) nhưng `operator_user_id` vẫn NULL — chỉ được điền về sau nếu/khi
  `SESSION_REPORT` tới. Nếu event đó rớt, bị lỗi, hoặc kiosk cũ không gửi field
  này → NULL vĩnh viễn. Đây chính là "chưa biết ai chụp" user nói.
- Đường web (`packages/ui/src/lib/CaptureSink.ts`'s `HttpCaptureSink.startSession()`,
  dòng 217-226) POST `/v1/sessions` nhưng **không gửi `operatorUserId`** trong
  body, dù backend (`CreateSessionDto.operatorUserId`,
  `SessionService.createSession` dòng 66) đã hỗ trợ sẵn field này từ lâu — chỉ
  là chưa có ai gửi.
- Nguồn `operatorUserId` (người đang đăng nhập SSO trên kiosk) đã có sẵn ở
  `FaceCaptureAppProps.operatorUserId`
  (`packages/ui/src/components/screens/FaceCaptureApp.tsx:678`) — nhưng hiện
  chỉ được truyền vào lúc gọi `approve()` (dòng 2237), CHƯA truyền vào lúc
  chụp từng ảnh (`storePhoto`/`RunScopedCaptureSession.savePhoto()`).

### D.2. Quyết định đã chốt (AskUserQuestion)

1. **Cấp độ**: theo SESSION (dùng lại `sessions.operator_user_id` đã có,
   KHÔNG thêm cột mới per-photo).
2. **"Người upload"**: chính là operator đã chụp/duyệt — upload chỉ là
   cron chạy nền, không có "người" riêng, không cần thêm cột/khái niệm actor
   mới cho việc upload. Chỉ cần đảm bảo operator được set ĐÚNG và SỚM.
3. **Hiển thị ở**: Duyệt ảnh (Photo Review), In thẻ theo campaign, Chi tiết
   campaign (tab Sinh viên).

### D.3. Thiết kế sửa — set `operator_user_id` SỚM HƠN, ở cả 2 đường

Không cần migration Postgres mới (cột đã có). Không cần migration SQLite mới
ở kiosk (dùng lại cột `metadata` TEXT/JSON đã có trong outbox local, giống
cách `identityNumber`/`userCode` đã "đi kèm" hiện nay).

#### D.3.a — Đường kiosk (Electron)

1. `packages/ui/src/lib/CaptureSink.ts`
   - `CaptureSink` interface, `savePhoto` input (khu vực dòng 86) — thêm
     `operatorUserId?: string | null`.
   - `RunScopedCaptureSession` (class, dòng 424) — thêm tham số constructor
     thứ 3 `operatorUserId?: string | null`, lưu field private (cùng cách
     `campaignId` đã lưu, dòng 503-506).
   - `RunScopedCaptureSession.savePhoto()` (dòng 553-567) — thêm
     `operatorUserId: this.operatorUserId` vào object gửi
     `this.sink.savePhoto({...})`.
   - `ElectronCaptureSink.savePhoto()` (dòng 297-332) — thêm `operatorUserId`
     vào object `metadata` gửi `faceAPI.queueCapture` (cạnh `identityNumber`/
     `userCode` đã có, dòng 315-317).
   - `HttpCaptureSink.savePhoto()` (dòng 228) — bỏ qua field này (session
     web đã nhận operatorUserId từ `startSession`, xem D.3.b).
2. `packages/ui/src/components/screens/FaceCaptureApp.tsx:2090` —
   `new RunScopedCaptureSession(sink, props.campaignId, props.operatorUserId)`.
3. `apps/desktop/src/main/uploads.ts` (`routeUpload()`, khu vực dòng 160-190)
   — đọc `input.metadata?.operatorUserId` giống cách đang đọc
   `identityNumber`/`userCode`, đưa vào body gửi `POST /v1/devices/photos`.
4. `apps/desktop/src/main/deviceApi.ts` — `DevicePhotoInput` (dòng 12-28)
   thêm `operatorUserId?: string`.
5. `apps/api/src/modules/capture/dto/add-device-photo.dto.ts` —
   `AddDevicePhotoDto` thêm field optional:
   ```ts
   @ApiPropertyOptional({ description: 'Người vận hành (SSO) đang chụp phiên này, nếu có' })
   @IsOptional()
   @IsUUID()
   operatorUserId?: string;
   ```
6. `apps/api/src/modules/capture/services/photo.service.ts`
   (`addDevicePhoto`, dòng 339-345) — sửa câu upsert session, thêm cột
   `operator_user_id`, dùng CHÍNH pattern "không regress" đã có ở
   `capture-report.service.ts:146`:
   ```sql
   INSERT INTO sessions (id, source, device_id, campaign_id, status, operator_user_id)
   VALUES ($1, 'KIOSK', $2, $3, 'IN_PROGRESS', $4)
   ON CONFLICT (id) DO UPDATE
     SET operator_user_id = COALESCE(sessions.operator_user_id, EXCLUDED.operator_user_id)
   ```
   (giữ nguyên mọi cột khác `DO NOTHING` như cũ — chỉ thêm nhánh update cho
   riêng `operator_user_id`, tức đổi từ `DO NOTHING` sang `DO UPDATE SET
   operator_user_id = ...` mà không đụng các cột khác).

#### D.3.b — Đường web (`HttpCaptureSink`)

1. `CaptureSink.startSession` input type — thêm `operatorUserId?: string | null`.
2. `HttpCaptureSink.startSession()` (dòng 217-226) — forward field này vào
   body `POST /v1/sessions`.
3. `RunScopedCaptureSession.ensure()` (dòng 519 trở xuống) — thêm
   `operatorUserId: this.operatorUserId` vào object gửi
   `sink.startSession({...})` (dòng 526-534).
4. Backend **không cần sửa gì** — `CreateSessionDto.operatorUserId`/
   `SessionService.createSession` đã nhận và lưu field này từ trước.

#### D.3.c — Hiển thị "người chụp" trong CMS

Resolve `operator_user_id` → tên hiển thị bằng
`LEFT JOIN users u ON u.id = sessions.operator_user_id`, lấy
`COALESCE(u.display_name, u.email)` làm `operatorName`.

1. **Duyệt ảnh** — `apps/api/src/modules/photo-review/services/photo-review.service.ts`:
   list/detail hiện đã có thể join tới session qua
   `subject_photo_sets.source_session_id`
   (`apps/api/src/modules/photo-review/entities/subject-photo-set.entity.ts:56`)
   — thêm join `sessions` + `users`, expose `operatorName` trong DAO trả về.
   CMS: `apps/cms/src/photo-review/ReviewListPage.tsx` +
   `ReviewDetailPage.tsx` hiển thị "Người chụp: {operatorName}".
2. **In thẻ theo campaign** — chuỗi join cross-module (raw SQL, theo đúng
   convention hiện có, ví dụ `CampaignService.bulkCapturedCounts`):
   `print_items.setId` → `subject_photo_sets.source_session_id` →
   `sessions.operator_user_id` → `users`. Sửa
   `apps/api/src/modules/print/services/print-item.service.ts` (hàm liệt kê
   dùng cho `GET` list items theo campaign) để thêm cột `operatorName`. CMS:
   `apps/cms/src/print/CampaignPrintStatusPage.tsx` thêm cột "Người chụp".
3. **Chi tiết campaign — tab Sinh viên** — `session-list.dao.ts:122` đã có
   sẵn `operatorUserId` (uuid thô) trong response; chỉ cần thêm resolve tên
   (join `users`) ở query đang build `SessionListDao`
   (`apps/api/src/modules/capture/services/session.service.ts` — hàm list
   sessions theo campaign) + hiển thị cột ở CMS's `CampaignStudentsPanel.tsx`.

### D.4. Kiểm thử

- Backend: thêm test cho `PhotoService.addDevicePhoto`'s session-upsert set
  `operator_user_id`, và test không bị regress khi `SESSION_REPORT` tới sau
  với giá trị khác/rỗng (mirror `capture-report-persistence.spec.ts`'s test
  đã có cho chiều ngược lại).
- `packages/ui`: thêm case cho `CaptureSink.test.ts` — `operatorUserId`
  được truyền đúng vào cả `savePhoto` và `startSession`.
- Build api + cms + desktop + ui, chạy toàn bộ test suite hiện có (không
  regress).
- Live (nếu có thể): chụp thử ở kiosk dev, xác nhận `sessions.operator_user_id`
  được set ngay sau khi ảnh ĐẦU TIÊN lên Postgres — TRƯỚC khi bấm duyệt.

---

## Phase E — Dọn màn "Tạo Workflow"

### E.1. Bỏ "Cấu hình nâng cao (JSON)" (aiProcessing + printing)

File chính: `apps/cms/src/workflow/WorkflowConfigEditor.tsx`.

Hiện trạng: `RAW_JSON_GROUPS = ['aiProcessing', 'printing']` (dòng 40),
section `<h3>Cấu hình nâng cao (JSON)</h3>` (dòng 261) render 2 textarea JSON
thô cho 2 nhóm này (dòng 266-278), cùng state `rawJsonText`/`rawJsonError`
(dòng 69-72, `updateRawJsonGroup` dòng 98-107).

Sửa — xoá toàn bộ phần JSON thô, thay bằng field có cấu trúc:

- **`printing`** (`{mode: 'DIRECT'|'CENTRALIZED'}`) — 1 `<select>`:
  - "In trực tiếp tại kiosk (DIRECT)"
  - "In tập trung — CMS gom lệnh in (CENTRALIZED)"
- **`aiProcessing`** (`{enabled: boolean, steps: [{code, params?}]}`):
  - Checkbox "Bật xử lý AI".
  - Danh sách `steps` — list add/remove từng dòng: input text "Mã bước"
    (`code`, ví dụ RETOUCH/BACKGROUND_REMOVE) + textarea nhỏ JSON riêng cho
    `params` của DÒNG ĐÓ (không phải JSON cho cả nhóm — `params` vốn là
    object mở, khác nhau theo từng loại step, nên giữ JSON ở phạm vi hẹp
    nhất có thể, không xoá khả năng cấu hình được).
- Xoá `RAW_JSON_GROUPS`/`RAW_JSON_GROUP_LABEL`/state liên quan, cập nhật lại
  doc comment đầu file (đang mô tả 2 nhóm này "chưa có giao diện riêng").
- `apps/cms/src/workflow/WorkflowsPage.tsx`'s nút "Kiểm tra cấu hình" giữ
  nguyên (vẫn gọi `validateWorkflowConfig`, không phụ thuộc cách nhập).

### E.2. Sửa lỗi: mode ROSTER bỏ qua `rules[]`

File: `apps/api/src/modules/device-management/services/campaign-subject.service.ts`,
method `lookupSubject` (dòng 397-510).

Hiện trạng — nhánh `mode === 'ROSTER'` (dòng 422-431) chỉ trả `eligible: true`
nếu tìm thấy `rosterSubject` (match `subjectCode`/`citizenId` + `status = 'VALID'`),
**không hề gọi `evaluateEligibilityRules`** — `eligibility.rules[]` cấu hình
trong CMS hoàn toàn không có tác dụng ở mode ROSTER thuần (chỉ có tác dụng ở
`EXTERNAL_API`/`ROSTER_AND_API`, dòng 499-502). Đây chính là "thiếu phần
check theo dữ liệu excel được import vào" user nói.

Sửa — nhánh ROSTER dùng lại đúng cách build `context` + gọi
`evaluateEligibilityRules` mà nhánh EXTERNAL_API đã làm (dòng 488-502), chỉ
khác là KHÔNG merge thêm field nào từ API ngoài:

```ts
if (mode === 'ROSTER') {
  if (!rosterSubject) {
    return this.recordLookup(campaignId, key, mode, 'ROSTER', {
      eligible: false,
      reason: 'Không tìm thấy trong danh sách đợt này',
    });
  }
  const rules = eligibility?.rules ?? [];
  if (rules.length === 0) {
    // Không cấu hình rule nào — hành vi cũ: có trong roster là đủ.
    return this.recordLookup(campaignId, key, mode, 'ROSTER', {
      eligible: true,
      subject: rosterSubject,
    });
  }
  const context: Record<string, unknown> = {
    subjectCode: rosterSubject.subjectCode,
    fullName: rosterSubject.fullName,
    citizenId: rosterSubject.citizenId,
    className: rosterSubject.className,
    faculty: rosterSubject.faculty,
    major: rosterSubject.major,
  };
  const evaluation = evaluateEligibilityRules(rules, context);
  return this.recordLookup(campaignId, key, mode, 'ROSTER', {
    eligible: evaluation.eligible,
    reason: evaluation.reason,
    subject: rosterSubject,
    context,
  });
}
```

(Giữ nguyên hành vi khi không cấu hình rule nào — không đổi behavior mặc
định của các workflow đang chạy, chỉ kích hoạt rule khi thực sự có rule.)

### E.3. Thêm nút "Kiểm tra theo dữ liệu đã import"

Cho mode ROSTER/ROSTER_AND_API, tương tự nút "Thử" đã có của EXTERNAL_API
(`EligibilityApiFields`, `WorkflowConfigEditor.tsx` dòng 487-509 +
`testEligibilityLookup` trong `api.ts`).

**Backend** — thêm method `testRosterLookup` vào
`CampaignSubjectService` (cùng file `campaign-subject.service.ts`, cạnh
`lookupSubject`) — nhận `{campaignId, key, rules}` (rules lấy từ FORM đang
sửa, CHƯA lưu), tìm `campaign_subjects` theo `campaignId` + `key`
(subjectCode hoặc citizenId, `status = 'VALID'`), nếu có `rules` thì evaluate
giống E.2, trả `{found, subject, eligible, reason, context}`. **Không ghi
`eligibility_check_logs`** (đây là dry-run từ màn cấu hình workflow, không
phải một lượt tra cứu thật từ kiosk).

Route mới: `POST /v1/eligibility/test-roster-lookup`, thêm vào
`apps/api/src/modules/workflow/presentation/cms/eligibility.command.controller.ts`
(cùng class-level `@RequirePermission('workflow:read', ...)` với route
test-lookup hiện có) — gọi qua `CampaignSubjectService` (cần inject; kiểm
tra `WorkflowModule` có thể cần import `DeviceManagementModule`'s export
tương ứng, hoặc đặt route này trực tiếp trong `device-management` module
thay vì `workflow` module để tránh vòng phụ thuộc — quyết định cụ thể lúc
code, theo đúng nguyên tắc "không import chéo ngược" 2 module này đang giữ).

**CMS** — `apps/cms/src/api.ts` thêm `testRosterLookup(campaignId, key, rules)`.
`WorkflowConfigEditor.tsx`'s eligibility section, khi mode là
ROSTER/ROSTER_AND_API, thêm:
- `<select>` chọn Campaign (dùng lại `listCampaigns()` đã có trong `api.ts`).
- Input "Mã SV/CCCD" + nút "Thử".
- Hiển thị kết quả: `eligible: true/false`, `reason`, và roster row tìm được
  (nếu có) — cùng cách trình bày JSON preview `EligibilityApiFields` đang
  dùng cho kết quả test EXTERNAL_API.

### E.4. Kiểm thử

- Backend: unit test mới cho `lookupSubject`'s nhánh ROSTER-có-rules (2
  case: rule pass → eligible, rule fail → not eligible) + test hồi quy
  (không cấu hình rule → hành vi cũ, tìm thấy là đủ).
- Build api + cms.
- Live: import 1 roster thật vào 1 campaign dev, cấu hình workflow mode
  ROSTER + 1 rule đơn giản (ví dụ theo `className`), bấm nút "Thử" trong
  màn Tạo Workflow, xác nhận kết quả đúng với dữ liệu đã import.

---

## Tổng kết thay đổi DB

- **Không có migration Postgres mới** cho cả 2 phase — mọi cột cần dùng
  (`sessions.operator_user_id`, `workflow_versions.config` jsonb,
  `campaign_subjects`, `eligibility_check_logs`) đã tồn tại.
- **Không có migration SQLite (kiosk) mới** — dùng lại cột `metadata`
  TEXT/JSON đã có sẵn trong `upload_outbox` local.
