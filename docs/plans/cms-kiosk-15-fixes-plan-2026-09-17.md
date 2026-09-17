# Kế hoạch sửa 15 hạng mục CMS + Kiosk (2026-09-17)

> Ngày: 2026-09-17 · Trạng thái: **bản thảo để trao đổi, chưa code**
> Phạm vi: `Looka/apps/cms` (React CMS), `Looka/apps/api` (NestJS + Postgres), `Looka/apps/desktop` (Electron kiosk), `Looka/packages/ui`, `Looka/packages/camera`, `Looka/packages/database`.
> Nguồn: khảo sát trực tiếp code hiện tại (không suy từ tài liệu cũ) — 6 đợt research song song ngày 2026-09-17, đối chiếu thêm với `docs/plans/cms-8-screens-api-plan.md`, `ui-redesign-plan.md`, `multi-camera-device-management-discussion.md` để biết ý định gốc.
> Có 15 hạng mục người dùng nêu, gộp thành 6 nhóm theo khu vực code để dễ giao việc.

---

## 0. Tóm tắt điều hành

| # | Hạng mục | Loại | Hiện trạng ngắn | Mức độ việc |
|---|---|---|---|---|
| 1 | Ảnh lưu giữ chế độ gương | Đảo quyết định thiết kế cũ | `mirrorStills=false` là **chủ đích** (lý do: chữ/ngôi tóc/embedding) — **đã chốt: Phương án A, gương toàn bộ ảnh lưu** | Nhỏ |
| 2 | Quay video nhiều cam chỉ cam giữa | Bug | getUserMedia cam phụ lỗi âm thầm, không báo | Trung bình |
| 3 | Phương thức định danh → modal | UI | Đang là "swap toàn màn hình", có sẵn pattern modal khác | Nhỏ |
| 4 | Hiểu flow tạo/sửa/dùng workflow | Giải thích + UI | Flow đã chạy đúng, chỉ thiếu chỉ dẫn trực quan | Nhỏ |
| 5 | Tạo workflow chưa có cấu hình | UI + lệch thiết kế gốc | Modal tạo chỉ có code/name/description | Trung bình |
| 6 | Bỏ "Cấu hình nâng cao (JSON)" trùng | UI dọn dẹp | Trùng thật với 2/4 nhóm JSON | Trung bình |
| 7 | Điều kiện tiếp nhận: API động + test call + API key | Backend + UI lớn | Chỉ 1 client hardcode, không có URL/API key nhập được | **Lớn** |
| 8 | Màn in thẻ theo campaign + trạng thái in | UI + API nhỏ | Backend đã filter được `campaignId`, CMS chưa có màn này | Trung bình |
| 9 | Chỉ phôi/máy in "active" được chọn khi cấu hình in | UI + kiểm tra DTO | Filter có ở backend, FE dùng lệch chỗ; máy in chưa có UI chọn ở đợt in | Trung bình |
| 10 | Thêm người vào role: chọn nhiều + xem lại | UI | Chỉ chọn 1 người/lần, không có danh sách đã chọn | Nhỏ–Trung bình |
| 11 | Gộp trang Vận hành + Tổng quan | UI | 2 route riêng, dữ liệu bổ sung nhau không trùng hẳn | Trung bình |
| 12 | Filter cho các trang danh sách | UI (đa số), 1-2 chỗ cần thêm backend | Backend đã hỗ trợ nhiều filter chưa được FE dùng | Trung bình (nhiều trang nhỏ) |
| 13 | Panel "đã chụp" ở góc trái màn kiosk | UI + dữ liệu | Component có sẵn nhưng bị giấu bên phải, ẩn ở fullscreen, chỉ đọc local | Trung bình |
| 14 | Gán người vào campaign theo email | Backend nhỏ + UI | Cơ chế merge-theo-email đã có sẵn (SSO), chỉ thiếu luồng "gán trước khi có user" | Trung bình |
| 15 | Workflow setup: import Excel / gọi API — API nào, field nào | Chủ yếu là mục 7 + dọn UI | Backend Excel import đã xong, **CMS chưa có màn nào gọi tới** | Trung bình (ăn theo mục 7) |

Ước lượng theo pha thực hiện ở §4. Không có hạng mục nào phải phá schema hiện có; hai hạng mục có migration là #7 (bảng catalog API mới) và #14 (1 unique index).

---

## 1. Quy ước & quy tắc áp dụng

Kế thừa quy tắc đã chốt ở `cms-8-screens-api-plan.md` §1.1 (E1–E8), áp dụng cụ thể:

- **E1 (catalog trong DB thay vì hardcode)**: mục 7 chuyển `EligibilityCatalogService`'s mảng cứng 1 dòng thành bảng `eligibility_api_clients`.
- **E2 (adapter/registry cho tích hợp ngoài)**: mục 7 tổng quát hoá `DainamStudentInfoClient` (1 class riêng) thành 1 service thực thi HTTP chung, đọc cấu hình từ DB.
- **E5 (trạng thái là varchar + CHECK)**: không đổi enum nào hiện có (`print_items.status`, `card_templates.status`, `printers.status` giữ nguyên).
- **E6 (cột extra jsonb)**: không cần cột mới loại này cho 15 mục này.
- **E7 (bảng sự kiện append-only)**: `eligibility_check_logs` đã có, không cần thêm.
- **E8 (version bất biến)**: không đụng tới `workflow_versions` theo hướng phá vỡ tính bất biến — mục 5/6 chỉ đổi **UI nhập liệu**, không đổi cơ chế version.

**Quy ước kỹ thuật quan sát được (áp dụng khi code, không phải quy tắc mới)**:
- CMS (`apps/cms`): React 19 + `react-router-dom` v7, Tailwind v4, **không có** react-query/SWR (mỗi trang tự `useState` + `useEffect` gọi hàm trong `apps/cms/src/api.ts`), **không có** design system component (Dialog/Table tự viết bằng Tailwind), **không sync filter lên URL** (`useSearchParams` không dùng ở đâu). Phân trang dùng chung `apps/cms/src/components/Pager.tsx`.
- Modal đã có 2 pattern dùng được ngay, **ưu tiên tái dùng, không tạo pattern thứ 3**: `ModalShell` (`apps/cms/src/components/CampaignDangerActions.tsx:75`) và overlay tự viết kiểu `WorkflowsPage.tsx` (`CreateWorkflowModal`, `WorkflowDetailModal`).
- API response bọc `{ statusCode, message, data }`; danh sách phân trang `data: { items, meta }`; DTO liệt kê filter kiểu `class ListXQueryDto extends QueryPaginateDto`.
- `modules/identity` và `modules/workflow` theo DDD-lite CQRS (`application/commands|queries/{handler,...}`, `domain/aggregate`, dispatch qua CommandBus/QueryBus). `modules/device-management`, `modules/print`, `modules/card-template` theo pattern đơn giản hơn: `dao/ + entities/ + services/*.service.ts (extends CommonService<T>) + controllers/*.controller.ts` gọi trực tiếp service, không qua bus. **Code mới thêm vào module nào thì theo pattern module đó** — không trộn CQRS vào device-management.
- Kiosk (`apps/desktop` + `packages/ui`): React 19 thuần (`useState/useRef/useEffect`, không Redux/Context — `zustand` có trong `package.json` nhưng không ai import), IPC qua 1 object `window.faceAPI` (`apps/desktop/src/preload/index.ts`) bọc `ipcRenderer.invoke`.

---

## 2. Chi tiết từng hạng mục

### 2.1 Mục 1 — Ảnh chụp lưu vẫn cần chế độ gương, không lật ảnh

**Hiện trạng — đây là quyết định thiết kế có chủ đích, không phải bug**:
- Preview gương qua CSS: `packages/ui/src/components/camera/CameraPreview.tsx:15` (`CAPTURE_MIRRORED = true`, áp `scale-x-[-1]`), lặp lại ở `FrameTile.tsx:168`.
- Lúc lưu: `packages/camera/src/BrowserCameraService.ts:50` (`mirrorStills = false`), có docstring dài (dòng 36-49) giải thích rõ: ảnh lưu/upload phải là **ảnh gốc từ sensor, không gương**, vì (a) chữ/logo trong khung hình sẽ bị đảo ngược nếu gương, (b) ngôi tóc/hướng mặt thật sẽ ngược so với đời thực trên thẻ in, (c) các bước AI sau (nhận diện, embedding) không mirror-invariant. Hàm `captureBase64Snapshot()` (dòng 429-432) chỉ gương khi `this.mirrorStills === true`; có sẵn `setMirrorStills(true)` (dòng 477) nhưng **không nơi nào trong kiosk gọi**.

**Đã chốt: Phương án A — gương toàn bộ ảnh lưu (đúng nghĩa đen yêu cầu)**. Ảnh lưu trên server/dùng để in thẻ sẽ giống hệt những gì thấy trên preview (đã lật ngang), không còn bước "lật lại cho giống sensor gốc" như hiện tại.

**Cách làm**: gọi `cameraService.setMirrorStills(true)` một lần lúc khởi tạo camera trong `FaceCaptureApp.tsx` (chỗ `BrowserCameraService` được tạo) — hàm `setMirrorStills()` đã có sẵn ở `packages/camera/src/BrowserCameraService.ts:477`, chỉ cần gọi. Đổi 1 dòng, không đụng schema, không cần bảng/route mới.

**Đánh đổi đã được ghi nhận (không chặn quyết định, nhưng cần làm ở các bước sau)**:
- Chữ/logo/vật thể có hướng trong khung hình (nếu có) sẽ xuất hiện đảo ngược trên ảnh lưu và trên thẻ in thật.
- Ngôi tóc/hướng khuôn mặt trên ảnh sẽ ngược so với thực tế người được chụp.
- Pipeline AI phía sau (nhận diện khuôn mặt, embedding, OCR nếu có) hiện được viết trên giả định nhận ảnh **không gương** (đúng sensor gốc) — cần rà soát lại các bước này sau khi đổi cờ, vì embedding/mô hình nhận diện thường không mirror-invariant. Phạm vi rà soát: `services/python-ai` (mọi endpoint nhận ảnh từ kiosk) và bất kỳ bước AI nào trong `workflow_versions.config.aiProcessing`.
- Nên xoá/point lại docstring cảnh báo cũ ở `BrowserCameraService.ts:36-49` để không gây hiểu lầm cho người đọc code sau này (docstring hiện mô tả đúng hành vi cũ, cần cập nhật khi đổi cờ).

**File cần sửa**: `packages/ui/src/components/screens/FaceCaptureApp.tsx` (chỗ tạo `BrowserCameraService` — gọi `setMirrorStills(true)`), `packages/camera/src/BrowserCameraService.ts:36-49` (cập nhật lại docstring cho khớp hành vi mới).
**Test**: chưa có test cho `mirrorStills`/`captureBase64Snapshot`; cần thêm 1 test ở `packages/camera` xác nhận buffer lưu đã bị gương đúng theo cờ mới, và rà lại (nếu có) test nào đang giả định ảnh lưu không gương.
**Theo dõi sau khi triển khai**: kiểm tra thực tế 1 mẻ ảnh in thẻ + 1 mẻ chạy qua AI (nhận diện/embedding) trước khi coi mục này là xong, vì đây là thay đổi ảnh hưởng trực tiếp tới ảnh thẻ sinh viên chính thức.

---

### 2.2 Mục 2 — Chọn quay video nhiều cam nhưng chỉ cam giữa quay được

**Hiện trạng**: recording đa cam **có code**, không phải vòng lặp hardcode 1 cam — nhưng lỗi bị nuốt âm thầm:
- `packages/ui/src/lib/recordingGate.ts:55-76` — chỉ chạy nhánh multi-channel khi `multiChannelDeviceIds.length >= 2`; nếu 1 cam phụ chưa kịp enumerate/bị rớt thì rơi về nhánh single-stream (`FaceCaptureApp.tsx:3321-3503`), vốn chỉ ghi 1 stream đang active — thường là CENTER.
- Khi nhánh multi-channel chạy đúng (`FaceCaptureApp.tsx:3567-3819`): mở 1 `MediaRecorder`/cam trong vòng lặp (dòng 3660-3746). CENTER dùng `MediaStream.clone()` từ stream đang mở sẵn cho CV (dòng 3686 — luôn thành công); LEFT/RIGHT/UP/DOWN gọi `getUserMedia` mới (dòng 3689-3693) — **nếu OS/driver từ chối mở lần 2 cùng 1 thiết bị vật lý (hiện tượng đã ghi nhận ở comment dòng 400-404 cho 1 tính năng khác) thì lỗi này chỉ `console.error` (dòng 3741-3745), không set `recordingFailed`, không báo cho người vận hành.**

**Đề xuất**:
1. `FaceCaptureApp.tsx:3741-3745` — khi 1 kênh phụ `getUserMedia`/`MediaRecorder` lỗi, set `recordingFailed` (hoặc 1 state mới `partialRecordingFailure: { role, reason }`) ngay tại catch, không chỉ log — để UI báo được "cam trái/phải không quay được" thay vì im lặng.
2. Thêm log chẩn đoán (device id, `NotReadableError`/`NotAllowedError`...) để xác nhận đúng là do tranh chấp USB/driver.
3. Xem xét stagger thứ tự mở stream (mở các cam phụ trước, clone CENTER sau) hoặc thêm khoảng nghỉ nhỏ giữa các lần `getUserMedia` để giảm tranh chấp — cần thử nghiệm thực tế trên máy kiosk, không chắc chắn 100% chỉ bằng đọc code.
4. Cập nhật/thêm test ở `packages/ui/src/lib/__tests__/recordingGate.test.ts` / `recordingLiveness.test.ts` cho path lỗi từng kênh (hiện chỉ test phần gate/liveness thuần, chưa test path `getUserMedia` thất bại).

**File chính**: `packages/ui/src/components/screens/FaceCaptureApp.tsx` (dòng ~3660-3819), `packages/ui/src/lib/recordingGate.ts`.

---

### 2.3 Mục 3 — Phương thức định danh: đưa action xem/sửa/tạo vào modal

**Hiện trạng**: `apps/cms/src/workflow/IdentificationMethodsPage.tsx` — form tạo/sửa (`IdentificationMethodForm`) hiện là kiểu "thay thế toàn bộ nội dung trang" bằng `formOpen` state (dòng 31, 48-63), sao chép nguyên pattern từ `CaptureConfigurationsPage.tsx` — không phải điều hướng sang route khác, nhưng cũng không phải modal (không overlay, chiếm toàn khung trang).

**Đề xuất**: bọc `IdentificationMethodForm` bằng `ModalShell` (`apps/cms/src/components/CampaignDangerActions.tsx:75`, đã được `CardTemplatesPage.tsx` dùng) — cách nhanh nhất, đúng pattern có sẵn — hoặc dùng đúng overlay tự viết mà `WorkflowsPage.tsx`'s `CreateWorkflowModal` (dòng 213-285) đang dùng, để đồng bộ với các action khác trong cùng khu vực "workflow". Không cần đổi API.

**File cần sửa**: `apps/cms/src/workflow/IdentificationMethodsPage.tsx` (đổi cách render `formOpen` từ inline sang `<ModalShell>`).

---

### 2.4 Mục 4 — Giải thích + làm rõ flow tạo/sửa/get/dùng workflow

**Flow thực tế hiện tại (đã chạy đúng, chỉ thiếu chỉ dẫn trực quan)**:

1. **Tạo**: `WorkflowsPage.tsx` → `CreateWorkflowModal` (dòng 213-285) chỉ gửi `{code, name, description, config: DEFAULT_NEW_WORKFLOW_CONFIG}` (config mặc định tối giản, hardcode ở dòng 34-51) → `POST /v1/workflows` → tạo `Workflow` (status `DRAFT`) + `WorkflowVersion` version 1 ở trạng thái nháp.
2. **Cấu hình**: mở `WorkflowDetailModal` (dòng 287+) → `WorkflowConfigEditor` sửa `config` (chỉ sửa được khi version còn DRAFT) → "Lưu nháp" → `PUT /v1/workflows/:id/config`.
3. **Publish**: nút "Publish version N" → `POST /v1/workflows/:id/publish` → version bị đóng băng (bất biến), `Workflow.status` → `ACTIVE`, `currentVersionId` chuyển sang version mới publish.
4. **Sửa tiếp sau publish**: phải bấm "Tạo version nháp mới" → `POST /v1/workflows/:id/versions` (clone từ version đang ACTIVE) → sửa → publish lại → version tăng lên.
5. **Dùng ở campaign**: `CampaignForm.tsx` (dòng 167-188) chọn `workflowVersionId` trong danh sách workflow đã `ACTIVE`/đã publish (`workflowId` được server tự suy ra, client không gửi). Khi trả response, `CampaignService.toCampaignResponse()` (dòng 142-170) merge `config.capture.angles`/`config.output.cardSpec` của version đã pin vào response **chỉ khi cột riêng của campaign đang null** — giá trị campaign tự đặt luôn ưu tiên hơn.

**Bảng API đầy đủ**:

| Method | Path | Vai trò |
|---|---|---|
| GET | `/v1/workflows?status&q&page&limit` | danh sách |
| POST | `/v1/workflows` | tạo DRAFT + version 1 |
| GET | `/v1/workflows/:id` | chi tiết + config hiện tại |
| PATCH | `/v1/workflows/:id` | chỉ đổi tên/mô tả |
| PUT | `/v1/workflows/:id/config` | sửa config version đang nháp |
| POST | `/v1/workflows/:id/publish` | DRAFT→ACTIVE, đóng băng version |
| POST | `/v1/workflows/:id/versions` | tạo version nháp mới (clone) |
| GET | `/v1/workflows/:id/versions` | lịch sử version |
| POST | `/v1/workflows/:id/archive` | lưu trữ |
| DELETE | `/v1/workflows/:id` | xoá (chỉ khi còn DRAFT và chưa campaign nào dùng) |
| GET | `/v1/workflows/:id/usage` | campaign nào đang dùng version này |
| POST | `/v1/workflows/validate` | validate config không lưu |

**Đề xuất cải thiện UI (không đổi backend)**: thêm 1 thanh chỉ báo bước ("Nháp → Cấu hình → Publish → (version mới nếu sửa tiếp)") ngay trong `WorkflowDetailModal`, kèm tooltip/help text ngắn ở mỗi nút (đặc biệt nút "Tạo version nháp mới" — dễ hiểu lầm là tạo workflow mới). File: `apps/cms/src/workflow/WorkflowsPage.tsx`.

---

### 2.5 Mục 5 — Tạo workflow hiện chỉ tạo thông tin cơ bản, chưa cấu hình được ngay

**Xác nhận đúng, và đây là lệch so với thiết kế gốc**: `CreateWorkflowModal` (`WorkflowsPage.tsx:213-285`) chỉ thu `code/name/description`; `config` bị gán cứng `DEFAULT_NEW_WORKFLOW_CONFIG` (dòng 34-51 — góc chụp rỗng, chỉ có `MANUAL_LOOKUP`, `eligibility.mode: NONE`, AI tắt...), có comment + helper text (dòng 33, 239-241) nói rõ "sửa chi tiết sau khi tạo". Đây là **giới hạn chỉ ở UI**, không phải API: `CreateWorkflowDto.config` là field **bắt buộc** (`@IsObject()`, không `@IsOptional()`), handler lưu đúng bất kỳ config nào gửi lên — API đã sẵn sàng nhận cấu hình đầy đủ ngay lúc tạo. Đối chiếu `cms-8-screens-api-plan.md:116` §2.2 — thiết kế gốc yêu cầu màn tạo gồm cả camera/định danh/điều kiện/AI/in ngay từ đầu, không phải flow 2 bước như hiện tại.

**Đề xuất**: mở rộng `CreateWorkflowModal` thành modal lớn hơn (hoặc modal nhiều bước), nhúng luôn `WorkflowConfigEditor` (component đã có, đang dùng trong `WorkflowDetailModal`) ngay trong lúc tạo, với `config` khởi tạo từ `DEFAULT_NEW_WORKFLOW_CONFIG` làm giá trị mặc định có thể sửa trước khi submit — thay vì gửi cứng. Không cần sửa API/DB.

**File cần sửa**: `apps/cms/src/workflow/WorkflowsPage.tsx` (`CreateWorkflowModal`), tái dùng `apps/cms/src/workflow/WorkflowConfigEditor.tsx`.

---

### 2.6 Mục 6 — Bỏ "Cấu hình nâng cao (JSON)" vì đã trùng cấu hình ảnh/phiên chụp

**Xác nhận trùng — nhưng chỉ trùng 2/4 nhóm**: `WorkflowConfigEditor.tsx:161-180` hiện render JSON thô cho 4 nhóm (`RAW_JSON_GROUPS`, dòng 19): `capture`, `aiProcessing`, `output`, `printing`. Có docstring (dòng 27-39) tự nhận đây là nợ kỹ thuật.

- **`capture.angles`** (JSON thô) — **trùng thật** với component có sẵn `apps/cms/src/components/CaptureAnglesTable.tsx` (bảng góc chụp, chọn từ catalog `capture-angle-presets`), đang được `CaptureConfigurationsPage.tsx` và `CampaignForm.tsx` dùng.
- **`output.cardSpec`** (JSON thô) — **trùng thật** với `apps/cms/src/components/CardSpecFields.tsx:30-70` (kích thước/dpi/màu nền/tỉ lệ đầu-mắt/retouch — đúng khớp `cardSpecSchema` ở `apps/api/src/modules/workflow/domain/schema/workflow-config.schema.ts:113-120`), đã dùng ở `CampaignForm.tsx` và `CaptureConfigurationsPage.tsx`.
- **`aiProcessing`** và **`printing`** — **không trùng**, chưa có UI có cấu trúc nào khác trong CMS làm việc này. Nếu bỏ JSON thô ở 2 nhóm này ngay bây giờ thì sẽ **mất khả năng cấu hình**, không phải dọn trùng.

**Đề xuất**: chỉ bỏ JSON thô ở `capture` và `output`, thay bằng `<CaptureAnglesTable>` / `<CardSpecFields>` (đều là controlled component, ghép thẳng vào state `config.capture.angles` / `config.output.cardSpec`). Giữ nguyên JSON thô cho `aiProcessing`/`printing` (đánh dấu rõ trong UI là "chưa có form riêng, tạm dùng JSON") cho tới khi có yêu cầu xây form riêng cho 2 nhóm này.

**File cần sửa**: `apps/cms/src/workflow/WorkflowConfigEditor.tsx` (bỏ `capture`, `output` khỏi `RAW_JSON_GROUPS`, render 2 component có sẵn thay thế).

---

### 2.7 Mục 7 — Điều kiện tiếp nhận: cấu hình API tuỳ ý + chọn field + test call + API key

**Hiện trạng — thiếu nhiều nhất trong 15 mục**:

- Schema hiện tại (`apps/api/src/modules/workflow/domain/schema/workflow-config.schema.ts:51-101`):
  ```ts
  const eligibilitySchema = z.object({
    mode: z.enum(['NONE','ROSTER','EXTERNAL_API','ROSTER_AND_API']),
    api: z.object({
      clientCode: z.string().min(1),   // chọn từ catalog cứng, KHÔNG phải URL tự do
      keyField: z.string().min(1),
      requiredFields: z.array(z.string()).optional(),
    }).optional(),
    rules: z.array(z.object({ key, expr, message })).optional(),
    rosterTemplate: z.string().optional(),
  });
  ```
  **Không có field nào cho URL/method/header/API key** — "API" ở đây chỉ là 1 mã (`clientCode`) chọn trong danh sách cứng đúng 1 dòng (`eligibility-catalog.service.ts:32-51`, field list cũng hardcode 10 tên cột, không lấy từ response thật).
- Client gọi API thật (`apps/api/src/shared/integrations/dainam-student/student-directory.adapter.ts`) là **1 class viết sẵn 1 endpoint cố định**, `fetch(POST {baseUrl}/api/get_list_student_info)`, API key đọc từ **env `DAINAM_STUDENT_INFO_API_KEY`** (`apps/api/src/shared/config/dainam-student-info.ts:13-17`) — không lưu DB, không sửa được từ CMS.
- CMS (`WorkflowConfigEditor.tsx` §`EligibilityApiFields`, dòng 185-300) đã có: dropdown chọn client (hiện đúng 1 lựa chọn), dropdown `keyField`/checkbox `requiredFields` (đọc từ catalog cứng, không phải response thật), và **nút "Thử tra cứu 1 mã thật" đã hoạt động** (`POST /v1/eligibility/test-lookup`) hiển thị JSON response thật — nhưng chỉ gọi được đúng 1 client cứng, và field chọn ở dropdown không tự cập nhật theo response thử.
- Đối chiếu 4 ý người dùng cần:

  | Ý cần | Trạng thái |
  |---|---|
  | (a) Nhập/chọn URL endpoint | ❌ chưa có |
  | (b) Chọn field cần lấy từ response | 🟡 có UI chọn nhưng đọc danh sách field cứng, không phải field thật |
  | (c) Test call xem response mẫu | ✅ đã có, nhưng chỉ test được 1 client cố định |
  | (d) Nơi điền API key/access token | ❌ chưa có — key nằm ở env server |

- **Import Excel roster**: backend đã đầy đủ (`CampaignSubjectService.importRoster`, dùng `exceljs`; route `POST/GET /v1/campaigns/:id/subjects/imports`, `GET /v1/campaigns/subjects/import-template`) nhưng **CMS không có màn nào gọi các route này** — gap thật 100% ở frontend, không phải do đặt sai chỗ.

**Đề xuất kiến trúc — tổng quát hoá catalog theo đúng quy tắc E1/E2 đã có trong dự án** (không phải phát sinh cơ chế mới):

```sql
-- Thay EligibilityCatalogService (mảng cứng) bằng bảng thật, migrate DAINAM_STUDENT_INFO
-- thành 1 dòng seed thay vì literal trong code.
CREATE TABLE eligibility_api_clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  varchar(64) NOT NULL UNIQUE,       -- vd DAINAM_STUDENT_INFO, giữ đúng code cũ
  name                  varchar(255) NOT NULL,
  base_url              varchar(500) NOT NULL,
  request_method        varchar(10) NOT NULL DEFAULT 'POST'
                          CHECK (request_method IN ('GET','POST')),
  request_path          varchar(500) NOT NULL,             -- vd /api/get_list_student_info
  request_body_template jsonb,                             -- {{key}} thay bằng mã tra cứu lúc gọi
  auth_type             varchar(20) NOT NULL DEFAULT 'API_KEY_HEADER'
                          CHECK (auth_type IN ('NONE','API_KEY_HEADER','BEARER_TOKEN','QUERY_PARAM')),
  auth_param_name       varchar(100),                      -- vd "x-api-key" hoặc tên query param
  credential_ciphertext text,                               -- mã hoá bằng tiện ích sẵn có ở apps/api/src/shared/security
                                                             -- (đang dùng cho CCCD/PII, AES-256-GCM) — tái dùng, không viết mới
  key_response_path     varchar(200),                       -- đường dẫn field khoá trong response, vd "data.student_code"
  sample_response       jsonb,                               -- lưu response mẫu lần test gần nhất, để dựng field picker
  active                boolean NOT NULL DEFAULT true,
  created_by_user_id    uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

- `eligibilitySchema.api.clientCode` vẫn giữ nguyên tên field, nhưng giờ tham chiếu `eligibility_api_clients.code` (DB) thay vì literal TS array. `keyField`/`requiredFields` trên UI đổi nguồn dữ liệu: đọc từ `sample_response` (JSON thật lưu lại sau lần test call gần nhất) thay vì mảng cứng — nghĩa là sau khi admin bấm "test call" 1 lần, danh sách field để chọn tự cập nhật theo đúng response thật của API đó.
- Thêm 1 service thực thi HTTP **chung** (thay `student-directory.adapter.ts` bằng 1 phiên bản đọc `base_url/request_method/request_path/auth_type/credential_ciphertext` từ DB) — 1 class dùng cho mọi client, không viết riêng 1 class/API như hiện tại. Đặt trong `apps/api/src/modules/workflow/infrastructure/integrations/` theo đúng cấu trúc DDD-lite của module workflow.
- CRUD cho `eligibility_api_clients` (CMS quản lý danh sách "API tra cứu"): route mới `GET/POST/PATCH /v1/eligibility/api-clients` (thay route đọc-only `GET /v1/eligibility/api-clients` hiện có bằng CRUD đầy đủ), 1 màn CMS mới trong khu vực workflow — nhập `name/baseUrl/method/path/authType/authParamName/credential` + nút "Test call" ngay trong màn tạo/sửa client (tái dùng UI test-call đã có, chỉ đổi để gọi client bất kỳ thay vì cố định Dainam).
- **API key/token**: nhập ở form tạo/sửa `eligibility_api_clients`, mã hoá trước khi lưu bằng tiện ích AES-256-GCM đã có sẵn trong `apps/api/src/shared/security` (dùng lại nguyên utility đang mã hoá CCCD, không viết cơ chế mã hoá mới) — không hiển thị lại giá trị đã lưu ở form sửa (chỉ cho nhập mới/thay).
- **Import Excel roster (mục 15 gộp vào đây)**: xây 1 màn CMS mới (trong campaign detail hoặc trong khu vực cấu hình eligibility khi `mode` là `ROSTER`/`ROSTER_AND_API`) gọi đúng 3 route đã có sẵn ở backend — không cần route mới:
  - `GET /v1/campaigns/subjects/import-template` (tải file mẫu)
  - `POST /v1/campaigns/:id/subjects/imports` (upload)
  - `GET /v1/campaigns/:id/subjects/imports` (xem lịch sử import + lỗi từng dòng)

**File cần sửa/thêm**:
- Backend: migration mới (bảng trên), `apps/api/src/modules/workflow/infrastructure/integrations/*` (service HTTP chung), `apps/api/src/modules/workflow/presentation/cms/eligibility.*.controller.ts` (CRUD client), `apps/api/src/modules/workflow/application/eligibility-catalog.service.ts` (đổi nguồn dữ liệu từ literal sang DB).
- Frontend: `apps/cms/src/workflow/WorkflowConfigEditor.tsx` (đổi field picker đọc `sample_response`), 1 trang mới `EligibilityApiClientsPage.tsx` (CRUD client + test call), 1 màn/khu vực mới cho import Excel roster (dùng lại pattern upload nếu CMS đã có ở đâu đó, ví dụ ảnh phôi upload ở card-templates).

---

### 2.8 Mục 8 — Màn in thẻ lấy ảnh theo campaign, có trạng thái đã in/đang in/chưa in

**Hiện trạng**:
- `print_items.status` có 8 giá trị (`PENDING, RENDERED, QUEUED, PRINTING, PRINTED, FAILED, REPRINT_REQUESTED, CANCELLED`), đã có nhãn tiếng Việt ở `apps/cms/src/print/printFormat.ts:19-28` nhưng chưa gộp về 3 nhóm người dùng muốn thấy.
- Backend `GET /v1/print/items` (**đã hỗ trợ** `campaignId`, `status`, `className`, `faculty`, `q` qua `ListPrintItemsQueryDto`) — đủ để lọc theo campaign ngay, không cần sửa backend cho phần lọc.
- CMS hiện tổ chức theo **đợt in (batch)**, không theo campaign độc lập: `PrintPage.tsx` = danh sách batch; `PrintBatchDetailPage.tsx` luôn gọi `listPrintItems({batchId})` — chưa có màn gọi `listPrintItems({campaignId})` không kèm `batchId`.
- `PrintItemListItemDao` **chưa có field ảnh/thumbnail** — muốn xem ảnh phải vào preview từng item (`GET /v1/print/items/:id/preview`, render PNG).

**Đề xuất**:
1. Trang mới `apps/cms/src/print/CampaignPrintStatusPage.tsx` (route mới, ví dụ `/print/by-campaign`): chọn campaign → gọi `listPrintItems({campaignId, status?, className?, faculty?, q?, page, limit})` (route đã hỗ trợ, chỉ cần FE gọi đúng, không kèm `batchId`).
2. Cột trạng thái hiển thị rút gọn 3 nhóm bằng 1 hàm map UI-only (không đổi DB/enum) — **đã chốt: giữ đúng 3 nhóm, không tách riêng "Lỗi"**:
   - **Đã in** ← `PRINTED`
   - **Đang in** ← `QUEUED`, `PRINTING`
   - **Chưa in** ← `PENDING`, `RENDERED`, `FAILED`, `REPRINT_REQUESTED`, `CANCELLED`
3. **Sắp xếp mặc định — đã chốt (ca dùng: 1 đợt đã in xong, sau đó campaign có thêm người mới/ảnh mới cần in)**: mặc định sort theo nhóm trạng thái tăng dần **"chưa in" lên đầu** → "đang in" → "đã in" (không phải sort theo tên/thời gian tạo trước), để người vận hành luôn thấy ngay các dòng cần xử lý ở trên cùng dù danh sách đã có nhiều dòng "đã in" từ trước. Trong cùng 1 nhóm, sort phụ theo tên/mã sinh viên cho ổn định. Việc này phải làm ở **DB query** (`ORDER BY CASE status ... END, subject_code`), không phải sort ở client, vì danh sách có phân trang — sort ở client sẽ sai khi qua trang khác.
4. Thêm cột ảnh: cách rẻ nhất là thêm 1 field `thumbnailUrl` vào `PrintItemListItemDao` (resolve qua file-service bằng `variantId` đã có sẵn, không cần lưu thêm cột DB) — 1 sửa nhỏ ở DAO + service, không migration.

**File cần sửa/thêm**: `apps/api/src/modules/print/dao/print-item-list-item.dao.ts` (thêm `thumbnailUrl`), `apps/api/src/modules/print/services/print-item.service.ts` (hoặc file service tương ứng — thêm `ORDER BY` theo nhóm trạng thái mặc định khi không có `sort` khác được truyền), `apps/cms/src/print/CampaignPrintStatusPage.tsx` (mới), `apps/cms/src/print/printFormat.ts` (thêm hàm gộp nhóm trạng thái + hàm rank dùng chung cho sort), route trong `apps/cms/src/App.tsx`.

---

### 2.9 Mục 9 — Chỉ phôi/máy in đang hoạt động được chọn khi cấu hình in thẻ

**Hiện trạng — có sẵn cả 2 nửa (backend đã filter, FE dùng lệch chỗ)**:
- `card_templates.status`: `DRAFT | ACTIVE | ARCHIVED`. `GET /v1/card-templates?status=ACTIVE` **đã hỗ trợ**.
- `printers.status`: `ONLINE | OFFLINE | ERROR | DISABLED` (không có "ACTIVE" riêng). **Đã chốt (§5 Q3)**: "dùng được để chọn" = `ONLINE` **hoặc** `OFFLINE` (loại trừ `ERROR`, `DISABLED`) — máy tạm mất kết nối vẫn hợp lệ để gán trước cho đợt in, sẽ in được khi máy online lại.
- **Nơi đã làm đúng** (bằng chứng convention có thật): `apps/cms/src/components/PrintersPage.tsx:470,548` — picker "phôi mặc định" của máy in gọi `listCardTemplates({status:'ACTIVE'})`.
- **Nơi làm sai/thiếu**:
  - `PrintPage.tsx:44` (`CreateBatchModal`) và `PrintBatchDetailPage.tsx:84` (`EditBatchTemplateModal`, `ApplyTemplateModal`) gọi `listCardTemplates()` **không kèm** `status` → hiện cả DRAFT/ARCHIVED khi chọn phôi cho đợt in.
  - Chọn máy in cho đợt in: **chưa có UI nào cả** — `print_batches.printerId` đã có cột (theo entity) nhưng không có `<select>` nào trong `CreateBatchModal`/`PrintBatchDetailPage.tsx`. Cần kiểm tra thêm DTO tạo/sửa batch đã nhận `printerId` chưa trước khi code FE (đánh dấu ✅❓ cần xác nhận nhanh lúc code, khả năng cao là đã nhận vì cột đã tồn tại).

**Đề xuất**:
1. Sửa 2 chỗ gọi `listCardTemplates()` thiếu filter ở `PrintPage.tsx`/`PrintBatchDetailPage.tsx` → thêm `{status:'ACTIVE'}`, đúng convention đã có ở `PrintersPage.tsx`.
2. Thêm `<select>` chọn máy in vào `CreateBatchModal` và `PrintBatchDetailPage.tsx`, gọi `listPrinters()` rồi lọc phía client (hoặc truyền 2 giá trị `status` nếu API hỗ trợ mảng) còn `ONLINE`/`OFFLINE`, loại `ERROR`/`DISABLED` (đã chốt ở §5 Q3) — cần kiểm tra `ListPrintersQueryDto.status` có nhận nhiều giá trị (`status[]`) chưa, nếu chưa thì bổ sung.

**File cần sửa**: `apps/cms/src/print/PrintPage.tsx`, `apps/cms/src/print/PrintBatchDetailPage.tsx`.

---

### 2.10 Mục 10 — Thêm người vào role: click chưa biết đã chọn, không xem lại được danh sách đã chọn

**Hiện trạng**: `apps/cms/src/components/RolesPage.tsx`, `AddUserToRoleModal` (dòng 608-732) — tìm-và-chọn **1 người/lần** (state `selected: UserListItem | null`, dòng 622, không phải mảng/Set). Có tô màu `bg-blue-50` cho dòng đang chọn (dòng 697) nhưng **chỉ giữ được khi người đó còn nằm trong kết quả tìm kiếm hiện tại** — gõ tìm tiếp là mất dấu hiệu. Không có panel/chip nào liệt kê "đã chọn: ...". API `PUT /v1/users/:id/roles` vốn chỉ nhận theo 1 user (thay toàn bộ role của user đó), nên hiện tại buộc phải làm từng người, đúng như UI đang thể hiện — nhưng UI không hỗ trợ được kiểu "chọn nhiều rồi xác nhận 1 lần".

**Đề xuất**:
1. Đổi state từ `selected: UserListItem | null` sang `selectedIds: Set<string>` + `selectedUsers: Map<string, UserListItem>` (lưu object để hiển thị tên/email dù không còn trong trang kết quả tìm kiếm hiện tại).
2. Dòng kết quả tìm kiếm dùng checkbox thật (không chỉ tô màu nền) để trạng thái chọn rõ ràng và không phụ thuộc việc còn hiển thị trong danh sách hay không.
3. Thêm 1 panel nhỏ trong modal: "Đã chọn (N)" hiển thị chip từng người, có nút bỏ chọn từng người.
4. Nút submit: lặp gọi `PUT /v1/users/:id/roles` cho từng `id` trong `selectedIds` (client-side loop — không cần API batch mới, vì API vốn là "ghi đè toàn bộ role của 1 user" nên gọi song song nhiều user là an toàn).

**File cần sửa**: `apps/cms/src/components/RolesPage.tsx` (`AddUserToRoleModal`).

**Lưu ý liên quan**: `apps/cms/src/components/CampaignAssignmentsPanel.tsx`'s `AssignUserModal` dùng đúng pattern lỗi tương tự (single `selected`, cùng kiểu tô màu) — nhưng modal này sẽ được **thay hẳn** bởi mục 14 (chuyển sang nhập email), nên không sửa riêng theo mục 10 ở đây, tránh làm 2 lần.

---

### 2.11 Mục 11 — Gộp trang Vận hành với trang Tổng quan

**Đính chính tên trang**: "Tổng quan" = route `/` = `apps/cms/src/components/StatsOverview.tsx`; "Vận hành" = route `/dashboard` = `apps/cms/src/dashboard/DashboardPage.tsx` (tên route và tên hiển thị trên menu bị đảo ngược trực giác, dễ nhầm — sẽ nói rõ ở phần đổi menu).

**Nội dung từng trang hiện nay**:
- **Tổng quan** (`StatsOverview.tsx`): dữ liệu từ `GET /v1/campaigns/stats/summary` + `.../timeseries` (14 ngày) — KPI tổng toàn hệ thống (9-11 ô), 2 biểu đồ xu hướng, biểu đồ so sánh giữa các campaign, bảng đầy đủ tất cả campaign (mọi thời điểm).
- **Vận hành** (`DashboardPage.tsx`): dữ liệu từ `GET /v1/dashboard/kpis` (theo người đăng nhập), `.../campaigns/active`, `GET /v1/review/stats` — KPI hẹp hơn (4 ô: đã chụp/chờ duyệt/quá hạn/đã in), danh sách **chỉ campaign đang hoạt động** (có phiên trong 15 phút gần nhất) với progress bar, breakdown duyệt ảnh, và 1 biểu đồ **"Hoạt động của bạn theo ngày"** — riêng của người đang đăng nhập, khác hẳn phần còn lại (toàn hệ thống).

**Không trùng hoàn toàn — cần thiết kế lại bằng tab, không nhét chung 1 bảng**: bảng campaign ở 2 trang có cột khác nhau (tổng-mọi-lúc vs. đang-hoạt-động-kèm-quá-hạn) nên không gộp thành 1 bảng được; phần "Hoạt động của bạn" mang tính cá nhân, khác ngữ cảnh "toàn hệ thống" của phần còn lại.

**Đề xuất cấu trúc trang gộp** (route `/`, xoá route `/dashboard`, đổi hướng cũ):
- Tab "Tổng quan hệ thống": giữ nguyên nội dung `StatsOverview.tsx` + bổ sung 4 KPI hẹp của Vận hành (chờ duyệt/quá hạn/đã in) vào đúng hàng KPI hiện có.
- Tab "Đợt đang hoạt động": nội dung `DashboardPage.tsx`'s active-campaigns panel + breakdown duyệt ảnh.
- Tab "Hoạt động của tôi": biểu đồ cá nhân, giữ riêng vì khác ngữ cảnh.
- Sửa menu (`apps/cms/src/components/Layout.tsx:64-163`): xoá 2 mục "Tổng quan"/"Vận hành" riêng, còn 1 mục duy nhất (đặt tên "Tổng quan" cho đỡ nhầm) trỏ route `/`.

**File cần sửa**: `apps/cms/src/components/StatsOverview.tsx` (sáp nhập thêm tab), `apps/cms/src/dashboard/DashboardPage.tsx` (nội dung chuyển vào làm tab con, xoá file/route độc lập sau khi chuyển xong), `apps/cms/src/components/Layout.tsx`, `apps/cms/src/App.tsx` (xoá route `/dashboard` hoặc redirect sang `/`).

---

### 2.12 Mục 12 — Các trang danh sách cần filter theo loại/tên/trạng thái + filter đặc thù

Khảo sát toàn bộ trang danh sách hiện có ở CMS, đối chiếu backend đã hỗ trợ filter gì chưa được FE dùng:

| Trang | File | Filter UI hiện có | Backend đã hỗ trợ thêm | Việc cần làm |
|---|---|---|---|---|
| Campaigns | `apps/cms/src/components/CampaignList.tsx` | status, tên/mã (`q`) | `workflowId`, khoảng ngày `from/to` | Chỉ cần thêm UI — backend đã sẵn |
| Workflows | `apps/cms/src/workflow/WorkflowsPage.tsx` | status, `q` | — | Không cần làm |
| Phương thức định danh | `apps/cms/src/workflow/IdentificationMethodsPage.tsx` | `q`, "hiện cả đã tắt" | — | Không cần làm |
| Phôi thẻ | `apps/cms/src/card-templates/CardTemplatesPage.tsx` | status, `q` | — | Không cần làm |
| Đợt in (batch) | `apps/cms/src/print/PrintPage.tsx` | campaign, status | — | Thêm ô tìm theo tên/mã; **thêm `<Pager>`** — trang này đang fetch cứng `limit:50` và không hiển thị phân trang dù API đã phân trang |
| Item trong đợt in | `apps/cms/src/print/PrintBatchDetailPage.tsx` | không có filter nào | `className`, `faculty`, `status`, `q` | Backend đã có đủ 4 filter — chỉ cần thêm UI |
| Người dùng (Users) | chưa có trang riêng, chỉ có ô tìm trong `AddUserToRoleModal` | `q` | `roleCode`, `status`, `source` | **Cần xây trang Users độc lập mới** (route mới, ví dụ `/users`) — hiện chưa tồn tại |
| Roles | `apps/cms/src/components/RolesPage.tsx` | không có | route `GET /v1/roles` không nhận `@Query()` gì (catalog nhỏ, có chủ đích) | Danh mục nhỏ, đủ thì thêm filter phía client (không cần sửa backend) |
| Duyệt ảnh | `apps/cms/src/photo-review/ReviewListPage.tsx` | campaign, loại ảnh, status, `q`, 3 checkbox | `className`, `major`, `citizenId`, `subjectCode`, **`overdue`** | Backend đã có 5 filter nữa chưa dùng — nên wire thêm ít nhất `overdue` (khớp thẳng với KPI "quá hạn xử lý" ở mục 11) |
| Máy in | `apps/cms/src/components/PrintersPage.tsx` | `q`, campaign, status | — | Không cần làm (có thể thêm filter "sắp hết phôi" nhưng cần thêm field lọc ở backend trước) |

**Quy ước chung khi sửa**: không có filter nào cần thêm sync lên URL (đúng theo convention hiện tại — cả CMS không dùng `useSearchParams`), chỉ cần state cục bộ như các trang khác đang làm, gọi lại API khi filter đổi.

**Việc lớn nhất trong mục này**: trang Users hiện không tồn tại như 1 trang CMS độc lập — cần tạo mới `apps/cms/src/components/UsersPage.tsx` (route `/users`), dùng `GET /v1/users?q&roleCode&status&source&page&limit` (đã có sẵn ở backend). Trang này còn hữu ích trực tiếp cho mục 10 (thêm người vào role) và mục 14 (gán người vào campaign) vì hiện 2 nơi đó không có cách nào xem toàn bộ user hệ thống ngoài modal tìm-kiếm nhỏ.

---

### 2.13 Mục 13 — Kiosk thiếu danh sách "đã chụp" ở góc trái màn hình

**Hiện trạng — component đã có, dữ liệu đã nối, nhưng đặt sai chỗ + bị ẩn**:
- Component đúng mục đích đã tồn tại: `packages/ui/src/components/workflow/CapturedListPanel.tsx` ("ĐÃ CHỤP/ĐANG CHỤP", theo đúng tinh thần `ui-redesign-plan.md §2 S5`).
- Dữ liệu thật: `FaceCaptureApp.tsx:852-893` (`refreshRecentStudents`) đọc bảng local SQLite `captured_students` qua `CapturedStudentRepository`.
- **Gap 1 — vị trí sai**: từng là cột phải cố định, nay bị chuyển vào 1 tab ẩn ("Đã chụp") trong `<aside>` trượt ra từ bên phải (`DesktopCaptureView.tsx:1205-1213`) — không phải góc trái, không phải panel luôn hiện.
- **Gap 2 — ẩn theo mặc định + ẩn hẳn ở fullscreen**: gate bởi `showTelemetryDrawer` (mặc định `false`, dòng 145) và bị ẩn tuyệt đối khi `isFullscreen === true` (dòng 1205, có comment xác nhận chủ đích) — kiosk thật chạy fullscreen nên panel này **thực tế không bao giờ hiện** ở máy vận hành thật.
- **Gap 3 — chỉ đọc dữ liệu máy này, chưa phải "cả campaign"**: component tự ghi chú "Q19: cả campaign khi online, chỉ máy này khi offline" (dòng 42-46) nhưng code nối dữ liệu hardcode `isThisDevice: true` (dòng 864-886) — nhánh "cả campaign khi online" **chưa từng được cài**.

**Đề xuất**:
1. Tách `CapturedListPanel` ra khỏi cơ chế `showTelemetryDrawer`/`isFullscreen`-ẩn — cho hiện **luôn**, đặt cố định ở góc trái (trên hoặc dưới, theo bố cục hiện có của `DesktopCaptureView.tsx`) dạng overlay nhỏ có thể thu gọn, không phụ thuộc trạng thái fullscreen.
2. Nối "cả campaign khi online": thêm 1 kênh IPC mới (`faceAPI.listCampaignRecentCaptures`) gọi qua main process tới API server — tái dùng route đã có `GET /v1/sessions?campaignId&deviceId&from&to&state` (đã tồn tại theo `cms-8-screens-api-plan.md` §2.1, dùng cho "danh sách chụp từng kiosk"), bỏ tham số `deviceId` để lấy toàn campaign, không cần route mới. Khi offline, fallback về `listRecentStudents` (SQLite local) như hiện tại.

**File cần sửa**: `packages/ui/src/components/screens/views/DesktopCaptureView.tsx` (bố cục + bỏ điều kiện ẩn), `packages/ui/src/components/screens/FaceCaptureApp.tsx` (`refreshRecentStudents`, thêm nhánh online/offline), `apps/desktop/src/main/*` (thêm IPC handler gọi API), `apps/desktop/src/preload/index.ts` (khai báo `faceAPI.listCampaignRecentCaptures`).

---

### 2.14 Mục 14 — Gán người vào campaign theo email, không theo user hiện có

**Hiện trạng**:
- `campaign_kiosk_assignments.userId` là `uuid` bắt buộc (không có cột email, không FK — theo đúng quy ước "không FK xuyên module" đã chốt trước đây). `AssignCampaignKioskDto.userId` bắt buộc là `@IsUUID()` — **xác nhận đúng**: phải chọn 1 user đã tồn tại sẵn trong bảng `users` (qua `AssignUserModal`, cùng pattern tìm-và-chọn như mục 10).
- **Cơ chế merge-theo-email đã có sẵn, không cần xây mới**: `SsoAuthGuard.upsertUser()` (`apps/api/src/shared/auth/sso-auth.guard.ts:245-307`) — lần đầu 1 người đăng nhập SSO thật, hệ thống tìm 1 dòng `users` có `source='MANUAL'` và email khớp (không phân biệt hoa/thường), rồi **merge vào đúng dòng đó** (giữ nguyên `id`, chỉ cập nhật `ssoUserCode/email/displayName/source→'SSO'`) — nghĩa là **toàn bộ role/quyền đã gán từ trước cho email đó tự động có hiệu lực ngay khi người dùng đăng nhập lần đầu**, không cần bảng "pending invite" riêng.
- `POST /v1/users` (`CreateUserHandler`) đã có sẵn cách tạo 1 "placeholder" MANUAL user (`ssoUserCode = MANUAL:<uuid>`, `source='MANUAL'`) từ `{displayName, email, ...}`.
- **Gap cần vá trước khi dùng theo cách này**: `CreateUserHandler` chỉ check trùng `code`, **không check trùng `email`** trước khi tạo — gọi 2 lần cùng email sẽ tạo 2 dòng MANUAL trùng nhau. Cần thêm bước "tìm theo email trước, có thì dùng lại, không có mới tạo".

**Đề xuất** (không cần đổi schema `campaign_kiosk_assignments`/`campaign_members` — `userId` vẫn là uuid trỏ đúng dòng, chỉ đổi *cách lấy được `userId` đó*):

1. Migration nhỏ — chặn trùng email ở tầng DB cho dòng MANUAL:
   ```sql
   CREATE UNIQUE INDEX ux_users_email_manual_ci
     ON users (lower(email))
     WHERE source = 'MANUAL' AND email IS NOT NULL;
   ```
2. Backend: thêm bước find-or-create-by-email vào `CreateUserHandler` (hoặc 1 handler mới `FindOrCreateUserByEmailHandler` gọi lại logic tạo hiện có) — input chỉ cần `email` (+ `displayName` optional, hiện đang bắt buộc nên cần đổi thành tuỳ chọn/suy ra từ email khi chưa biết tên).
3. CMS: đổi `AssignUserModal` (`CampaignAssignmentsPanel.tsx`) từ "tìm-và-chọn user có sẵn" thành **ô nhập email** → gọi endpoint find-or-create-by-email → lấy `userId` trả về → gọi tiếp API gán hiện có (`PUT /v1/campaigns/:id/assignments/:deviceId`) như cũ, không đổi bước cuối.
4. Không cần sửa `SsoAuthGuard.upsertUser` — cơ chế merge theo email đã đúng ý cần, chỉ cần đảm bảo bước (1)+(2) không tạo trùng để merge chính xác 1-1.

**File cần sửa**: migration mới, `apps/api/src/modules/identity/application/commands/handler/create-user.handler.ts` (thêm nhánh find-by-email), `apps/api/src/modules/identity/application/commands/transfer-model/create-user.dto.ts` (`displayName` → optional), `apps/cms/src/components/CampaignAssignmentsPanel.tsx` (`AssignUserModal` → đổi thành nhập email).

---

### 2.15 Mục 15 — Workflow setup: import Excel hoặc gọi API — API nào, field nào

Đây thực chất là **phần UI còn thiếu của mục 7**, không phải nghiệp vụ tách biệt — gộp lại để không code 2 lần:

- **Nhánh Excel**: dùng khi `eligibility.mode = ROSTER` hoặc `ROSTER_AND_API`. API đã có sẵn (`POST /v1/campaigns/:id/subjects/imports` v.v., xem §2.7) — chỉ thiếu màn CMS gọi tới, sẽ làm cùng lúc với §2.7.
- **Nhánh API**: dùng khi `eligibility.mode = EXTERNAL_API` hoặc `ROSTER_AND_API`. "API nào, field nào" **không nên là câu trả lời cố định trong tài liệu** — vì sau khi làm §2.7 (bảng `eligibility_api_clients` + CRUD + test call), admin tự nhập API bất kỳ (URL/method/header/API key) trong CMS, không còn giới hạn ở 1 API dựng cứng (`DAINAM_STUDENT_INFO`) như hiện nay. Field cần lấy cũng tự chọn từ response thật sau khi bấm "test call", không phải danh sách cố định.

**Kết luận**: không có việc riêng cho mục 15 ngoài phần đã liệt kê ở §2.7 — khi §2.7 xong, mục 15 tự động được giải quyết.

---

## 3. Tổng hợp thay đổi database

| # | Bảng | Thay đổi | Hạng mục |
|---|---|---|---|
| 1 | `eligibility_api_clients` | **Bảng mới** (xem §2.7 cho DDL đầy đủ) | 7, 15 |
| 2 | `users` | Thêm `UNIQUE INDEX ux_users_email_manual_ci ON users (lower(email)) WHERE source='MANUAL'` | 14 |

Không có thay đổi DB nào khác trong 15 mục — phần lớn là UI hoặc dùng lại filter/route backend đã tồn tại.

---

## 4. Thứ tự thực hiện đề xuất

**Pha A — sửa UI nhanh, không đụng DB/API, rủi ro thấp** (làm trước, độc lập nhau, có thể chia nhiều người/agent làm song song):
- Mục 1 (đổi cờ `setMirrorStills(true)` — đã chốt Phương án A, xem §2.1), Mục 3 (modal định danh), Mục 4 (chỉ báo bước workflow), Mục 6 (bỏ JSON trùng), Mục 9 (thêm `status:'ACTIVE'` vào 2 chỗ gọi thiếu), Mục 10 (chọn nhiều + panel xem lại), Mục 12 (wire filter đã có sẵn ở backend: Campaigns, Print items trong batch, Duyệt ảnh `overdue`; thêm `<Pager>` cho `PrintPage.tsx`).

**Pha B — cần thêm chút backend hoặc màn mới, nhưng không migration**:
- Mục 2 (surface lỗi record + thử stagger), Mục 5 (mở rộng modal tạo workflow), Mục 8 (màn in theo campaign + `thumbnailUrl`), Mục 9 (thêm chọn máy in cho batch — cần xác nhận DTO), Mục 11 (gộp trang), Mục 12 (xây trang Users mới), Mục 13 (dời panel + API "cả campaign").

**Pha C — việc lớn, có migration, nên làm riêng/không xen với pha khác**:
- Mục 7 (+ mục 15 ăn theo): bảng `eligibility_api_clients`, service HTTP chung, CRUD + test call UI, mã hoá credential.
- Mục 14: migration unique index + find-or-create-by-email + đổi `AssignUserModal`.

---

## 5. Câu hỏi cần chốt trước khi code

- ~~Q1 (Mục 1)~~ — **đã chốt 2026-09-17: Phương án A** (gương toàn bộ ảnh lưu, xem §2.1 để biết đánh đổi cần theo dõi sau khi triển khai).
- ~~Q2 (Mục 8)~~ — **đã chốt 2026-09-17**: giữ đúng 3 nhóm (không tách riêng "Lỗi"); mặc định **sort "chưa in" lên đầu** danh sách (sort ở DB query, không ở client) — đúng ca dùng "1 đợt đã in xong, sau đó campaign có thêm người/ảnh mới cần in" (xem §2.8).
- ~~Q3 (Mục 9)~~ — **đã chốt 2026-09-17**: máy in "dùng được để chọn" = `ONLINE` hoặc `OFFLINE`, loại trừ `ERROR`/`DISABLED` (xem §2.9).

---

## Nguồn tham chiếu

`docs/plans/cms-8-screens-api-plan.md` (ý định gốc của màn "Cấu hình nghiệp vụ"/workflow, quy tắc E1-E8), `docs/plans/ui-redesign-plan.md` (ý định gốc `CapturedListPanel`), `docs/plans/multi-camera-device-management-discussion.md` (bối cảnh nhiều camera).
