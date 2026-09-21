# Kế hoạch 13 tính năng cập nhật + 2 lỗi chặn đường (2026-09-18)

> Ngày: 2026-09-18 · Trạng thái: **đã chốt phương án với người dùng, chưa code**
> Phạm vi: `Looka/apps/api` (NestJS + Postgres), `Looka/apps/cms` (React CMS), `Looka/apps/desktop` (Electron kiosk), `Looka/packages/ui`, `Looka/packages/database`.
> Nguồn: khảo sát trực tiếp code hiện tại bằng 4 đợt research song song ngày 2026-09-18 (luồng in, duyệt ảnh + RBAC, kiosk, và một đợt riêng để chẩn đoán lỗi màn trắng) — không suy từ tài liệu cũ. Có gọi thử API sinh viên thật để đo khối lượng dữ liệu.
> Người dùng nêu 13 hạng mục; trong quá trình khảo sát phát hiện thêm 2 lỗi đang CHẶN việc dùng thật, được đưa lên làm giai đoạn đầu tiên.
> Liên quan: `cms-8-screens-api-plan.md` (luồng in P6, phân quyền), `cms-photo-review-plan.md` (module duyệt ảnh), `cms-kiosk-15-fixes-plan-2026-09-17.md` (đợt sửa liền trước).

---

## 0. Tóm tắt điều hành

| # | Hạng mục | Loại | Hiện trạng ngắn | Mức độ việc |
|---|---|---|---|---|
| **B1** | **Duyệt thẻ ra màn trắng** | **Bug chặn** | Hợp đồng DAO sai → `TypeError` lúc render, CMS không có ErrorBoundary | **Lớn về tác động, nhỏ về code** |
| **B2** | **"Cấp quyền" bị 403** | **Bug chặn** | Tài khoản không phải admin + bảng `role_permissions` rỗng hoàn toàn | Trung bình |
| 1 | Kéo dữ liệu API ngoài về local | Backend lớn | Chưa có; campaign EXTERNAL_API không có dòng roster nào | **Lớn** |
| 2 | Tạo đợt in → nạp ảnh đã duyệt của campaign | Backend nhỏ + UI | Câu truy vấn đã có sẵn trong `bulkCreate`, chỉ thiếu đường nối | Trung bình |
| 3 | Ghi ngày xuất file .zip | Backend nhỏ | Xuất zip hiện KHÔNG ghi lại gì cả | Nhỏ–Trung bình |
| 4 | Upload kết quả danh sách đã in | Backend lớn + UI | Chưa có; có tiền lệ import roster để soi gương | **Lớn** |
| 5 | Xuất/upload chuyển status, từ chối → chờ xuất in | Backend (nhiều bẫy) | Máy trạng thái hiện thiếu một bước | Trung bình |
| 6 | Đánh dấu SV đã in xong | Backend nhỏ | Phụ thuộc hoàn toàn vào #1 | Nhỏ |
| 7 | Thống kê gom nhóm theo lớp/khoa | Backend + UI | Dữ liệu đã denormalize sẵn, thiếu endpoint gom nhóm | Trung bình |
| 8 | Cam phụ chưa hiện trên màn action | **Không phải bug** — đảo quyết định thiết kế | Chế độ tuần tự CỐ Ý không render ô cam phụ | Trung bình |
| 9 | Swap cam giữa ↔ cam góc hiển thị sai | Bug (3 lỗi chồng nhau) | Preview đọng + mapping thiếu CENTER + không broadcast | Trung bình |
| 10 | Enter/Space để chụp ảnh | Tính năng mới | Chưa có listener keydown toàn cục nào | Nhỏ–Trung bình |
| 11 | Chụp lại ghi đè ảnh cũ | Bug + mở rộng phạm vi | Chỉ ghi đè trong cùng 1 phiên; SV quay lại sau thì không | Trung bình |
| 12 | Chọn ảnh nguồn để sửa prompt tiếp | Backend + UI | `fromVariantId` bị hardcode; không trỏ được vào ảnh gốc | Trung bình |
| 13 | Duyệt ảnh chia theo phòng ban | Thiết kế mới | KHÔNG có khái niệm phòng ban ở bất kỳ đâu trong 41 bảng | **Lớn** |

Ba phát hiện làm thay đổi hẳn hình dạng kế hoạch so với cách hiểu ban đầu:

1. **Tính năng 1 và 6 thực chất là CÙNG một quyết định thiết kế.** Yêu cầu gốc
   là "kéo API về, lưu file CSV trong thư mục temp". Nhưng campaign dùng
   `EXTERNAL_API` hiện KHÔNG có dòng nào trong `campaign_subjects`, nên
   "xóa/đánh dấu SV đã in khỏi danh sách dữ liệu" (tính năng 6) không có chỗ
   nào để tác động. Chỉ khi lưu dữ liệu API vào `campaign_subjects` thì cả
   tính năng 6 lẫn tính năng 7 mới có nền để làm.

2. **Tính năng 8 không phải lỗi.** Chế độ chụp "tuần tự" (mặc định của kiosk)
   CỐ Ý không render ô cam phụ nào: `multiFrameProp` là `undefined` khi
   `simultaneousCapture === false`, nên `MultiFrameGrid` không bao giờ được
   dựng. Người dùng đã chốt: đổi thiết kế để luôn hiện ô cam phụ.

3. **Tính năng 12 nằm trên một hợp đồng API đang hỏng sẵn.** Màn duyệt khai
   báo kiểu trả về sai ở nhiều chỗ; một trong số đó chính là nguyên nhân màn
   trắng. Không sửa nền này thì không làm được tính năng 12.

### 0.1 Quyết định đã chốt với người dùng

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | Dữ liệu API lưu ở đâu | **Lưu vào bảng `campaign_subjects`**, không dùng file CSV temp |
| 1 | Phạm vi kéo về | **Lấy toàn bộ 23.992 SV**, không lọc |
| 1/13 | Lưu bao nhiêu trường | **Lưu toàn bộ** thông tin lấy được từ API hoặc Excel |
| 3/4 | Mốc ngày xuất/upload | **Mức từng thẻ** (`print_items`), không chỉ mức đợt |
| 5 | "Upload từ chối" nghĩa là gì | **Cả hai**: file sai định dạng → từ chối toàn bộ; file hợp lệ → từng dòng lỗi đẩy thẻ đó về chờ xuất in |
| 6 | Xóa SV đã in | **Đánh dấu "đã in", KHÔNG xóa** (giữ được dữ liệu cho thống kê) |
| 8 | Cam phụ | **Luôn hiện ô cam phụ, cả ở chế độ tuần tự** |
| 11 | Chụp lại | **Xóa hẳn ảnh cũ** của SV đó |
| 12 | Ảnh AI cũ | **Xóa hẳn ảnh AI cũ** |
| 13 | Chia nhóm duyệt theo gì | **Theo thông tin có sẵn trong roster** (có thì nhóm, không thì thôi) |
| 13 | Gắn người duyệt vào nhóm | **Bảng gán riêng**, giống nút "Cấp quyền" vừa làm |
| — | Phân quyền | **Nạp quyền mặc định cho các vai trò** + đổi "Cấp quyền" sang dùng permission thay vì cờ admin |
| — | Thứ tự làm | **Sửa lỗi → kiosk → dữ liệu → in ấn → duyệt ảnh** |

### 0.2 Số liệu đo được từ API sinh viên thật

Gọi thử `POST https://openapi.dainam.edu.vn/api/get_list_student_info`
(chỉ đếm số bản ghi và tên trường, không in dữ liệu cá nhân):

| Bộ lọc | HTTP | Số bản ghi | Dung lượng |
|---|---|---|---|
| Không lọc gì | 200 | **23.992** | ~21,5 MB |
| `course_year=20` | 200 | 4.907 | ~4,4 MB |
| `faculty_id=20` | 200 | 3.603 | ~3,3 MB |
| `faculty_id=20` + `course_year=20` | 200 | 754 | ~0,7 MB |

33 trường trả về: `student_id, student_code, full_name, user_code, gender,
date_of_birth, identity_number, email, email_person, phone, permanent_address,
education_system_id, education_system_name, faculty_id, faculty_name,
course_year, major_id, major_name, specialized_id, specialized_name, class_id,
class_name, ethnic, province_id, province_name, wards_id, wards_name,
nationality_id, nationality_name, status, policy_code, policy_name, behavior`.

Đáng chú ý: API **có** `class_id`/`class_name`/`faculty_id`/`faculty_name` —
đây chính là thứ tính năng 7 và 13 cần, và cũng lấp được khoảng trống
"không có danh mục lớp" đã ghi nhận ở các đợt trước.

---

## 1. Giai đoạn 1 — Sửa 2 lỗi đang chặn (làm trước tiên)

### 1.1 Lỗi màn trắng khi bấm "Duyệt" — đã xác định chính xác

`apps/cms/src/photo-review/ReviewDetailContent.tsx:157-167` thay toàn bộ state
bằng kết quả trả về của hành động:

```ts
async function withBusy(action: () => Promise<ReviewSetDetail>) {
    ...
      setSet(await action());
```

Rồi ngay dòng 169-170 và 201 truy cập các mảng chỉ có ở kiểu CHI TIẾT:

```ts
const currentVariant = set.variants.find((v) => v.id === set.currentCardVariantId) ?? null;
const sortedVariants = [...set.variants].sort((a, b) => b.version - a.version);
...
{set.originalPhotos.map((photo) => {
```

Nhưng 4 hàm được đưa vào `withBusy` đều KHÔNG trả về kiểu chi tiết:

| Hàm CMS gọi | `api.ts` khai báo trả về | Server thực tế trả về |
|---|---|---|
| `approveReviewSet` | `ReviewSetDetail` | `ReviewSetListItemDao` (`review.controller.ts:269`) |
| `rejectReviewSet` | `ReviewSetDetail` | `ReviewSetListItemDao` (`review.controller.ts:284`) |
| `setCurrentVariant` | `ReviewSetDetail` | `ReviewSetListItemDao` (`review.controller.ts:254`) |
| `reprocessReviewSet` | `ReviewSetDetail` | **`PhotoVariantDao`** — còn không phải hồ sơ |

`ReviewSetDetailDao extends ReviewSetListItemDao` và là lớp DUY NHẤT có
`originalPhotos` / `variants` / `events` (`dao/review-set.dao.ts:178-203`).
`toDao()` dùng `excludeExtraneousValues: true` nên các khóa này thực sự vắng
mặt trong JSON, không phải null.

⇒ Sau khi bấm "Duyệt": `set.variants` là `undefined` →
`TypeError: Cannot read properties of undefined (reading 'find')` → và vì
**toàn bộ CMS không có ErrorBoundary nào** (đã grep: 0 kết quả cho
`ErrorBoundary|componentDidCatch|getDerivedStateFromError`) nên cả trang trắng.

TypeScript không bắt được vì `api.ts` khai báo generic sai — `tsc --noEmit` và
`vite build` đều pass sạch. Đây đúng là lỗi chỉ xuất hiện lúc chạy.

**Cách sửa (3 lớp, làm cả 3):**

1. **Sửa hợp đồng API** — đổi 4 route `approve` / `reject` / `setCurrent` /
   `reprocess` trong `review.controller.ts` trả về `ReviewSetDetailDao` (gọi
   lại `getSet()` sau khi đổi trạng thái), và sửa kiểu khai báo tương ứng
   trong `apps/cms/src/api.ts`. Đây là cách sửa đúng gốc: màn chi tiết cần
   dữ liệu chi tiết.
2. **Phòng thủ ở CMS** — `withBusy` không tin kết quả trả về nữa mà gọi
   `getReviewSet(id)` để nạp lại, HOẶC merge an toàn. Kể cả server có sai lần
   nữa cũng không trắng màn.
3. **Thêm ErrorBoundary cho toàn CMS** — bọc `<Routes>` trong `App.tsx`. Một
   lỗi render từ nay chỉ làm hỏng 1 vùng và hiện thông báo + nút tải lại,
   không bao giờ trắng cả trang nữa. Đây là thứ đáng ra phải có từ đầu.

**Các sai lệch hợp đồng khác phát hiện cùng lúc** (không gây crash nhưng đang
âm thầm hiển thị sai — sửa luôn trong lượt này vì đang mở đúng file đó):

- `kindLabel` ← server gửi `kindCode`
- `campaignName` server KHÔNG gửi → màn chi tiết luôn hiện `campaignId` thô
- `failReason` server KHÔNG gửi → banner lỗi không bao giờ hiện lý do
- `hasFallback` server KHÔNG gửi → badge "Fallback" không bao giờ hiện
- `sourceCapturedAt` / `sourceDeviceName` KHÔNG gửi → dòng "Phiên …" luôn trống
- `ReviewEvent.actorName` ← server gửi `actorEmail` → lịch sử luôn trống tên
- `PhotoVariant.createdByName` KHÔNG gửi
- `listReviewEvents` khai báo `ReviewEvent[]` nhưng server trả `Pagination<…>`
  (chưa ai gọi, nhưng sẽ vỡ khi có người gọi)

### 1.2 Lỗi "Cấp quyền" — tài khoản không phải admin + bảng phân quyền rỗng

**Hai vấn đề chồng nhau:**

1. Khi test, lỗi `Thiếu quyền "user:read"` chứng minh
   `req.user.isAdmin === false` — vì `PermissionsGuard` fast-path
   `if (user.isAdmin) return true` ở dòng 58 trước khi kiểm tra quyền. Mà route
   "Cấp quyền" dùng `AdminRoleGuard` (`if (!req.user?.isAdmin) throw`), nên
   **chính lệnh cấp quyền cũng sẽ 403** chứ không riêng ô tìm người. Chỉ là
   ô tìm người 403 trước nên chưa nhìn thấy.
2. Bảng `role_permissions` **rỗng hoàn toàn**. Migration
   `1809000000000-CreateRbac.ts` tạo 6 vai trò (ADMIN, REVIEWER, CTSV,
   TRUYEN_THONG, HAU_CAN, IT_PRINT) nhưng **không migration nào nạp quyền cho
   vai trò nào cả** — file tự ghi rõ "This migration creates the table EMPTY".
   Nghĩa là vai trò ADMIN hiện chỉ là trang trí; chỉ cờ `users.is_admin` mới
   có tác dụng thật.

**Cách sửa:**

- **Script CLI độc lập** (không phải migration — quyết định 2026-09-21, vì
  bộ quyền theo vai trò là cấu hình vận hành có thể cần chỉnh lại, không phải
  thay đổi schema một lần) tại `apps/api/src/scripts/seed-default-role-permissions.ts`,
  chạy bằng `pnpm --filter @face/api seed:role-permissions`. Bám theo đúng
  khuôn CLI `permission dump` của dự án tham khảo
  (`NestFactory.createApplicationContext(AppModule)` + `app.get(DataSource)`
  + raw SQL) — bỏ tầng `nestjs-console` vì repo này không dùng CLI framework
  nào khác.
  Boot **app context thật** (không tự chép tay danh sách mã quyền) để
  `PermissionCatalogService.onApplicationBootstrap()` — vốn đã có sẵn trong
  `IdentityModule` — tự quét toàn bộ `@RequirePermission(...)` và nạp catalog
  thật, tránh một bản sao tay dễ lệch khi có route mới. **Đã bắt được một lỗ
  hổng thật nhờ cách này**: route `GET /v1/me/campaigns` đòi `campaign:read`
  cho người không phải admin — mã này bị bỏ sót trong bản tay ban đầu, nếu
  không phát hiện thì mọi nhân viên CTSV/HAU_CAN/IT_PRINT không phải admin sẽ
  bị 403 ngay màn hình campaign của chính họ.
  ⚠️ **Bẫy đã gặp và phải né:** (1) chạy qua `ts-node` thẳng từ `src/` bị vỡ
  vì `TypeOrmConfigService` cố định nạp entity từ `dist/*.entity.js` — hai bộ
  class khác định danh khiến `PermissionCatalogService` ném
  `EntityMetadataNotFoundError`; script phải nằm trong `src/` để `nest build`
  biên dịch cùng app, chạy qua `node dist/scripts/...` giống hệt
  `start:prod`. (2) Boot app đầy đủ kéo theo `ScheduleModule.forRoot()` (mọi
  `@Cron` trong app) — `app.close()` không đủ để tiến trình thoát (treo thật
  sự, phải kill tay để xác nhận), nên script gọi thẳng `process.exit()` ở
  cuối thay vì tin tiến trình tự thoát.
- Đổi route `POST /v1/campaigns/:id/members/grant` từ `AdminRoleGuard` sang
  `PermissionsGuard` + `@RequirePermission('campaign:write')` — đồng bộ với
  các route campaign khác (`campaign.controller.ts:65`) và cho phép CTSV cấp
  quyền mà không cần làm admin.
- Bổ sung 2 chỗ chưa chắc chắn trong DTO (đã kiểm tra là chưa với tới được từ
  UI, nhưng nên chặn): thêm `@ArrayUnique()` vào `GrantCampaignMembersDto`
  (id trùng trong 1 lần gọi → Postgres báo `ON CONFLICT DO UPDATE command
  cannot affect row a second time` → 500), và bắt lỗi FK khi `userIds` chứa id
  không tồn tại → trả 400/404 thay vì 500.

**Đã kiểm chứng là ĐÚNG, không cần sửa:** ràng buộc
`UQ_campaign_members_campaign_user UNIQUE (campaign_id, user_id)` có thật
(`1793002000000-CampaignMembers.ts:27`) nên `orUpdate([...], ['campaign_id','user_id'])`
chạy được; TypeORM 0.3.31 escape thẳng tên cột nên dạng snake_case đang dùng là
đúng; không có xung đột thứ tự route với `PATCH :id/members/:userId` (khác HTTP
verb); DTO khớp body mà CMS gửi.

---

## 2. Giai đoạn 2 — Kiosk (tính năng 8, 9, 10, 11)

> **Code đã xong 2026-09-21, chưa test trên máy thật.** Build sạch
> (`@face/ui`, `@face/desktop`, `@face/database`), test tự động không
> regression (`@face/ui`: 107/107, `@face/desktop`: 76/76). Không tự test tay
> được như Giai đoạn 1 vì cần camera thật — cần build lại app
> (`pnpm package:app:win:dir`) và test trên kiosk thật.
>
> **Hai quyết định phát sinh giữa chừng, khác với mô tả ban đầu trong plan:**
> 1. **Tính năng 8** — plan gốc viết "dựng `multiFrameProp` cho cả 2 chế độ",
>    nhưng phát hiện `hasMultiFrame` đang là biến quyết định TOÀN BỘ layout
>    (chuyển đổi Bước 5 lưới-4-cam ↔ Bước 6 gương soi). Làm đúng như plan sẽ
>    biến MỌI phiên tuần tự thành layout lưới. Đã hỏi lại người dùng, chốt
>    phương án an toàn hơn: dải xem trước nhỏ (`sidePreviewFrames`, prop MỚI
>    tách biệt hoàn toàn khỏi `multiFrame`), giữ nguyên màn gương soi.
> 2. **Tính năng 11** — phát hiện fs-core LƯU CÓ VERSION (`FsClient.updateContent`
>    tự ghi "creating a new version"), không ghi đè phẳng như plan gốc giả
>    định. Với `deleteFile` đã bị gỡ khỏi `fs-client` (fs-core từ chối DELETE
>    từ service API-key thường), **không có cách nào xóa byte cũ trên fs-core
>    trong phạm vi sửa được của repo này**. Đã hỏi lại, chốt: xóa sạch DB +
>    file local kiosk, chấp nhận bản cũ vẫn nằm ẩn trong version history của
>    fs-core (không ai truy cập được trừ khi cố tình gọi `?version=N`).

### 2.1 Tính năng 8 — luôn hiện ô cam phụ (cả chế độ tuần tự)

**Hiện trạng:** `FaceCaptureApp.tsx:3980` đặt
`multiFrameProp = simultaneousCapture ? {...} : undefined`, và
`DesktopCaptureView.tsx:174` chỉ render lưới khi `multiFrame` tồn tại. Ở chế
độ tuần tự, `openFrameStreams` cũng không bao giờ được gọi nên không có
`getUserMedia` cho cam phụ nào.

**Sửa:** tách "hiển thị ô cam phụ" khỏi "chụp đồng thời".

- Dựng `multiFrameProp` cho cả 2 chế độ, dựa trên các role đã gán trong
  `cameraRoleMapping`.
- Mở stream xem trước cho các cam phụ ở chế độ tuần tự (dùng lại
  `openFrameStreams`, bỏ điều kiện `capturePlanRef`), nhưng **không** đưa
  chúng vào kế hoạch chụp — tuần tự vẫn chụp lần lượt như cũ.
- Thêm cờ phân biệt "ô xem trước" với "ô sẽ chụp" để `FrameTile` hiện badge
  đúng và nút chụp không đòi `allSideFramesReady` ở chế độ tuần tự.

### 2.2 Tính năng 9 — swap cam giữa ↔ cam góc hiển thị sai

Có **3 lỗi riêng biệt** cùng tạo ra triệu chứng này:

**D1 — preview ở màn Setup bị đọng.** `CameraSetupScreen.tsx:711-720` dùng
ref callback inline chỉ GÁN `srcObject`, không bao giờ xóa. Khi gán camera A
sang role LEFT, `assignRole` xóa A khỏi CENTER → thẻ CENTER hiện badge "Chưa
gán camera" **nhưng video vẫn chạy luồng của A** → 2 ô hiện cùng 1 hình, 1 ô
ghi chưa gán. Sửa: đặt `srcObject = null` khi role không còn deviceId.

**D2 — mapping thiếu CENTER làm định tuyến sai toàn bộ.** `handleSave` không
kiểm tra gì (`sanitizeCameraRoleMapping` chỉ lọc theo tên role + kiểu string),
nên một lần swap dở dang lưu được mapping KHÔNG có CENTER. Khi đó
`resolveStepCamera` (`packages/ui/src/lib/multiFrame.ts:230-249`) rơi vào
nhánh cuối và chọn **LEFT** (vì `CAMERA_ROLES` bắt đầu bằng CENTER, LEFT…),
trong khi `runSimultaneousCaptureGate` chỉ đổi camera phân tích khi CENTER CÓ
mapping. Kết quả: bước FRONT chụp bằng cam trái, nhãn hiện "Camera trái".
Sửa: bắt buộc có CENTER khi lưu + biến `assignRole` thành HOÁN ĐỔI thật (2
role đổi chỗ cho nhau) thay vì xóa một bên.

**D3 — màn chụp không biết mapping đã đổi cho tới khi khởi động lại app.**
`FaceCaptureApp.tsx:3018-3026` đọc mapping đúng 1 lần lúc mount (`[]` deps),
và `camera:setRoleMapping` trong `main/index.ts:653-656` **không broadcast gì**
— khác hẳn `camera:setCbHelpVisibility` ngay bên dưới, vốn có
`webContents.send`. Sửa: thêm broadcast `camera:roleMappingChanged` + listener
ở `FaceCaptureApp` và `CampaignGate`. Đây cũng là nguyên nhân phụ của tính
năng 8.

### 2.3 Tính năng 10 — Enter/Space để chụp

Hiện **không có** listener keydown toàn cục nào trong `packages/ui/src` hay
`apps/desktop/src/renderer` (đã grep: 0 kết quả). Chỉ có 1 handler duy nhất là
`onKeyDown` của ô input ẩn cho máy quét mã trong `CccdScanWaitingScreen.tsx:789`.

**Chỗ móc vào:** thêm `useEffect` đăng ký `window.addEventListener('keydown')`
trong `FaceCaptureApp.tsx`, ngay sau `handleShutterCapture` (dòng ~2602).
KHÔNG đặt trong `DesktopCaptureView` (là view thuần, sẽ đăng ký trùng với
`MobileCaptureView`).

**Các điều kiện chặn bắt buộc** (mỗi điều kiện đều có state sẵn trong scope):

| Chặn khi | Kiểm tra |
|---|---|
| Đang gõ vào ô nhập liệu | `activeElement` là `INPUT`/`TEXTAREA`/`isContentEditable` |
| Nút đang được focus (trình duyệt tự click bằng Enter/Space rồi) | `activeElement.tagName === 'BUTTON'` |
| Không ở chế độ chụp tay | `effectiveTriggerConfig.mode !== 'OFF'` |
| Chưa bắt đầu phiên | `isWorkflowStartedRef.current` |
| Đang chờ nhận diện SV | `awaitingStudentRef.current` |
| Đang mở modal xác nhận / màn cảm ơn | `showReviewModal`, `thankYouStudent`, `isAcceptingRef` |
| Chưa đủ điều kiện chụp | lặp lại điều kiện `enabled` của `ShutterButton` |
| Phím giữ tự lặp | `e.repeat` |
| Đang có lệnh chụp chạy dở | **thêm mới** `capturingRef` — hiện `handleShutterCapture` KHÔNG có chốt chống double-fire nào |

`e.preventDefault()` cho Space chỉ gọi SAU khi qua hết các chặn, để phím Space
gõ vào ô quét mã không bị nuốt.

### 2.4 Tính năng 11 — chụp lại ghi đè ảnh cũ (đã chốt: XÓA HẲN)

**Hiện trạng có 2 đường hoàn toàn khác nhau:**

- *SV chụp lại ngay tại chỗ*, chưa có ai xen giữa → `lastCompletedSessionRef`
  còn khớp → `resume()` dùng LẠI sessionId cũ → cơ chế `ATTEMPT_SUPERSEDED`
  hoạt động, ảnh cũ bị xóa đúng.
- *SV quay lại sau* (có người khác chụp xen giữa, hoặc app đã khởi động lại)
  → `lastCompletedSessionRef` là ref trong bộ nhớ, đã mất → tạo sessionId
  **hoàn toàn mới** → toàn bộ cơ chế supersede không chạm tới, vì SQL lọc
  `WHERE session_id = ?` (`UploadOutboxRepository.ts:306-328`).

**Cái gì đang tự ghi đè sẵn:** file trên file-service (đường dẫn phẳng
`students/<CCCD>/...` — `photo.service.ts:333-342` ghi rõ là cố ý), và
`subject_photo_sets` tự trỏ sang phiên mới — TRỪ KHI hồ sơ đã `APPROVED`.

**Cái gì KHÔNG ghi đè:** dòng `photos`, dòng `sessions`, `upload_outbox` cả 2
phía, file trên máy kiosk, `captured_students`. Nguy hiểm hơn: 2 dòng `photos`
có thể cùng trỏ vào 1 `virtual_path` trong khi chỉ còn 1 bản bytes.

**Cách làm (chọn đường rẻ và an toàn nhất):** thay vì phát minh khóa supersede
mới xuyên phiên, **lưu bền ánh xạ `subjectCode → sessionId`** (hiện chỉ nằm
trong ref bộ nhớ) xuống SQLite của kiosk, rồi gọi `resume()` cho mọi SV quay
lại — không chỉ trong cùng một lượt. Toàn bộ cơ chế `ATTEMPT_SUPERSEDED` hiện
có sẽ tự phủ được cả tình huống này, không cần khóa mới, không cần đổi API,
không cần thêm loại sự kiện.

⚠️ **Rủi ro phải xử lý:** `CaptureSink.ts:445-460` cảnh báo rõ rằng dùng lại
sessionId sẽ khiến `ON CONFLICT(idem_key) DO NOTHING` **âm thầm nuốt mất ảnh
chụp lại**, trừ khi số `attempt` tiếp tục từ mốc cao nhất của phiên trước thay
vì đếm lại từ 1. Bắt buộc sửa kèm.

Thêm: nhánh `APPROVED` trong `photo-review.service.ts:2316-2322` hiện cố ý
KHÔNG tạo lại ảnh thẻ khi có phiên mới. Với quyết định "xóa hẳn ảnh cũ", nhánh
này phải ép về `PENDING_AUTO` khi là lần chụp lại có chủ đích.

**Đã triển khai 2026-09-21 — không tạo bảng SQLite mới:**

- `CapturedStudentRepository`/bảng `captured_students` **đã có sẵn** đúng
  ánh xạ `subjectCode → sessionId` cần thiết (mỗi phiên đã duyệt là 1 dòng,
  `listByStudent()` đã trả về mới nhất trước) — không cần lưu thêm gì mới.
- IPC mới `capture:getRetakeContext(subjectCode)` (`main/index.ts`): trả
  `{ sessionId, attemptOffsets }` hoặc `null`. `attemptOffsets` (mốc attempt
  cao nhất mỗi bước của phiên cũ) tính từ `UploadOutboxRepository.listBySession`
  đã có sẵn — không cần truy vấn SQL mới.
- `RunScopedCaptureSession.resume()` (`CaptureSink.ts`) nhận thêm tham số
  `attemptOffsets`, `savePhoto()` cộng offset vào `attempt` trước khi gửi —
  đây là phần xử lý bẫy `ON CONFLICT(idem_key) DO NOTHING` mà plan đã cảnh báo.
- `FaceCaptureApp.tsx`: nhánh "SV khác hẳn" gọi `getRetakeContext` trước khi
  `handleStartWorkflow`; nếu có phiên cũ thì `resume()` vào đúng sessionId đó.
  Vì phiên MỚI dùng LẠI đúng `session_id` cũ, cơ chế `ATTEMPT_SUPERSEDED`
  **có sẵn** trong `approveSessionUpload` tự động xóa ảnh cũ (DB + file local)
  khi phiên mới được duyệt — không cần logic xóa chéo-phiên mới.
- Server: `ensureSetForApprovedSession` (nhánh `existing.status === APPROVED`)
  thêm kiểm tra "có ảnh mới thật sự được chụp sau lần duyệt trước không"
  (`photos.created_at > existing.updatedAt`) để phân biệt "chụp lại thật" với
  "báo cáo trùng lặp vô hại" — chỉ ép về `PENDING_AUTO` ở trường hợp đầu,
  không phá quyết định R-Q10 cũ cho các trường hợp khác.

**Không đụng tới (ngoài phạm vi quyết định của người dùng):**
- `session_videos`/video khi chụp lại — plan gốc đã liệt đây là quyết định
  MỞ riêng ("quyết định xem có ghi đè video hay không"), người dùng chưa
  chốt cho video, nên hành vi video giữ nguyên như cũ.
- Byte ảnh cũ trên fs-core — không xóa được (xem cảnh báo ở đầu Giai đoạn 2).

---

## 3. Giai đoạn 3 — Dữ liệu roster (tính năng 1, 6, 7)

> **IMPLEMENTED 2026-09-21** — build/lint/98+ test/migration/4-way-boot xanh,
> và verify sống trên DB dev thật (server mock giả lập API Dai Nam, dedupe
> "bản đầu thắng", ngày dd/mm/yyyy, hàng đợi 2 tầng chạy hết vòng đời
> `PENDING_FETCH → FETCHING → IMPORTING → DONE`, group-stats 1-2 tầng +
> field jsonb tự phát hiện, `printed_at` sống sót qua lần kéo lại, guard
> xoá import khi có SV đã in). Khớp đúng thiết kế đã chốt bên dưới (bảng
> `campaign_subject_import_chunks`, 2 worker + 1 worker dọn kẹt, module
> `stats` giữ route feature 7) — **KHÔNG** phải bản đơn giản hoá ban đầu đã
> code nhầm rồi bỏ (1 bảng `campaign_subject_syncs` riêng + 1 job nền không
> hàng đợi); người dùng được hỏi lại và chọn viết lại đúng bản gốc.
>
> Hai lỗi thật bắt được lúc verify, đã sửa: (1) comment JSDoc chứa chuỗi
> `*/` literal đóng comment sớm, gây lỗi cú pháp dây chuyền — đúng lớp lỗi
> `1809000000000-CreateRbac.ts` từng bị trước đây; (2)
> `DataSource.query()` (bare, ngoài transaction) cho `UPDATE ... RETURNING`
> trả về tuple `[rows, rowCount]` chứ KHÔNG phải mảng phẳng — khác hẳn
> `INSERT ... RETURNING` (mảng phẳng) — làm 2 worker crash/log sai ngay khi
> boot; đã kiểm chứng thực nghiệm và sửa theo đúng mẫu
> `VariantUploadWorkerService.claimNext` sẵn có (đây là lần thứ 4 lớp lỗi
> "đọc sai hình dạng RETURNING" này xuất hiện trong repo).
>
> Khoảng trống đã biết, cố ý hoãn: khi một lần kéo API hoàn tất,
> **không** upload file JSON thô lẫn báo cáo lỗi xlsx lên file-service
> (khác `importRoster` — dòng `ERROR`/`DUPLICATE` vẫn có đủ trong
> `campaign_subjects` với `errorMessage` riêng, chỉ thiếu file tải về đẹp).
> Tính năng tự động kéo khi tạo/sửa campaign (mode chuyển vào diện đủ điều
> kiện) đã nối vào `CampaignService`, nhưng chưa test sống riêng lẻ. Route
> CMS (nút "Kéo dữ liệu", panel thống kê nhóm) chưa làm — plan này chỉ phủ
> backend. Chưa commit.

### 3.1 Tính năng 1 — kéo toàn bộ dữ liệu API về roster

**Dùng client nào:** dùng cấu hình `campaigns.eligibility_config.api` mà người
dùng ĐÃ tự điền qua CMS (URL, header, credential mã hoá AES-256-GCM), không
dùng `DainamStudentInfoAdapter` (adapter này tồn tại nhưng doc comment ghi rõ
chưa gắn với caller nào, và nó không biết cấu hình riêng của từng campaign).
`EligibilityHttpClient` hiện chỉ tra CỨU 1 người → thêm phương thức `fetchAll()`
dùng lại nguyên phần auth/transport, gửi body template nhưng bỏ tham số khoá
tra cứu. **Đã kiểm chứng trên API thật: gọi không kèm bộ lọc trả về HTTP 200
với 23.992 bản ghi trong một response** (xem §0.2).

**KHÔNG tạo bảng mới — mở rộng `campaign_subject_imports` đang có.** Lý do
bắt buộc: `campaign_subjects.import_id` là **NOT NULL** và có FK về
`campaign_subject_imports`, nên một lần kéo API *không thể* ghi dòng roster
nào nếu chưa có một dòng import. Dùng lại bảng này vừa giải quyết ràng buộc
đó, vừa giữ nguyên màn "lịch sử import" của CMS, vừa khỏi thêm bảng thứ hai
làm cùng một việc.

```sql
ALTER TABLE "campaign_subject_imports"
  ADD COLUMN "source" character varying(12) NOT NULL DEFAULT 'EXCEL',
  ADD COLUMN "source_detail" jsonb,
  ADD COLUMN "finished_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "campaign_subject_imports"
  ADD CONSTRAINT "CHK_campaign_subject_imports_source"
  CHECK ("source" IN ('EXCEL', 'EXTERNAL_API'));
```

`file_name` vẫn `NOT NULL` → lần kéo API ghi tên tổng hợp
`external-api-<iso>.json`, nhờ đó `CampaignSubjectImportDao` và bảng import
của CMS chạy y nguyên. `created_at` chính là ngày kéo (đúng tiền lệ Excel);
thêm `finished_at` vì 24.000 dòng không xong tức thì.

**Route:** `POST /v1/campaigns/:id/subjects/pulls`, guard
`SsoAuthGuard + PermissionsGuard`, quyền `campaign:write`. Trả về **ngay lập
tức** dòng import ở trạng thái `PENDING_FETCH` (202). Từ chối 409 nếu
`eligibilityConfig.mode` không phải `EXTERNAL_API`/`ROSTER_AND_API`, hoặc đã
có một lần kéo đang chạy trong vòng 5 phút (trừ khi `force: true`).

#### Kiến trúc hàng đợi 2 tầng trên Postgres

> **Quyết định 2026-09-18.** Có cân nhắc Redis + BullMQ, nhưng **chốt lại dùng
> bảng Postgres để tránh mất dữ liệu**. Lý do quyết định: BullMQ giữ công việc
> đang bay trong Redis, nên Redis mất dữ liệu (flush, restart không AOF) là mất
> job; và nếu `maxmemory-policy` không phải `noeviction` thì Redis **âm thầm
> xoá job** khi đầy bộ nhớ — import thiếu dòng mà không báo lỗi gì. Với dữ liệu
> sinh viên thì mất âm thầm là không chấp nhận được. Bảng Postgres cho cùng
> một mức song song (`SKIP LOCKED`) mà công việc nằm chung một transaction
> boundary với dữ liệu đích, và **không thêm thành phần hạ tầng nào**.
>
> Đây cũng đúng mẫu hàng đợi sẵn có của repo: `UploadWorkerService.claimNext`,
> `VariantUploadWorkerService`, `VideoUploadWorkerService`,
> `EmbeddingWorkerService` — cả 4 đều là outbox Postgres + `FOR UPDATE SKIP
> LOCKED`. Không có Redis/BullMQ ở bất kỳ `package.json` hay `docker-compose`
> nào trong repo (đã kiểm tra), nên phương án này cũng là phương án không làm
> hệ thống mọc thêm cơ chế thứ hai.

**Bảng hàng đợi mới `campaign_subject_import_chunks`:**

```sql
CREATE TABLE "campaign_subject_import_chunks" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "import_id"     uuid NOT NULL REFERENCES "campaign_subject_imports"("id") ON DELETE CASCADE,
  "campaign_id"   uuid NOT NULL,
  "chunk_no"      integer NOT NULL,
  "row_count"     integer NOT NULL,
  "payload"       jsonb NOT NULL,          -- 500 bản ghi thô
  "status"        character varying(12) NOT NULL DEFAULT 'PENDING',
  "attempts"      integer NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "last_error"    text,
  CONSTRAINT "CHK_csic_status" CHECK ("status" IN ('PENDING','PROCESSING','DONE','FAILED')),
  CONSTRAINT "UQ_csic_import_chunk" UNIQUE ("import_id", "chunk_no")
);
CREATE INDEX "IDX_csic_claim" ON "campaign_subject_import_chunks" ("status", "next_retry_at");
```

`UQ_csic_import_chunk` làm việc enqueue idempotent: đẩy lại cùng một chunk
không bao giờ tạo bản sao.

**Tầng 1 — worker LẤY dữ liệu** (`@Cron('*/5 * * * * *')`): claim một import ở
`PENDING_FETCH` bằng `SKIP LOCKED`, gọi HTTP một lần, khử trùng + tiền kiểm
trong JS, **bulk-INSERT 48 dòng chunk** (mỗi chunk 500 bản ghi), rồi chuyển
import sang `IMPORTING`. Sau bước này toàn bộ 21,5 MB đã **nằm bền trong DB**
và được thả khỏi bộ nhớ — sập tiến trình lúc này cũng không mất gì. Đây chính
là tính chất mà phương án Redis không có.

**Tầng 2 — worker GHI xuống** (`@Cron('*/2 * * * * *')`): vòng lặp
`claimNext()` y hệt `UploadWorkerService`:

```sql
UPDATE campaign_subject_import_chunks
   SET status = 'PROCESSING', attempts = attempts + 1
 WHERE id = (SELECT id FROM campaign_subject_import_chunks
              WHERE status = 'PENDING' AND next_retry_at <= now()
              ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, import_id, campaign_id, payload, attempts;
```

Mỗi chunk = **một transaction** upsert 500 dòng + cộng dồn bộ đếm của import.
Nhờ `SKIP LOCKED`, chạy bao nhiêu worker song song cũng được (nhiều instance
API cũng an toàn) — đây là chỗ "import cho nhanh" thật sự đến từ. Hằng số
`IMPORT_CHUNK_CONCURRENCY` (mặc định 4) là số vòng claim song song trong một
tick.

**Nơi worker chạy:** chỉ đăng ký trong `app-worker.module.ts`
(`SERVICE_TYPE=worker`, và `all` cho dev) — đúng host duy nhất đang giữ
`ScheduleModule.forRoot()`. Host `command`/`query` chỉ **ghi dòng import**,
không bao giờ tiêu thụ.

**Kết thúc:** chunk cuối cùng của một import chuyển `DONE` thì chính worker đó
kiểm tra "còn chunk nào chưa DONE của import này không" **trong cùng
transaction** (nên không có tranh chấp); nếu hết thì đặt import `DONE` +
`finished_at = now()`, **xoá các dòng chunk** (payload đã hết vai trò, tránh
phình bảng), rồi chạy best-effort: upload file JSON thô, upload báo cáo lỗi,
refresh snapshot.

**Retry:** chunk lỗi ghi `last_error`, `next_retry_at = now() + backoff luỹ
thừa`, quay lại `PENDING`. Quá `MAX_CHUNK_ATTEMPTS` (5) thì `FAILED`, import
kết thúc ở `DONE` nhưng `error_rows` phản ánh đúng phần thiếu — không bao giờ
treo mãi, và **không bao giờ mất âm thầm**: dòng chunk `FAILED` vẫn còn nguyên
payload trong DB để xem lại và chạy tay. Vì upsert là idempotent nên retry một
chunk đã ghi dở hoàn toàn vô hại.

**Tiến độ:** `campaign_subject_imports.total_rows/valid_rows/error_rows` do
worker cộng dồn sau mỗi chunk. CMS poll
`GET /v1/campaigns/:id/subjects/imports/:importId` như cũ — không cần route mới.

**Trạng thái import mở rộng:** `PENDING_FETCH | FETCHING | IMPORTING | DONE |
FAILED` (giá trị `PROCESSING` cũ của luồng Excel giữ nguyên để không phá dữ
liệu cũ).

Tự động kéo khi TẠO campaign không phải là một route: `CampaignService.createCampaign`
chỉ **chèn dòng import `PENDING_FETCH`** sau khi campaign đã commit — worker tự
nhặt. Không có `void promise` nào trong request. `updateCampaign` làm tương tự
khi mode *chuyển vào* diện đủ điều kiện **và** campaign chưa có dòng `VALID`.

**Chống kẹt:** một tick quét trên `LeaderCronWorker` đẩy các import `FETCHING`
quá 30 phút và các chunk `PROCESSING` quá 10 phút về lại `PENDING` (worker chết
giữa chừng). Vì tất cả đều idempotent nên tự lành, không cần thao tác tay.

**Giám sát:** thêm `importQueueDepth` (số chunk `PENDING` + `FAILED`) vào
endpoint `/v1/health` hợp nhất đã có — đứng cạnh `outboxBacklog` vốn đã đo đúng
loại chỉ số này cho hàng đợi upload.

> Lý do KHÔNG làm đồng bộ như `importRoster`: tiền lệ đó tự biện minh bằng
> "vài trăm tới vài nghìn dòng, người dùng đang ngồi chờ". 23.992 dòng và
> 21,5 MB là gấp hơn 10 lần — giữ một HTTP request mở suốt thời gian đó sẽ
> timeout ở reverse proxy trước khi xong.

**Ghi dữ liệu:**

- Map 8 trường vào cột thật đã có: `student_code→subject_code`,
  `full_name→subject_name`, `identity_number→citizen_id`,
  `class_name→class_name`, `faculty_name→faculty`, `major_name→major`,
  `date_of_birth→date_of_birth`.
- **Ghi TOÀN BỘ bản ghi thô (cả 33 trường) vào `extra` jsonb** — cột này vốn
  đã dùng để giữ các cột Excel không map được, nên đúng công dụng, không cần
  cột mới.
- Mỗi **chunk 500 dòng** (48 chunk) là một transaction, ghi bằng
  `INSERT ... ON CONFLICT (campaign_id, subject_code) WHERE status='VALID'
  DO UPDATE` với **danh sách cột liệt kê tường minh** — tuyệt đối không dùng
  `EXCLUDED.*` hay `save()` nguyên entity của TypeORM (xem bẫy CASCADE và bảng
  "Cập nhật lại" bên dưới).
- ⚠️ **Khử trùng lặp TRONG JS trước khi dựng lô.** Nếu API trả cùng một
  `student_code` hai lần trong một lô, Postgres báo `ON CONFLICT DO UPDATE
  command cannot affect row a second time` và **giết cả 500 dòng**. Bản đầu
  thắng (`VALID`), các bản sau ghi `status='DUPLICATE'`.
- **Tiền kiểm trong JS, không để Postgres ném giữa lô:** `student_code` rỗng,
  `subject_code`/`full_name`/`identity_number` quá dài → ghi `status='ERROR'`
  kèm `error_message`, **không bao giờ vứt dòng** (đúng tiền lệ Excel). Một
  dòng xấu không được rollback 499 dòng tốt.
- Cả pull **không** nằm trong một transaction duy nhất — 24.000 dòng trong một
  transaction giữ khoá hàng phút và một dòng hỏng sẽ huỷ 23.991 dòng tốt.

**Ngữ nghĩa "Cập nhật lại" — nói rõ từng trường hợp:**

| Trường hợp | Xử lý |
|---|---|
| Dòng đã có, API vẫn trả về | **UPDATE tại chỗ**, giữ nguyên `id` nên mọi thứ tham chiếu tới nó vẫn sống. `import_id` trỏ sang lần kéo mới. |
| Dòng đã có `printed_at` | **`printed_at` / `print_batch_id` / `print_result_upload_id` KHÔNG BAO GIỜ bị ghi đè** — đây là trạng thái cục bộ, không phải dữ liệu API. |
| Dòng đã có, API không còn trả về | **Giữ nguyên, không xoá.** Xoá sẽ mất lịch sử in và làm hỏng tính năng 7. `import_id` khác lần kéo mới nhất **chính là** dấu hiệu "không còn trong API" — có sẵn, không cần cột mới. |
| Trùng `student_code` trong một response | Khử trùng trong JS (xem trên). |
| `student_code` rỗng / quá dài | `status='ERROR'`, không đụng partial index (index chỉ phủ `VALID`). |

⚠️ **Bẫy CASCADE phải chặn:** `campaign_subjects.import_id` có
`ON DELETE CASCADE`. Vì mỗi lần làm mới lại trỏ toàn bộ dòng sang import mới
nhất, **xoá import mới nhất sẽ cuốn theo CẢ roster, kể cả `printed_at`**. Phải
mở rộng guard sẵn có trong `CampaignSubjectService.deleteImport` (hiện chỉ
kiểm tra session): từ chối thêm nếu có bất kỳ SV nào của import đó đã có
`printed_at IS NOT NULL`.

⚠️ **Rủi ro bộ nhớ:** response 21,5 MB parse thành object JS có thể chiếm
150–250 MB tạm thời. Không thêm thư viện stream-parse JSON chỉ cho một caller.
Kiểm soát bằng: (1) chỉ worker nền đụng tới nó, nên GC pause không thể timeout
request nào; (2) `const text = await res.text(); const records = JSON.parse(text);`
rồi thả `text` ngay; (3) **tiêu thụ kiểu huỷ dần** — `while (records.length) {
const chunk = records.splice(0, 500); … }` để mảng co lại theo tiến độ thay vì
giữ nguyên cả mảng cộng thêm một bản map thứ hai; (4) quan trọng nhất: đỉnh bộ
nhớ chỉ tồn tại trong **tầng 1**. Ghi xong 48 dòng chunk là thả hết — tầng 2
mỗi lần chỉ nạp đúng 500 bản ghi từ một dòng `payload`, nên phần ghi DB (phần
lâu nhất) chạy ở mức bộ nhớ gần như bằng phẳng.
Lối thoát nếu máy chủ thiếu RAM (ghi nhận, chưa làm): thêm
`pullChunkBy: 'faculty_id'` vào cấu hình api và lặp kéo theo từng khoa — API
có nhận `faculty_id`, khi đó tầng 1 cũng không bao giờ giữ quá ~3.600 bản ghi.

⚠️ **Phình bảng:** 24.000 dòng × 33 trường ≈ 40–60 MB mỗi campaign, và mỗi lần
làm mới UPDATE tại chỗ sinh 24.000 dead tuple. Đặt
`ALTER TABLE campaign_subjects SET (autovacuum_vacuum_scale_factor = 0.05)`
ngay trong migration.

### 3.2 Tính năng 6 — đánh dấu SV đã in (không xoá)

- Thêm cột `campaign_subjects.printed_at timestamptz null` +
  `printed_batch_id uuid null` (không FK — giữ quy ước không FK xuyên module).
- Được set khi upload kết quả in xác nhận thẻ `PRINTED` (giai đoạn 4), bằng
  raw SQL từ module print — đúng cách module này vốn đọc chéo sang
  `subject_photo_sets`.
- Tra cứu roster ở kiosk trả thêm cờ `alreadyPrinted` để nhân viên biết SV này
  đã in rồi, tránh chụp lại vô ích.
- Áp dụng cho **mọi campaign có roster**, không riêng EXTERNAL_API — vì giờ cả
  hai loại đều có dòng trong `campaign_subjects`, tách biệt ra chỉ gây khó hiểu.

### 3.3 Tính năng 7 — thống kê nhóm động theo lớp/khoa

**Truy vấn trực tiếp, KHÔNG dựng bảng thống kê.** Lý do: tối đa ~24.000 dòng
trong một campaign, `GROUP BY` một cột có index là đủ nhanh; còn "nhóm động
theo khoá jsonb bất kỳ" thì về bản chất không tiền tính được. Module `stats`
hiện có là để tính percentile theo thời gian — khác bài toán.

Hai route (đặt trong module `stats` vì cần đọc chéo `campaign_subjects` +
`subject_photo_sets` + `print_items`, không được tạo phụ thuộc vòng giữa các
module — dùng raw SQL):

- `GET /v1/campaigns/:id/stats/roster-group-fields` → danh sách trường nhóm được.
- `GET /v1/campaigns/:id/stats/roster-groups?groupBy=&secondaryGroupBy=`

#### ⚠️ Bẫy nghiêm trọng nhất của tính năng này: FAN-OUT khi JOIN

`subject_photo_sets` là unique trên **`(campaign_id, subject_code, kind_id)`** —
một campaign có 2 loại ảnh sẽ **NHÂN ĐÔI mọi con số** nếu JOIN thẳng.
`print_items` cũng sinh thêm một dòng mỗi lần in lại. Bắt buộc gom về **một
dòng mỗi `subject_code` trong CTE TRƯỚC KHI join**:

```sql
WITH roster AS (
  SELECT cs.subject_code, cs.printed_at, <GROUPEXPR> AS g
    FROM campaign_subjects cs
   WHERE cs.campaign_id = $1 AND cs.status = 'VALID'
),
sets AS (                                  -- 1 dòng / SV: KHÔNG fan-out
  SELECT subject_code,
         bool_or(status = 'APPROVED') AS approved,
         true                         AS captured
    FROM subject_photo_sets WHERE campaign_id = $1 GROUP BY subject_code
),
items AS (                                 -- 1 dòng / SV: KHÔNG fan-out
  SELECT subject_code,
         bool_or(status = 'PRINTED')        AS printed,
         bool_or(print_result = 'REJECTED') AS rejected
    FROM print_items WHERE campaign_id = $1 AND status <> 'CANCELLED'
   GROUP BY subject_code
)
SELECT r.g AS value,
       count(*)                                             AS roster_total,
       count(*) FILTER (WHERE s.captured)                   AS captured,
       count(*) FILTER (WHERE s.approved)                   AS approved,
       count(*) FILTER (WHERE s.subject_code IS NULL)       AS not_captured,
       count(*) FILTER (WHERE i.printed)                    AS printed,
       count(*) FILTER (WHERE i.rejected AND NOT i.printed) AS rejected
  FROM roster r
  LEFT JOIN sets  s ON s.subject_code = r.subject_code
  LEFT JOIN items i ON i.subject_code = r.subject_code
 GROUP BY r.g ORDER BY r.g NULLS LAST;
```

**Bắt buộc có test hồi quy** với campaign 2 loại ảnh, khẳng định `roster_total`
đúng bằng số dòng roster.

**Luôn nhóm theo `campaign_subjects`, KHÔNG theo `print_items.faculty`** — cột
sau denormalize lúc `bulkCreate` nên sau một lần làm mới roster hai bên sẽ lệch
nhau. `print_items` chỉ join để đếm trạng thái. Ghi câu này vào doc comment của
service để người sau không "sửa giúp".

#### An toàn injection + chọn trường nhóm

`groupBy` **không bao giờ được nội suy vào chuỗi SQL**. Hai tầng chặn, soi
gương `CampaignSubjectService.DISTINCT_VALUE_COLUMNS`:

1. Nếu nằm trong danh sách cột cứng (`className → cs.class_name`,
   `faculty → cs.faculty`, `major → cs.major`) → dùng tên cột hardcode.
2. Ngược lại phải nằm trong danh sách khoá đã phát hiện của campaign đó, và
   biểu thức là `cs.extra ->> $n` với khoá truyền **dưới dạng bind parameter**.
   jsonb `->>` nhận tham số, nên không có chuỗi nào lọt vào SQL text.

**Phát hiện trường nhóm được** bằng cách **lấy mẫu `LIMIT 2000`** (không quét
toàn bảng) với `jsonb_object_keys`, rồi chỉ chào những trường có
`distinct_count` trong khoảng **2–500**. Chặn trên là thứ ngăn người dùng lỡ
nhóm theo `student_id`/`email`/`identity_number` rồi sinh ra một "thống kê"
24.000 dòng; chặn dưới loại các hằng số như `nationality_name`. Kết quả cache
trong tiến trình 60 giây mỗi campaign.

Nhãn tiếng Việt lấy từ một map nhỏ cho 33 khoá API đã biết (`faculty_name`→Khoa,
`class_name`→Lớp, `course_year`→Khóa, `major_name`→Ngành,
`education_system_name`→Hệ đào tạo, `province_name`→Tỉnh/TP…), không khớp thì
hiện nguyên khoá. Đây đúng tinh thần "có thông tin gì thì nhóm theo cái đó".

`secondaryGroupBy` tối đa 2 tầng, từ chối 400 khi
`distinct(g) × distinct(g2) > 5000`.

**Index:** `(campaign_id, class_name)` và `(campaign_id, faculty)` partial
`WHERE status='VALID'`. `IDX_subject_photo_sets_unique` đã phủ CTE `sets`.
`print_items` **hiện KHÔNG có index nào trên `subject_code`** → phải thêm
`IDX_print_items_campaign_subject (campaign_id, subject_code)`; index này phục
vụ cả tính năng 4 (khớp dòng file upload) lẫn tính năng 7.
Không đặt GIN index trên `extra`: nhóm cần biểu thức `extra->>'key'` mà GIN
không phục vụ được, và 24.000 dòng seq scan chỉ ~40–120 ms.

CMS: panel thống kê trong `CampaignPrintStatusPage.tsx` với dropdown chọn
trường nhóm + tầng thứ hai tuỳ chọn + nút xuất CSV.

---

## 4. Giai đoạn 4 — Luồng in ấn (tính năng 2, 3, 4, 5)

> **IMPLEMENTED 2026-09-21** — build/lint/297 tests (179 chạy, 0 fail)/
> migration/4-way-boot xanh, và verify sống trên DB dev thật đúng đủ 7 nhóm
> trong checklist §6 của plan này (tạo đợt → nạp tự động → xuất gói → GET
> không đóng dấu còn POST có đóng dấu → hoàn tất đợt → upload kết quả với
> cả dòng in-được/lỗi/không khớp/trạng-thái-lạ → xác nhận thẻ lỗi về
> RENDERED chứ không FAILED và vẫn giữ chỗ chống tạo trùng → bộ đếm khớp
> COUNT thật → đợt DONE tự mở lại READY khi có thẻ lỗi upload sau).
>
> `send()` bị tách làm 3 route rõ ràng theo đúng Bẫy 4: `POST .../send`
> nay CHỈ còn cho DIRECT (400 nếu gọi trên đợt CENTRALIZED), `POST
> .../package` (mới, khác `GET .../package` vốn giữ nguyên chỉ đọc) là
> "Xuất gói", `POST .../complete` (mới) là "Hoàn tất đợt". `bulkCreate` trả
> thêm `createdIds`; `ListPrintItemsQueryDto` có thêm `unassigned=true`
> (feature 2's "chưa thuộc đợt nào").
>
> Route upload kết quả in nằm ở controller riêng (`PrintResultImportController`,
> prefix `print` trần) vì `GET /v1/print/result-template` không nằm dưới
> `print/batches` hay `print/items` — cùng quy ước "nhiều controller dùng
> chung không gian `print/*`" `PrintAgentController` đã có sẵn.
>
> Khoảng trống đã biết, cố ý hoãn: chưa có UI CMS cho bất kỳ route mới nào
> (nút Xuất gói/Hoàn tất/Upload kết quả, cột "Ngày xuất"/"Ngày upload") —
> plan này chỉ phủ backend, giống Giai đoạn 3. Việc test sống dùng item ở
> trạng thái RENDERED được set thẳng bằng SQL (không gọi render() thật) vì
> máy render ảnh thẻ không đổi ở giai đoạn này và đã được verify kỹ ở P5/P6
> — phần dưới kiểm thử là máy trạng thái đợt/thẻ, không phải bản thân việc
> render.
>
> Sửa 1 sai lệch tài liệu phát hiện lúc verify: DAO/entity ban đầu mô tả
> `unmatchedRows` chỉ là "không khớp mã SV", nhưng code thực tế còn gộp cả
> dòng "khớp mã SV nhưng không hiểu giá trị trạng thái in" vào cùng bộ đếm
> này (một dòng có thể vừa tính vào `matchedRows` vừa vào `unmatchedRows`)
> — đã sửa lại doc comment cho khớp hành vi thật thay vì đổi hành vi.

### 4.0 Trạng thái mới và cách gỡ từng bẫy

Thêm **một** giá trị trạng thái thẻ: `EXPORTED` ("đã xuất, chờ kết quả in"),
chèn giữa `RENDERED` và `PRINTED`. Migration phải sửa cả CHECK constraint
`CHK_print_items_status` lẫn hằng số `PRINT_ITEM_STATUSES`.

Máy trạng thái sau khi sửa:

```
PENDING --render--> RENDERED --xuất gói--> EXPORTED --upload "đã in"--> PRINTED
                       ^                       |
                       |                       +-- upload "lỗi/từ chối" --+
                       +-------------------------------------------------+
                                (quay về chờ xuất in, kèm error_message)
```

**Bẫy 1 — `UQ_print_items_set_id_active`:** chỉ mục unique có điều kiện
`WHERE status NOT IN ('CANCELLED','FAILED','REPRINT_REQUESTED')`
(`1818000000000-Print.ts:185-187`). Thẻ bị từ chối quay về `RENDERED` chứ
**không** về `FAILED`. `RENDERED` không nằm trong
`PRINT_ITEM_INACTIVE_STATUSES` nên vẫn **giữ chỗ** của SV đó → lần tạo hàng
loạt sau không thể âm thầm tạo thẻ trùng. Dấu vết "đã lỗi một lần" nằm ở
`error_message` + một dòng `print_item_events`, không cần mượn trạng thái
`FAILED` để ghi nhớ. `EXPORTED` cũng **không** được thêm vào danh sách INACTIVE
(SV đang trong quá trình in thì vẫn giữ chỗ).

**Bẫy 2 — `printedAt` và quy tắc BA #14** ("chỉ print-agent hoặc thao tác tay,
không bao giờ suy luận"): upload kết quả là **một con người khẳng định** thẻ đã
in thật, không phải hệ thống suy luận — nên vẫn đúng tinh thần BA #14. Ghi
nhận minh bạch bằng nguồn sự kiện riêng.

**Bẫy 3 — CHECK trên `print_item_events.source`:** thêm nguồn `RESULT_UPLOAD`
thay vì mượn `MANUAL`, để truy vết phân biệt được "người bấm tay từng thẻ" với
"người upload file kết quả".
⚠️ **Cột `source` đang là `character varying(12)`** (`1818000000000-Print.ts:198`),
mà `RESULT_UPLOAD` dài 13 ký tự. Chỉ nới CHECK thôi sẽ sinh lỗi runtime
`value too long` trông y như migration CHECK hỏng. **Phải nới cả cột**
(`ALTER COLUMN "source" TYPE character varying(16)`) trong cùng migration.

**Bẫy 4 — đợt CENTRALIZED nhảy thẳng `DONE`:** tách hai việc đang bị gộp. Nút
hiện tại "Hoàn tất, xuất gói" tách thành **"Xuất gói"** (đóng dấu ngày xuất,
thẻ `RENDERED → EXPORTED`) và **"Hoàn tất đợt"** (`→ DONE` thủ công). Khi
upload đẩy thẻ về `RENDERED`, nếu đợt đang `DONE` thì mở lại thành **`READY`**
(không phải `PRINTING`) và xoá `doneAt` — vì `send()` vốn đã nhận `READY`, nên
xuất lại chạy được ngay. `sentAt` giữ nguyên làm lịch sử. Lần upload sau mà
không còn thẻ nào dở dang thì đặt lại `DONE` + `doneAt = now()`.
Route upload **không** gọi `assertEditable` — nó là hành động vòng đời như
`send()`/`cancel()`, không phải thao tác sửa
(`EDITABLE_BATCH_STATUSES = ['DRAFT','READY']` chỉ để chặn người dùng sửa tay).

**Bẫy 5 — bộ đếm lệch:** `printed_count`/`failed_count`/`item_count` là bộ đếm
duy trì thủ công, không phải aggregate. Sau mỗi lần upload, **tính lại** bằng
một câu `COUNT` trong cùng transaction, thay vì `increment` 500 lần. Vừa đúng,
vừa tự chữa phần đã lệch từ trước.

**Bẫy 6 — đóng dấu ngày trên GET:** **thêm** `POST /v1/print/batches/:id/package`
(quyền `print-batch:write`) làm đường xuất-có-đóng-dấu, và **giữ nguyên**
`GET .../package` (quyền `print-batch:read`) làm đường tải lại thuần đọc.
Đóng dấu trên GET là sai vì trình duyệt prefetch, retry và chia sẻ link đều
bắn GET. Giữ cả hai để tải lại file cũ không làm sai mốc ngày. CMS
`downloadPrintBatchPackage` vốn đã tự `fetch` + parse `Content-Disposition`
nên thêm hàm POST song sinh là việc nhỏ.

### 4.1 Tính năng 2 — chọn campaign là nạp luôn ảnh đã duyệt

Câu truy vấn **đã tồn tại** trong `PrintItemService.bulkCreate`
(`print-item.service.ts:707-809`: campaign + `sps.status='APPROVED'` + loại SV
đã có thẻ đang hoạt động). Ba việc cần làm:

1. `bulkCreate` trả thêm `createdIds: string[]` (hiện chỉ trả `{created, skipped}`).
2. Route mới `POST /v1/print/batches/:id/populate` (quyền `print-batch:write`):
   gọi `bulkCreate` theo `campaignId` của đợt, rồi gắn toàn bộ thẻ vừa tạo +
   thẻ chưa thuộc đợt nào của campaign đó vào đợt.
3. Thêm bộ lọc `unassigned=true` vào `ListPrintItemsQueryDto` — dọn luôn cái
   hack hiện tại (CMS phân trang 100 dòng/lần rồi lọc `!i.batchId` phía client,
   kèm một lỗi đã được ghi chú là `limit:200` vỡ vì `@Max(100)`).

CMS: `CreateBatchModal` bỏ nhãn "không bắt buộc" ở ô campaign khi người dùng
chọn nạp tự động; tạo xong thì gọi `populate` ngay. `AddApprovedStudentsModal`
hai bước gần như thành thừa — giữ lại để thêm bổ sung về sau.

### 4.2 Tính năng 3 — ngày xuất, mức từng thẻ

- Cột mới `print_items.exported_at timestamptz null` (+
  `print_batches.last_exported_at` chỉ để hiển thị).
- `POST .../package` đóng dấu `exported_at = now()` cho **đúng các thẻ có
  trong file zip** (tôn trọng tham số `itemIds` khi xuất một phần), trong một
  transaction, **sau khi** zip dựng xong — zip lỗi thì không đóng dấu.
- Xuất lại lần nữa thì cập nhật `exported_at` thành lần mới nhất và ghi thêm
  một dòng `print_item_events`, nên vẫn truy được đầy đủ lịch sử.
- CMS: thêm cột "Ngày xuất" vào bảng thẻ và vào dòng mốc thời gian sẵn có ở
  `PrintBatchDetailPage.tsx:215-239` (đang hiện "Tạo lúc · Gửi lúc · Hoàn tất lúc").

> Ghi chú về nội dung file zip: hiện zip chứa **2 file mỗi thẻ** + 1 manifest
> chung (`{subjectCode}-front.png`, `{subjectCode}-back.png`, và
> `manifest.csv` với header `subject_code,full_name,class_name,status`), chứ
> không phải "2 file" tổng cộng như cách hiểu ban đầu.

### 4.3 Tính năng 4 + 5 — upload kết quả in

**Bảng mới `print_result_imports`** (soi gương `campaign_subject_imports`):
`batch_id`, `file_name`, `fs_file_id`, `uploaded_by_user_id`, `status`
(`PROCESSING|DONE|FAILED`), `total_rows`, `matched_rows`, `printed_rows`,
`failed_rows`, `unmatched_rows`, `error_report_fs_file_id`, `failure_reason`,
`created_at` (**chính là ngày upload**).

**Route:** `POST /v1/print/batches/:id/result-imports`, multipart trường
`file`, quyền `print-batch:write`, dùng lại đúng khuôn
`@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10MB } }))` +
interface `UploadedMulterFile` cục bộ (repo chưa cài `@types/multer`). Kèm
`GET .../result-imports` (lịch sử), `GET .../result-imports/:id` (chi tiết +
link tải báo cáo lỗi) và `GET /v1/print/result-template` (tải file mẫu, soi
gương `GET subjects/import-template`).

**Nhận diện cột** — tái dùng nguyên `normalizeHeaderText` / `IGNORED_HEADERS` /
cơ chế `HEADER_ALIASES` của roster (bỏ dấu, bỏ chú thích trong ngoặc):

| Trường | Tên cột chấp nhận |
|---|---|
| `subjectCode` (bắt buộc) | Mã SV, MSSV, Mã số SV, Mã số sinh viên |
| `printStatus` (bắt buộc) | Tình trạng, Tình trạng in, Trạng thái, Kết quả |
| `errorReason` | Lỗi, Lý do, Lý do lỗi, Ghi chú |

Giá trị trạng thái chuẩn hoá: `đã in / in thành công / thành công / ok / x` →
**PRINTED**; `lỗi / không in được / in lỗi / từ chối / fail` → **quay về
RENDERED**.

**Hai mức "từ chối" (đúng quyết định đã chốt):**

1. *Cả file sai định dạng* — thiếu cột bắt buộc, hoặc không parse được
   workbook → đánh dấu import `FAILED` + `failure_reason`, **không áp dụng gì
   cả**, toàn bộ đợt giữ nguyên trạng thái đã xuất.
2. *File hợp lệ, từng dòng có vấn đề* — dòng không khớp mã SV nào trong đợt →
   đếm vào `unmatched_rows` và đưa vào báo cáo lỗi, **không** làm hỏng cả file.
   Dòng ghi lỗi in → thẻ đó về `RENDERED` kèm `error_message`.

**Ranh giới transaction** (bám đúng tiền lệ `importRoster`):

- Ghi dòng import ở `PROCESSING` **trước tiên** → parse lỗi vẫn còn bản ghi.
- **Một transaction** bọc: cập nhật toàn bộ thẻ theo lô + set
  `campaign_subjects.printed_at` cho các SV in thành công + ghi
  `print_item_events` + tính lại bộ đếm + đánh dấu import `DONE` + mở lại đợt
  nếu cần.
- **Best-effort ngoài transaction** (giống roster): dựng và upload file xlsx
  báo cáo lỗi, upload file gốc, cả hai `visibility:'public'`, rồi một lệnh
  `update` nhỏ gắn 2 file id.
- File 500 dòng phải gom lô, tuyệt đối không mở 500 transaction.

**Khớp SV:** dùng `(campaignId, subjectCode)` — an toàn trong phạm vi một
campaign (`campaign_subjects` có partial unique trên cặp này khi
`status='VALID'`), nhưng KHÔNG duy nhất xuyên campaign. Khớp theo phạm vi đợt
in còn an toàn hơn nữa.

CMS: `PrintBatchDetailPage` thêm nút "Tải kết quả in lên" + panel lịch sử
upload (tái dùng gần như nguyên mẫu panel lịch sử import roster), thêm cột
"Ngày upload" và hiển thị `errorMessage` của từng thẻ.

---

## 5. Giai đoạn 5 — Duyệt ảnh (tính năng 12, 13)

> **IMPLEMENTED 2026-09-21** — build/lint (api) sạch, `tsc -b && vite build`
> (cms) sạch, migration `1835000000000-ReviewAssignments` chạy trên DB dev
> thật, và verify sống qua HTTP thật + trình duyệt thật:
>
> - **Tính năng 12**: sửa đúng cả 5 việc ở §5.1 — bộ chọn "Ảnh nguồn" trong
>   `AiEditModal` (variant + ảnh gốc, gộp bằng tiền tố `variant:`/`photo:`),
>   `AiEditDto.sourceKind`/`sourcePhotoId`, xóa cứng bản `CARD_AI` cũ khi
>   chấp nhận bản mới (không cần dọn tay — 3 FK liên quan đã sẵn
>   `ON DELETE SET NULL`/`CASCADE` từ migration gốc), và sửa hợp đồng
>   `AiEditJob` hỏng (xóa hẳn, dùng lại type `PhotoVariant` đã đúng sẵn).
>   Verify sống qua trình duyệt thật: chọn "Ảnh gốc" làm nguồn, bấm "Chạy" →
>   `POST .../ai-edit` trả 201 với `sourcePhotoId` đúng ảnh đã chọn,
>   `derivedFromVariantId: null`, `status: FAILED` kèm lý do sidecar 501 —
>   đúng như §5.1 mục 5 đã cảnh báo trước (sidecar `/edit` chưa có model
>   thật), modal hiện lỗi + nút "Chạy lại" đúng (không còn kẹt vì hợp đồng
>   hỏng). Dữ liệu test (1 variant FAILED + 1 event) đã dọn sau khi verify.
> - **Tính năng 13**: bảng `review_assignments` (global, không theo campaign,
>   3 cột `userId`/`groupField`/`groupValue`, unique, không FK theo đúng quy
>   ước module) + `ReviewAssignmentService` (`assertInScope`/
>   `buildScopeFilter`) + `ReviewAssignmentController`
>   (`/v1/review/assignments`, ghi ADMIN-only, đọc tự giới hạn về chính mình
>   nếu không phải admin) + màn CMS "Phân công duyệt"
>   (`/review/assignments`, nav riêng). Guard gắn vào **9 chỗ**: `listSets`
>   (lọc SQL, không chỉ chặn), `getSetDetail`, `listEvents`, `getJob`,
>   `reprocess` (thêm mới — vốn không gọi `assertUnlocked` nhưng vẫn là hành
>   động theo từng hồ sơ), `aiEdit`, `acceptVariant`, `discardVariant`,
>   `uploadVariant`, `setCurrent`, `approve`/`reject` (dùng chung
>   `transitionSetStatus`). 0 dòng gán = không giới hạn (hành vi cũ giữ
>   nguyên). Verify sống qua HTTP thật (2 tài khoản `dev-mock`, 1 admin +
>   1 reviewer thường) trên DB dev thật: trước khi gán — reviewer thấy hết;
>   sau khi gán `faculty=NN VÀ VH TRUNG QUỐC` — `listSets` chỉ còn đúng 1 hồ
>   sơ khớp, hồ sơ khác `getSetDetail`/`listEvents`/`reprocess` đều 403
>   `OUT_OF_SCOPE` (9019); non-admin không tạo/xóa được phân công (403); xóa
>   phân công xong reviewer lại thấy hết (0 dòng = không giới hạn, xác nhận
>   round-trip đúng). Verify thêm qua trình duyệt thật: màn "Phân công
>   duyệt" tạo/liệt kê/xóa qua UI thật (không chỉ gọi API tay). Toàn bộ dữ
>   liệu test (2 user, 1 dòng gán) đã dọn sau khi verify.
>
> Chưa commit — theo đúng quy ước "không commit tới khi người dùng xác nhận
> đã test đầu-cuối xong".

### 5.1 Tính năng 12 — chọn ảnh nguồn để sửa prompt tiếp

**Tin tốt:** mô hình dữ liệu đã hỗ trợ sẵn nhiều phiên bản — mỗi lần tạo là
một dòng `photo_variants` mới với `version` tăng dần (`nextVersion()`), và
`derived_from_variant_id` đã ghi lại quan hệ "sửa tiếp từ bản nào".
`AiEditModal` cũng đã có sẵn prop `fromVariantId`.

**Khoảng trống thật sự:** `fromVariantId` đang bị **hardcode** bằng
`set.currentCardVariantId` (`ReviewDetailContent.tsx:354-364`), không có bộ
chọn. Và quan trọng hơn: `aiEdit` chỉ nhận được `photo_variants`, **không thể
trỏ vào ảnh camera gốc** — `findVariantEntityOrFail` chỉ tra bảng variants.
Hai hàm đọc bytes tồn tại song song (`readSourcePhotoBytes` cho ảnh gốc,
`readVariantBytes` cho variant) nhưng chỉ hàm sau với tới được từ `aiEdit`.

**Việc cần làm:**

1. Thêm bộ chọn ảnh nguồn vào `AiEditModal` (đúng chỗ khung "Trước (ảnh hiện
   tại)" hiện đang là div rỗng): chọn giữa các ảnh camera gốc và các phiên bản
   AI đã có.
2. Thêm trường phân loại nguồn vào `AiEditDto` (`sourceKind: 'ORIGINAL_PHOTO' |
   'VARIANT'` + `sourcePhotoId`), rẽ nhánh sang `readSourcePhotoBytes` khi là
   ảnh gốc, và ghi `sourcePhotoId` thay vì `derivedFromVariantId`. **Cả hai
   cột đã tồn tại sẵn** trên `photo_variants`.
3. Theo quyết định "xóa hẳn ảnh AI cũ": sau khi chấp nhận bản AI mới, xóa
   cứng bản AI trước đó.
   ⚠️ **Cảnh báo cần nêu lại khi triển khai:** module duyệt ảnh có quy ước rõ
   ràng "không bao giờ xóa cứng variant, chỉ chuyển `DISCARDED` để truy vết"
   (`photo-variant.entity.ts:10-17`). Xóa cứng là phá quy ước đó một cách có
   chủ đích — cần xử lý `derived_from_variant_id` của các bản phái sinh (FK
   `ON DELETE SET NULL`) và các dòng `photo_review_events` trỏ tới.
4. **Sửa hợp đồng đang hỏng** (bắt buộc, nếu không tính năng 12 không chạy
   được): `AiEditJob` phía CMS chờ `status: 'DONE'` và `resultVariantId`,
   nhưng server trả `PhotoVariantDao` với `status: 'READY'` và `id`. Nút
   "Chấp nhận" đọc `job.resultVariantId` — một giá trị server **không bao giờ
   gửi**. Đường chấp nhận ảnh AI hiện đang hỏng đầu-cuối.
5. Ghi nhận: route `/edit` của sidecar Python hiện **luôn trả HTTP 501** (chưa
   gắn model sinh ảnh — xem `photo-review-sidecar.service.ts:94-98`). Nên tính
   năng 12 chỉ kiểm thử được phần hợp đồng + giao diện cho tới khi sidecar có
   model thật.

### 5.2 Tính năng 13 — chia việc duyệt theo nhóm

**Hiện trạng:** không có khái niệm phòng ban ở bất kỳ đâu (đã liệt kê toàn bộ
41 bảng — không bảng nào là đơn vị/phòng ban), và `users` không có trường nào
ghi người đó thuộc nhóm nào (chỉ có `title` là chức danh dạng free text).
Cũng **chưa có khái niệm người được phân công**: `subject_photo_sets` không có
cột assignee/claimed_by; `IN_REVIEW` chỉ là dấu "đã có người động vào", không
ghi ai, không bao giờ được xóa, và `assertUnlocked` coi nó là hoàn toàn mở.

Mặt dữ liệu thì ngược lại — đã sẵn sàng: `subject_photo_sets` đã có
`class_name` / `major` / `faculty` / `citizen_id` denormalize sẵn, `listSets`
đã lọc được theo cả 3, và `listCampaignSubjectDistinctValues` đã là endpoint
thật. Nghĩa là **không cần thêm cột hay endpoint tra cứu nào** cho phần lọc.

**Thiết kế theo quyết định đã chốt:**

- Bảng gán mới, dạng động 3 cột `(user_id, group_field, group_value)` — ví dụ
  `(nguyễn A, 'faculty', 'Khoa CNTT')`. Đúng tinh thần "có thông tin gì thì
  nhóm theo cái đó": `group_field` không bị đóng cứng vào khoa.
- Danh sách trường có thể nhóm được lấy động từ các cột thật + các khóa trong
  `extra` jsonb mà giai đoạn 3 đã lưu (`discovered_fields`).
- Màn "Phân công duyệt": chọn trường nhóm → chọn giá trị → chọn người, tái sử
  dụng modal chọn người đa lựa chọn vừa làm cho "Cấp quyền"
  (`CampaignList.tsx`, mẫu gốc `AddUserToRoleModal` trong `RolesPage.tsx`).
- Ép bộ lọc phía server trong `listSets`, và thêm kiểm tra phạm vi vào các
  handler hành động theo từng hồ sơ (hiện chỉ gọi `assertUnlocked`).
- Kèm theo: module duyệt ảnh hiện **hoàn toàn đứng ngoài hệ thống phân quyền**
  — không có mã quyền `photo-review:*` nào, chỉ có `ReviewerRoleGuard` đọc
  mảng `users.roles` jsonb kiểu cũ. Giai đoạn 1.2 nạp quyền mặc định là dịp
  hợp lý để đưa module này vào hệ thống chung.

---

## 5.3 Sổ rủi ro — những thứ có thể âm thầm làm hỏng dữ liệu

Đây là danh sách rút ra sau khi rà soát chéo thiết kế với schema thật. Mỗi
dòng là một lỗi **không báo gì cả** nếu làm sai, nên phải có biện pháp cụ thể.

| # | Rủi ro | Biện pháp |
|---|---|---|
| R1 | **Sinh thẻ TRÙNG cho một SV.** Đẩy thẻ bị từ chối về `FAILED` sẽ nhả `UQ_print_items_set_id_active`, và tính năng 2 (nạp tự động) lập tức tạo thẻ thứ hai. | Từ chối → `RENDERED`. Viết test khẳng định trạng thái đích của nhánh từ chối KHÔNG nằm trong `PRINT_ITEM_INACTIVE_STATUSES`, và `EXPORTED` cũng không. |
| R2 | **`print_item_events.source` là `varchar(12)`**, `RESULT_UPLOAD` dài 13 → lỗi runtime `value too long` trông như migration CHECK hỏng. | Nới cột lên `varchar(16)` trong cùng migration với CHECK. |
| R3 | **Làm mới roster xoá mất `printed_at`** nếu dùng `EXCLUDED.*` hoặc `save()` nguyên entity. | Liệt kê cột tường minh trong `DO UPDATE SET`. Unit test: kéo → set `printed_at` → kéo lại → khẳng định còn nguyên. |
| R4 | **Xoá import mới nhất cuốn theo CẢ roster** (`FK_campaign_subjects_import ON DELETE CASCADE`), mất luôn lịch sử in. | Mở rộng guard của `deleteImport`: từ chối nếu có SV nào `printed_at IS NOT NULL`. |
| R5 | **`ON CONFLICT DO UPDATE cannot affect row a second time`** khi API trả trùng `student_code` trong một chunk → giết 500 dòng tốt. | Khử trùng trong JS ở tầng 1, bản sau ghi `DUPLICATE`. |
| R6 | **Thống kê nhân đôi** do fan-out khi JOIN `subject_photo_sets` (unique theo `kind_id`) hoặc `print_items` (in lại). | Gom về 1 dòng/`subject_code` trong CTE trước khi join. Test hồi quy với campaign 2 loại ảnh. |
| R7 | **Bộ đếm `printedCount`/`failedCount`/`itemCount` lệch dần** — mỗi transition mới là một cơ hội quên. | Tính lại bằng một câu `COUNT` cuối mỗi transaction upload + route `POST :id/recount` để sửa phần đã lệch từ trước. |
| R8 | **Đếm hai lần khi nhà in gửi lại đúng file kết quả đó.** | UPDATE có `WHERE status <> 'PRINTED'`; `printed_at = COALESCE(printed_at, now())`; recount làm bộ đếm idempotent; cảnh báo 409 nếu trùng `file_name` + kích thước + số dòng trong 24h. |
| R9 | **File kết quả áp dụng nửa vời** → thẻ ở trạng thái vật lý không xác định. | Mặc định từ chối toàn bộ khi có bất kỳ dòng nào không khớp; một transaction cho cả lần áp dụng; `allowPartial` chỉ bật bằng một thao tác xác nhận thứ hai. |
| R10 | **Không có index nào trên `print_items.subject_code`** → khớp dòng file upload và join thống kê đều quét toàn bảng. | Thêm `IDX_print_items_campaign_subject (campaign_id, subject_code)`. |
| R11 | **Nhóm thống kê theo trường có hàng chục nghìn giá trị** (`email`, `student_id`) sinh "thống kê" 24.000 dòng. | Chỉ chào trường có `distinct_count` trong khoảng 2–500. |
| R12 | **SQL injection qua tham số `groupBy`.** | Cột thật → tên hardcode; khoá jsonb → `extra ->> $n` dạng bind parameter, không chuỗi nào lọt vào SQL text. |
| R13 | **Phình bảng / dead tuple** do 24.000 dòng UPDATE tại chỗ mỗi lần làm mới. | `autovacuum_vacuum_scale_factor = 0.05` cho `campaign_subjects`; xoá dòng chunk sau khi import xong. |
| R14 | **Quy tắc BA #14 bị nới âm thầm** — thêm người ghi `printedAt` mà không ghi lại quyết định. | Thêm `RESULT_UPLOAD` làm nguồn sự kiện hạng nhất (không mượn `SYSTEM`); sửa doc comment của entity nêu đủ 3 nguồn hợp lệ và giữ nguyên bất biến "không bao giờ suy luận". |
| R15 | **`print_items.className`/`faculty` lệch với roster** sau khi làm mới → hai màn hiển thị số khác nhau. | Thống kê luôn nhóm theo roster; ghi rõ trong doc comment của service. |
| R16 | **Xoá cứng ảnh AI** phá quy ước "không bao giờ xoá variant" của module duyệt. | Xử lý `derived_from_variant_id` (FK `SET NULL`) và `photo_review_events` trỏ tới; nêu lại cảnh báo khi triển khai. |
| R17 | **Đăng ký worker nhầm host.** Nếu worker chunk lọt vào `app-query.module.ts`, mọi pod đọc biến thành worker import. | Chỉ đăng ký trong `app-worker.module.ts`; thêm test khởi động khẳng định `SERVICE_TYPE=query` không đăng ký worker nào (đã có tiền lệ test "query không đăng ký cron"). |

---

## 6. Verification

Mỗi giai đoạn phải xanh trước khi sang giai đoạn sau. **Không commit cho tới
khi người dùng xác nhận đã test đầu-cuối xong.**

**Giai đoạn 1 — HOÀN TẤT VÀ ĐÃ XÁC MINH ĐẦY ĐỦ 2026-09-21 (kể cả trình duyệt thật):**

- ✅ `pnpm --filter @face/api build` + `pnpm --filter @face/cms build` sạch
  (bao gồm `tsc -b` phía CMS).
- ✅ `pnpm --filter @face/api test`: 179 test pass, 118 skip (cần
  `TEST_DATABASE_URL` thật — đúng số lượng ghi trong memory trước đó), 0 fail.
- ✅ Chạy `pnpm --filter @face/api seed:role-permissions` trên DB dev thật;
  xác nhận `role_permissions` có dòng cho ADMIN(25)/CTSV(5)/HAU_CAN(2)/
  IT_PRINT(10), bao gồm `campaign:read` phát hiện được nhờ quét catalog thật.
- ✅ **Test tay qua trình duyệt thật** (Claude tự thực hiện qua browser pane,
  tài khoản dev-mock, dọn sạch dữ liệu test ngay sau đó):
  - Duyệt ảnh: mở hồ sơ `/review/:id` bằng tài khoản admin test — bấm
    **Duyệt** → `POST .../approve → 201` rồi tự động `GET .../id → 200`,
    trang hiện đủ `campaignName`/`operatorName`/`sourceCapturedAt`/
    `sourceDeviceName`, KHÔNG trắng màn. Lặp lại và xác nhận đủ cả
    **Từ chối** (event `REJECTED` đúng actorName), **Đặt hiện tại** (event
    `SET_CURRENT`, con trỏ current đổi đúng), **Tạo lại ảnh 4x6** trên hồ sơ
    `AUTO_FAILED` thật (sidecar không kết nối được trong môi trường dev →
    đi đúng nhánh catch → vẫn trả `getSetDetail()` đầy đủ, không sập; đồng
    thời xác nhận `failReason` hiện đúng lý do lỗi thật, trước đây luôn trống).
  - Cấp quyền: tài khoản CTSV **không phải admin** (gán role CTSV qua SQL,
    `is_admin=false`) mở `/campaigns`, bấm "Cấp quyền" → ô tìm người load
    được danh sách (xác nhận `user:read` hoạt động, không còn 403) → chọn 2
    người → `POST .../members/grant → 201 Created` → xác nhận
    `campaign_members` 2 dòng chuyển `APPROVED`, `note='GRANTED'`.
  - Toàn bộ dữ liệu test (set status, current variant, variant/event phát
    sinh, campaign_members, 2 user dev-mock) đã được revert lại đúng trạng
    thái ban đầu trong 1 transaction ngay sau khi test xong — xác nhận lại
    bằng query, khớp 100% với trước khi test.

**Đã build, test, seed và test tay đầy đủ — sẵn sàng chờ người dùng xác nhận
để commit theo đúng quy ước "không commit tới khi test đầu-cuối xong".**

**Giai đoạn 2:** build lại app Windows (`pnpm package:app:win:dir`) — lưu ý
`pnpm dev:app` chỉ biên dịch main/preload MỘT LẦN lúc khởi động, nên thay đổi
ở main process bắt buộc phải khởi động lại. Test trên máy thật: gán cam phụ
thấy ô hiện ngay (không cần restart), swap cam giữa↔góc hiển thị đúng, Enter
và Space chụp được và không phá luồng quét mã, SV chụp lại lần 2 sau khi khởi
động lại app thì ảnh cũ biến mất khỏi màn duyệt.

**Giai đoạn 3:** chạy kéo thật trên 1 campaign dev với API thật:

- Route trả 202 **dưới 100 ms** (không chờ HTTP ngoài).
- Sau tầng 1: đúng 48 dòng `campaign_subject_import_chunks` ở `PENDING`.
- Trong lúc tầng 2 chạy: `valid_rows` tăng dần, CMS thấy tiến độ nhúc nhích.
- Kết thúc: số dòng `campaign_subjects` khớp `total_rows`, `extra` đủ 33 khoá,
  các dòng chunk đã bị xoá, import `DONE` + `finished_at`.
- **Test chịu lỗi:** giết tiến trình API giữa chừng rồi bật lại → các chunk
  `PROCESSING` treo được đưa về `PENDING` và import tự chạy tiếp tới `DONE`,
  không mất dòng, không nhân đôi dòng.
- **Test song song:** chạy 2 instance API cùng lúc, khẳng định `SKIP LOCKED`
  không cho 2 worker giành cùng một chunk (mỗi chunk `attempts = 1`).
- Kéo lần 2: không nhân đôi dòng, **không xoá `printed_at`** (R3), SV không
  còn trong API vẫn còn dòng.
- Đo thời gian tổng và đỉnh bộ nhớ của tiến trình trong cả 2 tầng.

**Giai đoạn 4:** tạo đợt in từ campaign → nạp tự động → render → xuất zip
(kiểm tra `exported_at` được đóng dấu đúng tập thẻ) → upload file kết quả có
cả dòng thành công lẫn dòng lỗi → xác nhận thẻ lỗi quay về `RENDERED` và
không sinh thẻ trùng ở lần bulk-create kế tiếp → xác nhận bộ đếm khớp `COUNT`
thật.

**Giai đoạn 5:** kiểm thử hợp đồng AI-edit + bộ chọn ảnh nguồn (sidecar trả
501 nên chỉ test tới bước tạo variant `FAILED`), và kiểm thử phân công duyệt:
người được gán khoa A không thấy hồ sơ khoa B, cả ở danh sách lẫn khi gọi
thẳng API chi tiết.

---

## 7. Không đụng tới

- Print-agent phía DIRECT (đã chốt ngoài phạm vi từ D-Q8) — chỉ định nghĩa
  hình dạng API, không có consumer.
- Quy ước không đặt FK xuyên module mà các giai đoạn P1-P6 đã thiết lập.
- Đường "tự join + CTSV duyệt tay" (`joinCampaign`, `decide`) — giữ nguyên,
  song song với đường "Cấp quyền hàng loạt".
