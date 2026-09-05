# Thảo luận thiết kế: Đa camera, Streaming, Quản lý thiết bị

> Tài liệu thảo luận (chưa phải spec chốt). Mục đích: đi sâu từng khoảng trống
> trong sơ đồ luồng đã vẽ, và làm rõ kiến trúc cho 5 tính năng đã nêu, trước khi
> chuyển sang viết implementation plan chính thức.
>
> Bối cảnh đã chốt qua trao đổi trước:
> - "Stream" = ghi video lưu local trong lúc chụp (không phải streaming ra ngoài).
> - "Thiết bị" = mỗi máy kiosk vật lý (1 máy chạy Looka = 1 thiết bị).
> - Chặn API khi hết hạn: chặn ở **cả 2 lớp** (backend Looka + fs-core).
> - Đăng ký/hết hạn/thống kê thiết bị: xây **admin portal/service riêng**, tách
>   khỏi `apps/api` hiện tại — **và làm trọn bộ (website + API + UI) ngay từ
>   đầu**, không chia giai đoạn API-only trước.
> - Camera giữa (C0) là camera bắt buộc; camera 2 bên (C1/C2) hot-swap thủ công
>   qua CB Help khi hỏng (chi tiết mục 2.1).
> - "AI Vision server" là hệ thống **đã có sẵn** (bên thứ 3 hoặc hệ thống khác
>   của đơn vị) — không xây mới trong dự án này (chi tiết mục 2.9).
> - Yêu cầu độ phân giải khuôn mặt >250x250px áp dụng cho **toàn bộ luồng chụp
>   ảnh**, kể cả luồng 5 góc hiện tại của Looka — không chỉ thiết kế đa camera
>   sắp tới (chi tiết mục 2.8).

---

## 1. Luồng hiện tại theo sơ đồ (xác nhận lại cách hiểu)

```
3 camera (C0 giữa, C1/C2 hai bên)
  → Máy điều khiển (xem real-time cả 3 view cùng lúc, có CB Help hỗ trợ)
  → Detect Face, đánh giá: Đủ / Đúng tư thế / Đẹp
      ├─ không đạt → Warning
      └─ đạt → OK
  → Client tiền xử lý vector/matrix (giảm tải cho server AI Vision)
  → Chụp: Manual (bước 1-5) HOẶC Auto
  → Ghi hình song song cả 3 kênh, đủ số ảnh cần lấy trên cả 3 cam
    (các sắc thái: nghiêm túc, cười, ngẩng lên/xuống)
  → Lưu Local file → Folder structure
  → Identify vs Hệ thống Admin (đối chiếu Info SV)
  → Manual confirm ok → Get post
  → SV đi về
```

Nếu cách hiểu trên sai ở đâu, cần chỉnh lại trước khi đọc phần dưới, vì toàn bộ
phân tích gap dựa trên luồng này.

---

## 2. Phân tích chi tiết từng khoảng trống

### 2.1. Camera mất kết nối giữa chừng — ĐÃ CHỐT hướng xử lý

**Vấn đề gốc:** Tối nay khi debug chỉ với **1** camera, đã gặp lỗi hardware
(`0xC00D3704 - lack of hardware resources`) khiến camera không mở được, và phải
qua nhiều bước xử lý (kill process orphan, tắt hardware-accelerated capture path)
mới ổn định lại. Với **3** camera vật lý cùng lúc, xác suất một trong số đó rớt
kết nối / driver treo / bị ứng dụng khác chiếm dụng tăng lên đáng kể — không
phải x3 tuyến tính mà thường tệ hơn, vì 3 camera cùng tranh chấp GPU/USB
bandwidth. 3 kiểu "rớt" cụ thể cần phân biệt: rút dây vật lý (phát hiện ngay
qua `track.onended`), driver/OS treo (đúng lỗi gặp tối nay — có thể "treo im
lặng", không báo lỗi rõ ràng), và ứng dụng khác chiếm quyền camera giữa session.

**Quyết định:** Camera giữa (C0) là camera **bắt buộc phải hoạt động**. Camera
2 bên (C1/C2) **không bắt buộc riêng lẻ** — nếu 1 cái hỏng, CB Help chủ động
thao tác trên "Máy điều khiển" để chỉ định camera khác (cam chính hoặc cam bên
còn lại) đảm nhiệm bù vai trò của cam đã hỏng, thay vì hệ thống tự động huỷ
session hay tự động bỏ qua góc bị thiếu.

**Hệ quả kiến trúc:** Cần 1 lớp gián tiếp tách "vai trò logic" (CENTER / LEFT /
RIGHT) khỏi "camera vật lý" (C0 / C1 / C2), thay vì gắn cứng như hiện tại. Ví
dụ 1 bảng mapping runtime, chỉnh được ngay trên "Máy điều khiển" mà không cần
khởi động lại cả pipeline:

```
{ role: 'CENTER', physicalDeviceId: 'C0' }
{ role: 'LEFT',   physicalDeviceId: 'C1' }
{ role: 'RIGHT',  physicalDeviceId: 'C2' }
```

Khi C1 hỏng, CB Help đổi dòng `LEFT` sang `physicalDeviceId: 'C0'` (hoặc `'C2'`)
— hệ thống route lại luồng xử lý theo vai trò `LEFT`, không quan tâm vật lý nào
đứng sau nó.

**Gán vai trò ở đâu — chưa có sẵn, cần làm mới:** hiện tại app đã có sẵn
`CameraSelector` (dùng để chọn 1 trong N camera cho pipeline 1-camera hiện
hành), nhưng đó KHÔNG phải màn gán vai trò — nó chỉ chọn "dùng camera nào",
không có khái niệm CENTER/LEFT/RIGHT. Cần 1 màn hình mới, riêng cho CB Help
(không phải SV): liệt kê mọi camera máy phát hiện được (qua
`enumerateDevices()`), mỗi camera có preview trực tiếp để CB Help phân biệt
bằng mắt (vì tên thiết bị thường không nói lên nó đang chĩa hướng nào), kèm 1
dropdown gán CENTER/LEFT/RIGHT/chưa gán. Lưu kết quả vào cấu hình cục bộ của
máy đó (mở rộng đúng cơ chế `secrets.dat` đang dùng cho `device_id`) — set 1
lần lúc cài đặt, dùng lại được cho lần hot-swap sau này (cùng 1 màn hình,
dùng ở 2 thời điểm khác nhau: setup ban đầu, và khi cần thay camera hỏng).
Màn hình này đặt ở đâu (màn kiosk chính lúc "chế độ setup", hay màn mở rộng
CB Help ở mục 3.5) là quyết định có thể chốt sau, không ảnh hưởng thiết kế.

**Còn 2 điểm cần làm rõ thêm** (chưa đủ thông tin để chốt hẳn):

1. Khi C0 "kiêm nhiệm" thêm vai trò LEFT (vốn là góc nghiêng, do 1 camera đặt
   lệch chụp), có 2 cách hiểu khác hẳn nhau về mặt vận hành:
   - **(a)** SV đứng yên nhìn thẳng, hệ thống chấp nhận ảnh "LEFT" thực chất vẫn
     là góc thẳng chụp từ C0 (không đúng nghĩa góc nghiêng ban đầu, nhưng đơn
     giản, không cần hướng dẫn gì thêm cho SV).
   - **(b)** SV được hướng dẫn quay đầu sang trái ~15-30° trong khi vẫn nhìn vào
     C0 — tức là fallback đúng về cơ chế "quay đầu trước 1 camera" mà bản Looka
     hiện tại (1 camera duy nhất) đang dùng. Đúng về mặt chụp đủ góc thật, nhưng
     cần màn hình hướng dẫn SV khác hẳn so với luồng "3 cam cố định, không cần
     quay đầu" bình thường — tức là 2 chế độ hướng dẫn UI song song.
2. Nếu chính **C0** hỏng (không phải C1/C2) — sơ đồ và quyết định trên chưa nói
   tới trường hợp này. Đề xuất coi đây là **lỗi nghiêm trọng, dừng session**
   (khác hẳn C1/C2), vì ảnh CENTER thường là ảnh chính dùng để in/hiển thị,
   không chỉ là dữ liệu bổ trợ như LEFT/RIGHT — nhưng cần xác nhận lại đây có
   đúng là mức độ ưu tiên mong muốn không.

**Kỹ thuật nền đã có sẵn, tận dụng được:**

- **Pre-flight check bắt buộc**: trước khi bắt đầu session, gọi
  `enumerateDevices()` + thử mở nhanh cả 3 camera (giống hệt cơ chế
  `checkPermissions()` đã có trong `BrowserCameraService`), thất bại thì chặn
  bắt đầu session và báo CB Help ngay, thay vì phát hiện giữa chừng.
- **Trong lúc chạy**: mỗi `BrowserCameraService` instance (1 camera = 1
  instance) tự lắng nghe sự kiện `track.onended` (đã có sẵn cơ chế
  `emit('disconnect', ...)` trong code hiện tại) → khi rớt, hiển thị cảnh báo
  real-time trên "Máy điều khiển", làm nổi bật nút chỉ định camera thay thế
  cho đúng vai trò bị ảnh hưởng.
- Fix `disable-features=MediaFoundationD3D11VideoCapture` (đã áp dụng tối nay
  cho 1 camera) cần áp dụng ở mức tiến trình Electron — tự động có lợi cho cả
  3 camera cùng lúc, không cần làm riêng từng cái.

### 2.2. Giới hạn số lần thử lại / timeout

**Vấn đề:** Nếu SV không đạt "Đúng tư thế" nhiều lần liên tục, sơ đồ không nói
rõ có giới hạn không. Không giới hạn → một SV khó tính có thể giữ máy vô thời
hạn, gây tắc nghẽn hàng đợi (đặc biệt nếu đây là điểm chụp ảnh thẻ SV hàng loạt).

**Đề xuất phương án:**

- Đặt ngưỡng: N lần thử liên tiếp không đạt (ví dụ 5-8 lần) trong 1 bước →
  tự động hiện nút gọi CB Help thay vì tiếp tục lặp vô hạn.
- Timeout tổng cho cả session (ví dụ 3-5 phút kể từ lúc bắt đầu) → nếu vượt,
  tạm dừng và yêu cầu CB Help can thiệp hoặc SV quay lại xếp hàng lượt sau.
- Cả hai ngưỡng nên là **cấu hình được** (qua admin portor ở mục 3.4), không
  hardcode, vì mỗi điểm triển khai (trường học khác nhau) có thể cần khác nhau.

### 2.3. Xử lý khi Identify không khớp

**Vấn đề:** Bước "Identify vs Hệ thống Admin (Info SV)" là điểm dễ phát sinh
tình huống rối nhất trong thực tế, nhưng sơ đồ chỉ có 1 nhánh đi thẳng tới
"Manual confirm ok". Các tình huống thực tế thường gặp:

- Không tìm thấy SV nào khớp (SV chưa có trong hệ thống Admin, hoặc nhập sai
  mã SV lúc bắt đầu).
- Tìm thấy nhưng **đã có ảnh đăng ký từ trước** (đăng ký trùng — SV chụp lại
  lần 2, cố tình hoặc nhầm lẫn).
- Tìm thấy nhiều kết quả gần giống (ambiguous match) — hệ thống nhận diện
  không chắc chắn 100%.

**Đề xuất phương án:**

- 3 nhánh rõ ràng: `NOT_FOUND` → yêu cầu CB Help nhập lại/tra cứu thủ công;
  `DUPLICATE` → hỏi CB Help xác nhận có cho ghi đè hồ sơ cũ không (và giữ lại
  lịch sử phiên bản cũ, không xoá thẳng — giống cách `FsClient` hiện tại xử lý
  versioning/rollback cho file); `AMBIGUOUS` → luôn cần xác nhận thủ công, không
  bao giờ tự động chọn 1 trong các kết quả gần giống.
- Đây cũng là lý do "Manual confirm ok" trong sơ đồ là bước **bắt buộc phải giữ
  lại**, không nên tối ưu bỏ đi kể cả khi auto-capture hoạt động tốt.

**API tra cứu Info SV — 1 endpoint mới trong `apps/api`:**

- `GET /v1/identify/lookup?code=<mã SV>` (theo đúng convention `/v1/...` đã
  có sẵn, xem `HttpCaptureSink`) — nhận `code` bắt buộc, kèm các trường bổ
  sung tuỳ chọn nếu cần disambiguate (VD lớp/khoá học) khi biết rõ hệ thống
  Admin thật cần gì.
- Bên trong, endpoint này **gọi ra 1 hệ thống Admin bên ngoài** để lấy thông
  tin SV — đúng dạng phụ thuộc đã gặp ở mục 2.9 (AI Vision server): hệ thống
  đã có sẵn, Looka chỉ đóng vai trò client gọi sang, **giao thức/API cụ thể
  chưa có, sẽ được cung cấp sau**. Base URL + key gọi ra ngoài nên cấu hình
  qua biến môi trường (đúng pattern `FS_BASE_URL`/`FS_API_KEY` đang dùng cho
  fs-core), không hardcode, vì chưa biết trước sẽ trỏ tới đâu.
- Response map thẳng vào đúng 2 trong 3 nhánh đã chốt ở trên: **1 kết quả
  khớp** → `FOUND` (trả thông tin SV); **0 kết quả** → `NOT_FOUND`; **nhiều
  kết quả gần giống** → `AMBIGUOUS`. Nhánh `DUPLICATE` (đã có ảnh đăng ký từ
  trước) **không đến từ API này** — đó là kiểm tra riêng trên dữ liệu đã
  chụp của chính Looka (đã tồn tại session/hồ sơ nào gắn với mã SV này chưa),
  không phải điều hệ thống Admin ngoài biết.
- Vì giao thức thật chưa có, endpoint này trước mắt chỉ dừng ở **thiết kế**
  (route, input/output, chỗ gọi ra ngoài) — chưa viết code, đợi tài liệu
  API/giao thức thật từ bên sở hữu hệ thống Admin.

### 2.4. Bước xin sự đồng ý (consent)

**Vấn đề:** Sơ đồ không có bước nào thu thập sự đồng ý trước khi bắt đầu ghi
hình sinh trắc học. Một khi dữ liệu này được đưa vào hệ thống Identify/AI Vision
(dùng cho nhận diện, không chỉ lưu trữ ảnh thẻ), yêu cầu về consent thường chặt
chẽ hơn nhiều so với một tấm ảnh thẻ SV thông thường.

**Đề xuất phương án:**

- Thêm 1 bước trước "Máy điều khiển": màn hình hiển thị mục đích thu thập +
  SV xác nhận đồng ý (chạm nút, hoặc CB Help xác nhận thay nếu SV không tự thao
  tác được) → lưu lại **thời điểm + phiên bản nội dung đồng ý** cùng với session,
  không chỉ lưu "đã đồng ý: true/false".
- Nội dung consent cấu hình theo **campaign**, không theo từng thiết bị —
  đúng lý do campaign đã nhóm thiết bị theo mục đích sử dụng (mục 3.2): 1
  campaign "chụp thẻ SV" và 1 campaign "đăng ký KYC/FaceID" (mục 3.7) có mục
  đích dùng ảnh khác hẳn nhau, nên hiển nhiên cần nội dung consent khác nhau
  — không hợp lý nếu gắn theo từng thiết bị riêng lẻ trong khi mọi thiết bị
  cùng 1 campaign đều phục vụ cùng 1 mục đích.
- Schema: `campaigns.consent_content` (text) + `campaigns.consent_version`
  (số, tăng lên mỗi lần admin sửa nội dung). Nếu campaign chưa cấu hình
  riêng, dùng 1 nội dung mặc định chung chung (`consent_version = 0`, dành
  riêng cho "chưa cấu hình") — để bước này **không bao giờ chặn luồng chụp**
  chỉ vì thiếu cấu hình.
- Lưu lại mỗi lần đồng ý vào 1 bảng riêng (hoặc cột trên bảng session):
  `session_id`, `campaign_id`, `consent_version` (bản đã hiển thị lúc đó,
  không phải bản mới nhất — tránh trường hợp admin sửa nội dung sau này làm
  sai lệch lịch sử), `accepted_at`, `accepted_by` (`SUBJECT` | `CB_HELP`) —
  cùng kiểu audit trail đã dùng cho Manual confirm ở mục 2.7.
- Luôn hỏi lại **mỗi session**, kể cả SV quay lại chụp lần 2 (nhánh
  `DUPLICATE` ở mục 2.3) — không cố nhớ/bỏ qua dựa trên lần đồng ý trước, vì
  mỗi session là 1 lần ghi hình sinh trắc học mới, cần bằng chứng đồng ý
  riêng cho chính lần đó.
- Nội dung consent thật (câu chữ pháp lý cụ thể) vẫn cần lấy từ bên có thẩm
  quyền của đơn vị triển khai — Looka chỉ đảm bảo **cơ chế** (versioned,
  theo campaign, có audit trail), không tự soạn nội dung pháp lý.

### 2.5. Lưu trữ và dọn dẹp video

**Vấn đề:** Ghi hình song song 3 kênh cho mỗi SV, nhân với số lượng SV trong
một đợt chụp hàng loạt (có thể hàng trăm-hàng nghìn), sẽ tạo ra dung lượng lớn
rất nhanh. Ảnh JPEG hiện tại đã nhẹ (~100-400KB/ảnh theo dữ liệu thực tế tối
nay); video 3 kênh cho mỗi SV sẽ nặng hơn nhiều bậc.

**Đề xuất phương án cần quyết định:**

- Video có **upload lên file-service** như ảnh không, hay chỉ giữ local rồi
  tự xoá sau X ngày? (Ảnh hưởng trực tiếp tới băng thông + dung lượng fs-core.)
- Nếu giữ local: cần policy dọn dẹp tự động (ví dụ giữ 30 ngày, hoặc giữ tới
  khi admin portal xác nhận đã đối chiếu xong), tránh kiosk đầy ổ đĩa giữa ca
  làm việc — đây là lỗi vận hành nghiêm trọng nếu xảy ra (kiosk ngừng nhận SV
  mới vì hết dung lượng).
- Có thể chỉ cần giữ video ở **độ phân giải/bitrate thấp hơn nhiều** so với ảnh
  chụp chính thức — mục đích của video khác ảnh thẻ (làm bằng chứng quy trình,
  không phải để in), nên không cần chất lượng cao.

### 2.6. Phản hồi kết quả cho SV

**Vấn đề:** Sơ đồ đi thẳng từ "Manual confirm ok → Get post" tới "SV đi về",
không rõ SV có được biết kết quả (đạt/cần chụp lại) trước khi rời đi không.
Nếu không, SV chỉ biết mình chụp "hỏng" khi nào đó sau này có người liên hệ lại
— tốn công gọi lại, xếp hàng lại.

**Đề xuất phương án:**

- Trước khi cho phép "Đi về", màn hình hiển thị rõ trạng thái cuối: "Hoàn tất"
  hoặc "Cần hỗ trợ thêm — vui lòng gặp CB Help trước khi rời đi", để không có
  trường hợp SV rời đi với hồ sơ dang dở mà không biết.

### 2.7. Audit trail cho Manual confirm

**Vấn đề:** "Manual confirm ok" là bước con người can thiệp, quyết định hồ sơ
có được "Get post" hay không. Không có audit trail đồng nghĩa không truy được
sau này: ai xác nhận, lúc nào, dựa trên thông tin gì (đặc biệt quan trọng cho
đúng nhánh 2.3 — trường hợp AMBIGUOUS/DUPLICATE).

**Đề xuất phương án:**

- Mỗi lần confirm ghi lại: ai (tài khoản CB Help đăng nhập), lúc nào, quyết
  định gì (đạt / yêu cầu chụp lại / ghi đè hồ sơ cũ), trên thiết bị nào (nối
  với concept "thiết bị" ở mục 3.2). Đây chính là dữ liệu nền cho phần thống kê
  ở mục 3.4 (không chỉ đếm ảnh, mà biết được thao tác thủ công diễn ra bao nhiêu).

### 2.8. Yêu cầu độ phân giải khuôn mặt trong ảnh lưu (>250x250, tốt nhất 300-500) — ĐÃ CHỐT phạm vi áp dụng

**Yêu cầu mới:** vùng khuôn mặt trong ảnh lưu lại phải **>250x250px**, lý tưởng
**300-500px**.

**Đây là khoảng trống thật trong code hiện tại — không chỉ là thiếu cho thiết
kế tương lai.** `QualityEvaluator` hiện tại (`packages/face-quality`) chỉ kiểm
tra **tỷ lệ tương đối**, không kiểm tra **kích thước tuyệt đối theo pixel**:

```ts
const faceSizeRatio = boundingBox.width / frameWidth;   // tỷ lệ, không phải pixel
if (faceSizeRatio < req.minFaceSizeRatio) reasons.push('FACE_TOO_SMALL');
```

Với `minFaceSizeRatio` mặc định (mức MEDIUM) là `0.10`, cùng 1 ngưỡng "đạt" này
cho ra kích thước pixel thật rất khác nhau tuỳ độ phân giải camera:

| Độ phân giải camera | faceSizeRatio = 0.10 (mức tối thiểu hiện cho qua) | Có đạt >250px? |
|---|---|---|
| 1920x1080 (camera tốt) | ~192px | Không đạt |
| 1280x720 | ~128px | Không đạt |
| 640x480 (webcam rẻ) | ~64px | Không đạt |

Nói cách khác: **ngay cả camera tốt nhất, ở đúng ngưỡng "tối thiểu" hệ thống
đang cho qua hôm nay, khuôn mặt lưu lại vẫn nhỏ hơn 250px** — ngưỡng hiện tại
chưa từng được đối chiếu với yêu cầu pixel tuyệt đối này.

**Đề xuất:**

- Thêm 1 điều kiện **tuyệt đối theo pixel**, độc lập với `faceSizeRatio`, tính
  trên chính ảnh sẽ lưu (không phải frame phân tích đã downscale —
  `captureBase64Snapshot()` dùng độ phân giải gốc của camera, còn
  `getFrame()` dùng bản đã thu nhỏ cho CV, hai cái khác nhau, phải tính đúng
  trên cái sẽ lưu):
  `faceWidthPx >= 250 && faceHeightPx >= 250`, lý tưởng nằm trong `300-500px`.
- Reason code mới, ví dụ `FACE_RESOLUTION_TOO_LOW`, tách biệt với
  `FACE_TOO_SMALL` hiện tại (`FACE_TOO_SMALL` nói về bố cục trong khung hình,
  reason mới nói về chất lượng in/lưu trữ — hai mối quan tâm khác nhau dù có
  vẻ giống nhau).
- Hệ quả trực tiếp: nếu camera có độ phân giải quá thấp (dưới ~1000px chiều
  rộng khi face chiếm tỷ lệ hợp lý trong khung), **sẽ không bao giờ đạt được
  250px dù đứng gần cỡ nào** — cần yêu cầu tối thiểu về độ phân giải camera đầu
  vào (ví dụ bắt buộc ≥720p) như một điều kiện phần cứng, không chỉ dựa vào
  phần mềm.

**Đã chốt phạm vi áp dụng:** yêu cầu này áp dụng cho **toàn bộ luồng chụp ảnh**,
kể cả luồng 5 góc hiện tại của Looka đang chạy — không phải chỉ dành riêng cho
thiết kế đa camera sắp tới. Nói cách khác đây là một khoảng trống **đang tồn
tại thật trong bản hiện hành**, không phải yêu cầu mới chỉ áp dụng cho tương
lai.

Lưu ý: đây vẫn là tài liệu thảo luận/thiết kế — theo đúng tinh thần "làm docs
trước" đang áp dụng cho cả phiên trao đổi này, việc sửa `QualityEvaluator` để
thêm điều kiện pixel tuyệt đối nói trên **chưa được triển khai**, chỉ mới xác
nhận là việc cần làm và phạm vi áp dụng của nó.

### 2.9. "AI Vision" là gì trong kiến trúc hiện tại? — ĐÃ CHỐT là hệ thống ngoài

**Vấn đề gốc:** Sơ đồ nhắc tới "server AI Vision" như một hệ thống tồn tại sẵn,
và có bước "CLIENT tiền xử lý vector/matrix để giảm tải cho server AI Vision" —
đây là một **phụ thuộc kiến trúc mới, chưa tồn tại** trong codebase Looka hiện
tại (Looka hiện chỉ có: MediaPipe chạy local cho detect/pose/quality, và fs-core
làm kho lưu file — không có khái niệm "AI Vision server" riêng biệt nhận vector
đã tiền xử lý).

**Đã chốt:** "AI Vision server" là hệ thống **đã có sẵn** — bên thứ 3 hoặc hệ
thống khác của đơn vị — **không nằm trong phạm vi xây mới của dự án Looka này**.
Looka chỉ đóng vai trò client gọi sang hệ thống đó, không tự triển khai model
nhận diện/vision phía server.

**Vẫn còn thiếu để thiết kế được phần "CLIENT tiền xử lý"** (chưa chốt, cần
thêm thông tin từ phía sở hữu hệ thống AI Vision, không phải câu hỏi nội bộ
Looka nữa):

- Tài liệu API/giao thức của hệ thống AI Vision đó (REST? gRPC? định dạng
  payload? xác thực?) — đây là việc cần **xin/lấy tài liệu từ bên sở hữu hệ
  thống**, không tự quyết định được từ phía Looka.
- "Tiền xử lý vector/matrix" cụ thể là gì — trích xuất embedding khuôn mặt
  (giống `@face/biometric` đã có trong Looka, hiện đang ở dạng mock theo
  `FIX-PLAN.md`) rồi gửi vector thay vì gửi ảnh thô? Nếu đúng vậy, đây chính là
  phần "Bước 18 — Thay mock bằng model thật" trong `FIX-PLAN.md` đang chờ làm,
  nối thẳng vào yêu cầu này. Nhưng định dạng vector đầu ra cần **khớp với những
  gì hệ thống AI Vision bên ngoài chấp nhận** — không tự định nghĩa được một
  mình.
- Tần suất gọi / độ trễ chấp nhận được, ảnh hưởng tới việc tiền xử lý chạy
  đồng bộ (chặn luồng chụp) hay bất đồng bộ (chụp xong gửi nền).

---

## 3. Kiến trúc cho 5 tính năng ban đầu

### 3.1. Stream — ghi video local trong lúc chụp

Đã chốt: ghi video lưu local (không phải streaming mạng ra ngoài).

- Tận dụng lại đúng pattern `queueCapture()` hiện có (ghi file local + ghi 1
  dòng vào outbox trong cùng 1 transaction) — chỉ khác là input là 1 file video
  thay vì ảnh JPEG, và **không cần cơ chế "stage rồi approve mới upload"** như
  ảnh (theo mục 2.5, video có thể không cần upload lên fs-core ngay, hoặc không
  cần upload luôn — cần chốt riêng).
- Ghi bằng `MediaRecorder` API (chuẩn Web API, không cần thư viện ngoài) trên
  từng `MediaStream` — mỗi trong 3 camera có 1 `MediaRecorder` riêng, start/stop
  đồng thời khi session bắt đầu/kết thúc.
- Metadata cần lưu cho mỗi stream: `cameraId`, `startedAt`, `endedAt`,
  `localPath`, `durationMs`, `sizeBytes`, `mimeType` — 1 bảng riêng
  (`capture_streams` hay tương tự) trong `packages/database`, tách khỏi
  `upload_outbox` (khác lifecycle: ảnh cần approve-rồi-upload, video theo mục
  2.5 có thể có lifecycle khác hẳn).

**Cập nhật 2026-09-05**: campaign giờ có công tắc riêng `recordVideo`
("Quay video trong lúc chụp", CMS + `GET /v1/devices/config`) — mặc định tắt,
kiosk chỉ mở `MediaRecorder`/tạo dòng `capture_streams` khi campaign bật.
Đồng thời sửa xong lỗi ghi hình local không bao giờ "chốt" xong: mọi dòng
`capture_streams` trước đây đều dừng ở `size_bytes=0`/`duration_ms=0`/
`ended_at=null` vì hai effect ghi hình trong `FaceCaptureApp.tsx` chỉ dừng
`MediaRecorder` (và gọi `endVideoStream`) khi `isWorkflowStarted` đổi giá trị
— mà luồng hoàn tất bình thường ("chụp xong → xem lại → Xác nhận & Lưu hồ
sơ") không bao giờ đổi cờ đó về `false`, nên recorder chạy tới khi cả app
tắt hẳn mới dừng. Đã tách một cờ `isRecordingSession` riêng, tắt tường minh
ở đúng 3 điểm kết thúc phiên thật (event `completed` của engine,
`handleCancelWorkflow`, `handleRestart`) thay vì dựa vào `isWorkflowStarted`.
Upload video lên fs-core vẫn để sau (vẫn ngoài phạm vi, theo quyết định sản
phẩm 2026-09-05) — phần này chỉ sửa việc ghi/local hoá.

### 3.2. Đăng ký thiết bị — mỗi kiosk vật lý = 1 thiết bị

**Mô hình triển khai:** `apps/desktop` trong repo này **là 1 bản build duy
nhất**, đóng gói thành 1 file cài đặt, và **chính file cài đặt đó** được cài
giống hệt nhau lên mọi máy kiosk (máy A, máy B, máy C...) — không có chuyện
mỗi thiết bị có 1 bản build code khác nhau, và cũng không cần build lại app
cho từng máy.

Cái khác nhau giữa các kiosk là **cấu hình cục bộ**, không phải code khác
nhau:

- `device_id`/`device_secret` — sinh ra trên CMS lúc đăng ký, giao cho app
  qua mã/file kích hoạt, rồi app mới lưu vào `secrets.dat` riêng của máy đó.
- Camera nào đóng vai trò CENTER/LEFT/RIGHT — app dùng API liệt kê thiết bị
  camera tiêu chuẩn của hệ điều hành/trình duyệt (`enumerateDevices()` —
  chính cơ chế đang dùng hôm nay cho 1 camera, thấy rõ trong component
  `CameraSelector` hiện có), API này tự trả về **bất kỳ camera vật lý nào**
  đang cắm vào máy đó tại thời điểm chạy. CB Help chỉ cần gán vai trò cho các
  camera mà máy tự phát hiện được (nối đúng ý tưởng bảng mapping ở mục 2.1) —
  không cần viết thêm code tích hợp riêng cho từng loại camera. Bước này chỉ
  làm được **trên chính máy kiosk, sau khi cài** (không thể biết trước lúc
  đăng ký trên CMS, vì phụ thuộc camera vật lý nào thực sự cắm vào máy đó).

**Luồng đăng ký/cài đặt:**

```
0. (Nếu chưa có) Admin tạo 1 **campaign** mới trên CMS: tên, mô tả, và
   **thời hạn sử dụng** (để trống = vĩnh viễn, xem quy tắc NULL bên dưới) —
   hạn này áp dụng chung cho MỌI thiết bị đăng ký bên trong campaign đó,
   không đặt riêng lại ở bước 1 dưới đây.
1. Admin vào trang "Đăng ký thiết bị" trên CMS (admin portal, mục 3.4),
   chọn campaign vừa tạo (hoặc 1 campaign có sẵn), rồi nhập: tên thiết bị,
   số góc chụp (nối mục 3.6), API endpoint lấy thông tin xác thực (đơn
   vị/tenant nào sẽ dùng cho thiết bị này). Không nhập hạn ở đây — thiết bị
   kế thừa hạn của campaign.
   → Mã thiết bị (device_id) do HỆ THỐNG TỰ SINH — admin không tự gõ.
2. CMS tạo 1 bản ghi thiết bị (status: đã đăng ký, chưa kích hoạt) + sinh
   kèm 1 device_secret, ghi cả hai (cùng các cấu hình vừa nhập) vào 1 file
   kích hoạt (VD `activation.json`) riêng cho lần đăng ký này.
3. CMS đóng gói (zip) ngay lúc đó file kích hoạt vừa sinh cùng bản installer
   app desktop (installer là **file tĩnh có sẵn, giống hệt nhau mọi lần** —
   không build lại code, chỉ copy vào gói) thành **1 file duy nhất** để admin
   bấm tải — VD `looka-kiosk-<device_id>.zip`.
4. CB Help/kỹ thuật nhận file zip đó, giải nén, chạy installer trên máy
   kiosk vật lý; app đọc `activation.json` đi kèm trong gói ngay khi cài đặt
   (không cần dán mã tay) → lưu device_id/device_secret nhận được vào
   `secrets.dat` (đúng cơ chế mã hoá `safeStorage` đã có sẵn trong
   `apps/desktop/src/main/secrets.ts`) và bắt đầu hoạt động theo đúng cấu
   hình + thời hạn đã đăng ký từ bước 1.
```

**Campaign — nhóm nhiều thiết bị lại với nhau:**

Một admin có thể đăng ký **nhiều thiết bị cho nhiều campaign khác nhau**
(VD "Đợt chụp thẻ SV — Tháng 9/2026 — Trường ABC" là 1 campaign, chứa N
thiết bị đăng ký bên trong). Mô hình đơn giản:

- `campaigns` là 1 bảng riêng trên admin portal (id, tên, mô tả, thời điểm
  tạo) — mỗi thiết bị (`devices.campaign_id`) thuộc về đúng 1 campaign, chọn
  lúc đăng ký (bước 1 ở luồng trên).
- Quan hệ **1 campaign → N thiết bị**, không phải chiều ngược lại.
- **Không cần API "chuyển campaign" cho thiết bị đã đăng ký.** Vì mỗi gói
  tải về (zip installer + activation, bước 3) đã tự mang theo hạn dùng
  riêng của nó — khi hết hạn, gói đó (và device_id gắn với nó) tự ngừng hoạt
  động theo đúng cơ chế chặn đã chốt ở mục 3.3, không cần thao tác gì thêm.
  Muốn dùng lại **cùng 1 máy vật lý** cho 1 campaign mới: chỉ cần đăng ký
  mới trên CMS (chọn/tạo campaign mới) → tải gói zip mới → cài đè lên máy
  đó. Đây là 1 lần đăng ký hoàn toàn độc lập, sinh `device_id` mới — không
  phải "gia hạn" hay "đổi campaign" cho bản ghi cũ.
- Hệ quả cho mục 3.4 (thống kê): cần thêm 1 chiều lọc/gộp theo **campaign**
  (không chỉ theo từng thiết bị riêng lẻ) — VD "tổng số ảnh chụp được của
  toàn bộ campaign X", cộng dồn từ mọi thiết bị thuộc campaign đó.

- **Quy tắc mặc định khi không truyền ngày hết hạn:** cột lưu ngày hết hạn
  (`campaigns.expires_at` — **không phải cột trên bảng thiết bị**, xem cập
  nhật campaign-level ở trên) để **NULL = vĩnh viễn**, không phải 1 giá trị
  đặc biệt kiểu "9999-12-31" hay tương tự — middleware kiểm tra hạn (mục 3.3)
  phải hiểu rõ `NULL` nghĩa là "không bao giờ chặn", tránh lỗi kinh điển là
  hiểu nhầm `NULL`/`undefined` thành "đã hết hạn" (hết hạn = rỗng) thay vì
  "chưa từng đặt hạn" (không giới hạn).
- Mọi request từ kiosk lên backend Looka (`apps/api`) và lên admin portal cần
  gắn `device_id` + `device_secret` (như 1 header riêng, song song với
  `x-api-key` hiện tại) — đây là nền tảng để mục 3.3 (chặn khi hết hạn) và
  3.4 (thống kê theo thiết bị) hoạt động được.

**Đã chốt (qua trao đổi):**

- **Admin là người thực hiện đăng ký**, không phải app tự động tự đăng ký.
  Người quản trị chủ động đăng ký thiết bị trên CMS **trước khi** app được
  cài lên máy nào cả (xem luồng mới ở trên).
- **Cơ chế nạp kích hoạt: app tự đọc file, không dán mã tay** — CMS đóng gói
  sẵn `activation.json` cùng installer vào 1 file zip tải về (bước 3 ở luồng
  trên), nên khi cài đặt app tự tìm và đọc file này ngay cạnh installer —
  không cần CB Help gõ tay bất kỳ mã kích hoạt nào.
- **Trạng thái "đã cài nhưng chưa nạp mã kích hoạt": chặn hoàn toàn**, không
  gọi được API nào — cùng triết lý với lúc hết hạn ("đến hạn thì không được
  call bất kỳ gì nữa", mục 3.3): app cài xong mà chưa nạp mã kích hoạt (dù
  thiết bị đã có bản ghi đăng ký trên CMS từ trước) thì vẫn chưa có danh tính
  hợp lệ để gọi API, không có trạng thái "chạy giới hạn" ở giữa.
- **Vĩnh viễn ↔ có hạn: đổi được (gia hạn được)** — admin set/sửa hạn ở cấp
  **campaign**; gia hạn 1 campaign tự động gia hạn **mọi thiết bị** đăng ký
  bên trong nó cùng lúc (không cần sửa từng thiết bị). Đây là thao tác quản
  trị nên có audit trail riêng (nối mục 2.7).

### 3.3. Chặn API khi hết hạn — cả 2 lớp, và kết nối kiosk ↔ backend

Đã chốt: chặn ở cả backend Looka và fs-core.

**Lưu ý kiến trúc:** `apps/desktop` (kiosk) **hiện không hề gọi tới
`apps/api`** — nó đi thẳng tới fs-core qua `FsClient` (tự provision key
riêng, lưu `fs.baseUrl`/`fs.apiKey` trong `secrets.dat`, xem
`apps/desktop/src/main/secrets.ts`). `apps/api` hiện chỉ được luồng
**web** dùng (qua `HttpCaptureSink`). Vì vậy phần "Lớp Looka (`apps/api`)"
bên dưới **chỉ áp dụng đúng nghĩa cho luồng web** — với kiosk desktop, cần
1 kết nối riêng, từ kiosk thẳng tới admin portal (không qua `apps/api`),
phục vụ đúng 2 việc: kiểm tra hạn dùng, và đẩy dữ liệu thống kê.

- **Lớp Looka (`apps/api`) — áp dụng cho luồng web:** 1 middleware mới (song
  song `ApiKeyMiddleware` hiện có), kiểm tra `device_id` gửi lên còn hạn
  không (join sang campaign của thiết bị đó, tra `campaigns.expires_at`,
  không phải cột trên bảng thiết bị — xem mục 3.2) → hết hạn thì trả lỗi rõ
  ràng (`DEVICE_EXPIRED`), chặn trước khi chạm tới
  logic tạo session/upload. `expires_at = NULL` (campaign vĩnh viễn) → luôn
  cho qua; chỉ chặn khi có giá trị **và** giá trị đó đã ở quá khứ.
- **Kết nối mới cho kiosk desktop — `DeviceApiClient` trong
  `apps/desktop/src/main`** (song song `FsClient` đã có, nhưng trỏ tới admin
  portal thay vì fs-core):
  - **Kiểm tra hạn dùng:** gọi `GET /devices/:device_id/status` lúc app khởi
    động + định kỳ (VD mỗi 15-30 phút) → nhận `{ valid, reason, expiresAt }`.
    Cache kết quả cục bộ (đúng tinh thần "cache ngắn hạn" đã nêu) — kiosk vốn
    offline-first, không thể để mỗi thao tác chụp phải chờ gọi mạng thành
    công mới cho chạy. Đề xuất: dùng kết quả cache tối đa **24h** kể từ lần
    gọi thành công cuối, quá mốc đó mà vẫn không liên lạc được với admin
    portal thì mới chuyển sang chặn (fail-closed) — cân bằng giữa "không
    chặn nhầm kiosk đang mất mạng tạm thời" và "không để 1 thiết bị hết hạn
    chạy vô thời hạn chỉ vì ngắt mạng".
  - **Đẩy dữ liệu thống kê (mục 3.4):** tái dùng đúng pattern
    `UploadOutboxRepository`/`UploadWorker` đã có — thêm 1 bảng
    `stats_event_outbox` cục bộ (session hoàn tất, upload thành công/lỗi, số
    lần chụp lại, lần cần CB Help can thiệp), có worker riêng gửi định kỳ
    lên admin portal, tận dụng lại cơ chế retry/queue đã được kiểm chứng
    thay vì viết mới từ đầu.
  - Cả 2 việc trên đều **không được chặn luồng chụp ảnh chính** — chỉ có kết
    quả "hết hạn đã xác nhận" (không phải "không liên lạc được") mới thực sự
    chặn app, đúng triết lý offline-first của toàn hệ thống.
- **Cùng cơ chế này cũng phải chặn thiết bị chưa từng đăng ký** (không có
  `device_id` hợp lệ nào trong bảng thiết bị), không chỉ thiết bị đã đăng ký
  nhưng hết hạn — hai điều kiện chặn khác nhau (chưa tồn tại vs. tồn tại
  nhưng hết hạn) nhưng cùng một kết quả: chặn hoàn toàn, không có trạng thái
  trung gian "chạy giới hạn". Chi tiết quyết định này ở mục 3.2.
- **Lớp fs-core**: mỗi thiết bị nên có **API key riêng của fs-core** (không
  dùng chung 1 key cho toàn bộ kiosk như cách `apps/desktop` đang làm — mỗi kiosk
  tự provision key riêng qua `FsClient.provision()` với `tenant_name` là chính
  `device_id`), để khi cần thu hồi 1 thiết bị hết hạn, chỉ cần vô hiệu hoá đúng
  key đó bên fs-core mà không ảnh hưởng thiết bị khác — đây cũng đúng tinh thần
  "cả 2 lớp chặn độc lập nhau" đã chọn, không phải 1 lớp giả, 1 lớp thật.
- Cảnh báo trước hạn: admin portal nên cấu hình được ngưỡng cảnh báo (ví dụ còn
  7 ngày) để thông báo cho người quản lý trước khi thiết bị thực sự bị chặn,
  tránh kiosk đột ngột ngừng hoạt động giữa ca mà không ai biết trước — vì hạn
  giờ nằm ở cấp campaign, cảnh báo này nên gộp theo campaign ("campaign X sắp
  hết hạn, ảnh hưởng N thiết bị") thay vì báo riêng lẻ từng thiết bị.

### 3.4. Admin portal riêng — đăng ký, hết hạn, thống kê

Đã chốt: xây service/portal riêng, tách khỏi `apps/api`, và làm **trọn bộ
website + API + UI ngay từ đầu** — không chia giai đoạn "API-only trước, UI
sau" như phương án đã cân nhắc ban đầu.

- **Vì sao tách riêng hợp lý:** `apps/api` hiện tại đóng vai trò "vận hành"
  (nhận ảnh, đẩy fs-core) — thêm vào đó toàn bộ nghiệp vụ quản trị (CRUD thiết
  bị, dashboard thống kê, quản lý hết hạn) sẽ làm phình to 1 service vốn đang
  gọn, và trộn lẫn 2 nhóm người dùng khác nhau (kiosk vận hành tự động vs. người
  quản trị dùng trình duyệt) vào chung 1 codebase.
- **Kiến trúc đề xuất:** service admin portal riêng (NestJS hoặc framework
  khác tuỳ chọn), sở hữu DB riêng cho: bảng **campaigns** (id, tên, mô tả —
  xem mục 3.2), bảng thiết bị (device_id, tên, `campaign_id`, đơn vị, ngày
  kích hoạt, ngày hết hạn, loại tài liệu cho phép, trạng thái), bảng log sự
  kiện theo thiết bị (mỗi lần upload/lỗi/manual confirm — nối dữ liệu này
  từ `apps/api` gửi sang, ví dụ qua webhook hoặc queue, để `apps/api` không cần
  biết chi tiết schema thống kê).
- **Hiện trạng đã có trong code (nhưng chưa dùng được):** `packages/database`
  đã có sẵn `UploadOutboxRepository.stats()` (trả về `OutboxStats`: số lượng
  đang `pending`/`sending`/`awaitingScan`/`failedPermanent`, thời điểm job chờ
  lâu nhất) và `apps/desktop` đã wire nó thành `uploadStatus()` qua IPC. Nhưng
  đây chỉ là **snapshot tức thời** (đúng lúc gọi, không lưu lịch sử) — và quan
  trọng hơn: **hiện chưa có màn hình nào trong app gọi tới nó cả**, nên dữ
  liệu này thực ra vô hình với người dùng hôm nay dù cơ chế đã tồn tại.
- **Thống kê tối thiểu cần có** theo yêu cầu ban đầu (upload bao nhiêu, lỗi bao
  nhiêu): số session hoàn tất / đang dở / thất bại; số ảnh + video upload thành
  công vs. thất bại (nối `fs_status`/`last_error` đã có sẵn trong
  `upload_outbox` — chỉ cần đẩy dữ liệu này sang, không cần tính toán lại từ
  đầu); tỷ lệ phải chụp lại (nối số lần "Chụp lại"/attempts đã có trong DB);
  số lần cần CB Help can thiệp (nối mục 2.2 + 2.7). Mọi số liệu trên cần xem
  được **theo từng thiết bị lẫn cộng dồn theo campaign** (mục 3.2) — dashboard
  nên cho lọc/group theo campaign, không chỉ liệt kê từng thiết bị rời rạc.
- **Mở rộng thêm (qua trao đổi): cần cả thời gian trung bình, không chỉ số
  lượng.** Ví dụ: thời gian trung bình từ lúc chụp tới lúc upload xong, thời
  gian trung bình xử lý 1 session trọn vẹn. Đây là yêu cầu về **dữ liệu lịch
  sử có mốc thời gian**, khác hẳn snapshot tức thời ở trên — cần tổng hợp theo
  thời gian (theo ngày/theo thiết bị), không phải chỉ đếm trạng thái hiện tại.
- **Khoảng trống cần lấp trước khi tính được "thời gian trung bình" đúng
  nghĩa:** bảng `upload_outbox` hôm nay chỉ có `created_at` (lúc chụp/xếp
  hàng) và `done_at` (lúc xong) — hiệu số 2 cột này gộp chung cả thời gian
  **chờ CB Help bấm xác nhận** (có thể vài giây tới vài phút, tuỳ người) lẫn
  thời gian **upload thật sự** (mạng, fs-core xử lý), nên không tách được đâu
  là chậm do mạng, đâu là chậm do người thao tác chậm. Cũng chưa có mốc thời
  gian cho **từng lần thử lại** (`attempts` hiện chỉ là 1 con số đếm, không
  phải nhật ký — không biết lần thử thứ 2 xảy ra lúc nào, cách lần đầu bao
  lâu). Cần thêm ghi log mốc thời gian chi tiết hơn:
  - `sending_started_at` (khi worker thực sự bắt đầu gửi, phân biệt với
    `created_at` là lúc xếp hàng) — cho phép tính đúng "thời gian upload thật"
    tách khỏi "thời gian chờ hàng đợi/chờ duyệt".
  - 1 nhật ký riêng cho từng lần thử (ví dụ bảng `upload_attempt_log`: outbox
    id, số thứ tự lần thử, thời điểm bắt đầu, thời điểm kết thúc, lỗi nếu có)
    thay vì chỉ giữ lại lần thử cuối — cần cho biết "hay bị lỗi ở lần thử thứ
    mấy", không chỉ "có lỗi hay không".
  - Cân nhắc thêm mốc `approved_at → done_at` riêng (đã có `approved_at` từ
    migration 005) để có phép đo "thời gian upload sau khi được duyệt", tách
    bạch khỏi thời gian chờ duyệt.
- **Vì làm trọn bộ ngay từ đầu**, phần UI (dashboard CRUD thiết bị, xem thống
  kê) cần được lên kế hoạch triển khai song song với API trong cùng 1 phase
  implementation-plan, thay vì tách thành 1 phase UI riêng ở cuối — ảnh hưởng
  tới cách chia mốc (milestone) khi viết implementation plan chính thức sau
  này.

### 3.5. Màn hình mở rộng cho CB Help — theo dõi real-time — ĐÃ CHỐT

**Ý tưởng:** thay vì "Máy điều khiển" (nhắc ở mục 1) là 1 thiết bị vật lý tách
biệt hoàn toàn, dùng chính máy kiosk đang chạy Looka, cắm thêm **1 màn hình
thứ 2** (extended display — mở rộng desktop, không phải nhân bản/mirror). Màn
1 (chính) tiếp tục hiển thị giao diện chụp cho SV như hiện tại; màn 2 (phụ, có
thể nhỏ hơn) hiển thị giao diện **chỉ để xem** — ảnh đang chụp theo thời gian
thực.

**Đã chốt (qua trao đổi) — trả lời cả 3 câu hỏi từng đặt ra:**

1. **Chỉ xem (read-only), không thao tác quản lý.** Mục đích không chỉ để
   CB Help theo dõi, mà còn để **công khai, minh bạch** quy trình — tức là màn
   phụ có thể là thứ hiển thị cho nhiều người thấy được (không chỉ riêng CB
   Help), như một bằng chứng trực quan rằng quy trình chụp đang diễn ra đúng,
   không có can thiệp khuất tất. Vì không có thao tác gì trên đó, **không cần
   thêm đăng nhập/phân quyền cho màn phụ này**.
2. **Là màn mở rộng của chính máy kiosk** — cùng 1 máy đang kết nối 3 camera
   và thực hiện việc chụp, không phải thiết bị/máy tính riêng của CB Help.
   Đúng phương án đơn giản (Electron multi-window, IPC nội bộ) đã nêu bên
   dưới, không cần thêm lớp giao tiếp mạng.
3. **Đúng là cách hiện thực hoá "Máy điều khiển"** — hình dung như các "tab"
   khác được mở rộng ra màn hình phụ chỉ để xem (ví dụ: 1 tab xem cả 3 view
   camera, 1 tab xem trạng thái từng bước) — không phải 1 khái niệm tách biệt
   nào khác cho riêng kịch bản 3-camera.

**Hệ quả cần lưu ý (phát sinh trực tiếp từ quyết định "chỉ xem"):** những thao
tác quản lý đã giả định trước đó là "CB Help làm trên Máy điều khiển" — chọn
camera thay thế khi hỏng (mục 2.1), can thiệp khi quá ngưỡng retry/timeout
(mục 2.2), xử lý NOT_FOUND/DUPLICATE/AMBIGUOUS (mục 2.3), thao tác Manual
confirm (mục 2.7) — **không còn chỗ để xảy ra**, vì màn phụ giờ đã xác định là
view-only. Các thao tác đó cần 1 bề mặt UI khác (nhiều khả năng vẫn là màn
kiosk chính, có thể qua 1 "chế độ CB Help" riêng tạm ẩn giao diện SV) — đây
là câu hỏi mới, xem mục 4.

**Vì sao đơn giản hơn phương án 1 thiết bị tách biệt hoàn toàn:** không cần
đồng bộ qua mạng, không cần thêm 1 máy tính riêng, không cần lo độ trễ hiển
thị ảnh real-time — vì cả 2 màn hình cùng thuộc 1 tiến trình Electron duy
nhất, main process có thể phát sự kiện tới cả 2 cửa sổ renderer cùng lúc
ngay khi có ảnh mới, không cần polling hay gọi API riêng.

**Cơ chế kỹ thuật khả thi** (Electron đã hỗ trợ sẵn, không cần thư viện
ngoài — chỉ ghi nhận hướng đi, chưa triển khai):

- API `screen.getAllDisplays()` của Electron liệt kê các màn hình đang cắm
  vào máy; tạo 1 `BrowserWindow` thứ 2, đặt vị trí (`x`, `y`) trùng với
  `bounds` của màn hình phụ đó — cách chuẩn để "đẩy" 1 cửa sổ sang màn mở
  rộng.
- Cả 2 cửa sổ (SV-facing + CB Help-facing) cùng chạy trong 1 Electron app
  nên có thể tái dùng cơ chế `ipcMain`/`webContents.send` đã có sẵn (đang
  dùng cho các luồng khác trong `apps/desktop/src/main`) để broadcast sự
  kiện chụp ảnh sang cửa sổ CB Help ngay khi 1 ảnh được lưu.
- Yêu cầu phần cứng đi kèm: máy kiosk cần ít nhất 2 cổng xuất hình (hoặc
  USB-to-HDMI), hệ điều hành đặt chế độ "Extend" (mở rộng) chứ không phải
  "Duplicate" (nhân bản) — đây là bước cấu hình OS, không phải phần mềm.

**Nội dung màn phụ (CB Help) — thuần xem, không có nút thao tác:**

- Ảnh vừa chụp hiện ra ngay (thumbnail feed theo thời gian thực), trạng thái
  từng bước (FRONT/LEFT/RIGHT/DOWN đã chụp hay chưa), trạng thái camera còn
  sống/rớt (nối mục 2.1) — tất cả ở dạng hiển thị, không có nút bấm nào thực
  hiện hành động lên hệ thống.
- Vì mục đích còn là "công khai, minh bạch", nội dung hiển thị nên tránh lộ
  thông tin cá nhân nhạy cảm không cần thiết cho mục đích giám sát quy trình
  (ví dụ: có cần che một phần thông tin định danh SV trên màn phụ, nếu màn
  này người ngoài cũng nhìn thấy được?) — điểm này nối với mục 2.4 (consent),
  cần cân nhắc thêm khi thiết kế chi tiết.

**Cập nhật 2026-09-05 (quyết định từ product owner — thay đổi so với bản chốt
ở trên):** màn phụ **không** còn tự mở khi khởi động nữa — chỉ mở khi thao
tác viên chủ động bật, qua `Ctrl/Cmd+Shift+H` hoặc 1 nút trong giao diện kiosk
("Màn hình mở rộng"), và tắt cũng bằng chính 2 cách đó (toggle). Nội dung màn
phụ cũng đổi khác với phần "Nội dung màn phụ" đã mô tả ở trên: thay vì 1 màn
hình theo dõi riêng (ảnh vừa chụp + trạng thái từng bước), giờ là **nhân bản
chính xác** những gì thao tác viên đang thấy ở màn kiosk chính (camera trực
tiếp, hướng dẫn, review — toàn bộ giao diện), qua
`session.defaultSession.setDisplayMediaRequestHandler` của Electron cấp
`webContents.mainFrame` của cửa sổ chính cho `getDisplayMedia()` gọi từ cửa sổ
CB Help. Xem chi tiết hiện thực ở `apps/desktop/src/main/cbHelpWindow.ts` và
`apps/desktop/src/renderer/CbHelpMirror.tsx` (đổi tên từ `CbHelpMonitor.tsx`).

**Cập nhật 2026-09-05 (quyết định từ product owner — đổi lại lần nữa, ngay
trong cùng ngày):** màn phụ **không** nhân bản nguyên màn hình chính nữa —
quay lại hướng chỉ hiển thị các khung hình chụp (live + ảnh đã chụp), không
phải toàn bộ giao diện. Chế độ chụp đồng thời: mỗi khung hình một ô, tất cả
đang live cùng lúc, ô nào chụp xong thì đổi sang ảnh vừa chụp. Chế độ tuần tự
(từng bước): mỗi bước một ô, ô của bước hiện tại thì live, bước đã xong hiện
ảnh, bước chưa tới hiện placeholder. Vẫn mở/đóng theo yêu cầu qua
`Ctrl/Cmd+Shift+H` hoặc nút "Màn hình mở rộng" như quyết định phía trên, chỉ
đổi phần nội dung hiển thị bên trong. Hiện thực ở
`apps/desktop/src/renderer/CbHelpFrames.tsx` (thay `CbHelpMirror.tsx`), IPC
mới `cbhelp:publish`/`cbhelp:getState`/`cbhelp:update` (kiosk chính đẩy một
snapshot gọn — trạng thái + `deviceId` từng khung — mỗi khi có thay đổi, màn
phụ tự mở `getUserMedia` riêng cho từng camera cần live). Xem chi tiết đầy đủ
ở docs/ROADMAP.md mục 3.5 (đã cập nhật theo quyết định này).

### 3.6. Số góc chụp cấu hình được theo từng thiết bị — ĐÃ CHỐT

**Đã chốt (qua trao đổi):** số lượng và loại góc chụp — hiện tại luôn là 5
góc cố định (FRONT/LEFT/RIGHT/UP/DOWN) — sẽ **cấu hình được riêng theo từng
thiết bị**, thay vì cố định giống nhau cho mọi kiosk.

**Cập nhật 2026-09-05 (quyết định từ product owner):** số khung chụp tối
thiểu hạ từ 3 xuống **2** (vẫn tối đa 5, FRONT vẫn bắt buộc) — lý do: 1 kiosk
chỉ có 2 camera vật lý cũng cần chạy được chế độ chụp đồng thời
(`simultaneousCapture`), mà chế độ đó cần tối thiểu 2 khung/vai trò riêng biệt
nên ngưỡng tối thiểu 3 khung trước đây chặn đúng trường hợp này. Đã sửa
`MIN_STEPS` trong `capture-angles.validator.ts` (và spec), `MIN_FRAMES` trong
`CaptureFramesEditor.tsx`, cùng ngưỡng `tooFewFrames` ở `CampaignList.tsx`/
`CampaignDetail.tsx`. Xem thêm docs/ROADMAP.md mục 3.6b.

**Cập nhật 2026-09-05 (quyết định UX từ product owner — "Gán camera cho các
góc, chứ không phải các góc cho camera"):** màn Camera Setup
(`CameraSetupScreen.tsx`) giờ đọc `captureAngles` của chiến dịch (qua
`getDeviceAccessStatus()`) để suy ra danh sách vai trò camera *cần* gán và
hiển thị mỗi vai trò một dòng (preview trực tiếp + dropdown chọn camera) —
thay vì liệt kê camera trước rồi hỏi gán vai trò nào như bản cũ, chiều ngược
dễ bỏ sót một góc bắt buộc. Không có chiến dịch (web/dev chưa kích hoạt) vẫn
hiển thị đủ 5 vai trò như trước. Vai trò chiến dịch không cần được gộp vào
mục thu gọn "Góc khác" để CB Help vẫn gán trước được nếu muốn; chọn một
camera đã dùng cho vai trò khác sẽ *chuyển* nó sang vai trò mới (kèm ghi chú
ngắn), và màn hình cảnh báo khi còn vai trò cần thiết chưa gán hoặc hai vai
trò cần thiết dùng chung một camera — đúng hai điều kiện `checkFramesReadiness`
(packages/ui/src/lib/multiFrame.ts) dùng để chặn phiên chụp. Danh sách camera
cũng cập nhật theo sự kiện `devicechange` (cắm/rút khi cửa sổ đang mở) thay vì
chỉ dò một lần lúc mở như trước. Định dạng lưu
(`Record<CameraRole, deviceId>` qua `camera:getRoleMapping`/
`camera:setRoleMapping`) không đổi.

**Hiện trạng trong code (khoảng trống thật, không chỉ là thiết kế tương
lai):** danh sách 5 bước này là 1 hằng số hardcode —
`defaultWorkflow` trong [`FaceCaptureApp.tsx`](../../packages/ui/src/components/screens/FaceCaptureApp.tsx)
— giống hệt nhau trên mọi bản build. Không có cơ chế nào đọc cấu hình này từ
bên ngoài; muốn đổi số góc chụp hôm nay chỉ có cách duy nhất là sửa code rồi
build lại.

**Vì sao khả thi mà không cần build riêng từng app:** mỗi bước trong workflow
(`CaptureStep` — id, instruction, góc pose mục tiêu, dung sai, ngưỡng chất
lượng, có check tư thế hay không) đã là dữ liệu thuần tuý (định nghĩa ở
`packages/core/src/types/workflow.ts`), không phải logic code. Vì vậy có thể
nối thẳng vào đúng cơ chế cấu hình theo thiết bị đã bàn ở mục 3.2 — thay vì
`defaultWorkflow` hardcode trong app, app tải danh sách bước từ cấu hình thiết
bị (lấy lúc đăng ký/mỗi lần khởi động), y hệt cách "loại tài liệu: ảnh/video/
cả hai" đã được đưa vào cấu hình đó.

**Câu hỏi cần làm rõ** (ảnh hưởng trực tiếp tới độ phức tạp khi xây):

1. Cấu hình được ở mức nào — **chọn bật/tắt trong 1 danh mục cố định** (bớt
   góc trong 5 góc có sẵn: FRONT/LEFT/RIGHT/UP/DOWN), hay **tự định nghĩa góc
   mới hoàn toàn** (góc, dung sai, hướng dẫn riêng do admin portal nhập)? Cách
   đầu đơn giản hơn nhiều — chỉ cần 1 danh sách checkbox trên admin portal;
   cách sau cần cả 1 trình soạn thảo workflow, phức tạp hơn hẳn.
2. FRONT có luôn bắt buộc, không được tắt, hay cũng tuỳ chọn như các góc
   khác? (Ảnh FRONT thường là ảnh chính dùng để in/hiển thị/nhận diện, tương
   tự lý do C0 luôn bắt buộc ở mục 2.1.)
3. Đổi cấu hình cho 1 thiết bị đã đăng ký — áp dụng ngay cho phiên chụp tiếp
   theo, hay cần khởi động lại app?

### 3.7. Mở rộng: đăng ký KYC/FaceID cho hệ thống ngoài

**Yêu cầu:** hạ tầng campaign/thiết bị đang thiết kế cần dùng lại được cho 1
mục đích khác ngoài "chụp thẻ SV" — SV/người dùng chụp các góc mặt để **đăng
ký hồ sơ KYC/FaceID** cho 1 hệ thống KYC/nhận diện đã có sẵn (khớp đúng mô tả
"AI Vision server" đã chốt ở mục 2.9: hệ thống bên ngoài, Looka không tự xây
recognition). Đây **không phải quét/xác thực 1:1 hay 1:N** (Looka không tự so
khớp danh tính) — vẫn là 1 luồng **capture nhiều góc mặt**, chỉ khác điểm đến
của dữ liệu sau khi chụp.

**Vì sao tận dụng được gần như nguyên vẹn hạ tầng đã thiết kế:**

- Về mặt UI/capture, đây chính là luồng đã có (`FaceCaptureApp`, workflow
  nhiều bước) — không cần màn hình mới, chỉ khác **bộ góc chụp yêu cầu** (có
  thể không phải đúng 5 góc FRONT/LEFT/RIGHT/UP/DOWN hiện tại, mà theo đúng
  spec góc mà hệ thống KYC/AI Vision bên ngoài yêu cầu) — nối thẳng vào cơ
  chế **số góc chụp cấu hình theo thiết bị** đã chốt ở mục 3.6.
- Khác biệt thật sự nằm ở **đích đến của dữ liệu sau khi chụp**: campaign
  "chụp thẻ SV" hiện tại lưu ảnh lên fs-core (in thẻ); campaign "đăng ký
  KYC/FaceID" cần thêm 1 đích gửi khác — gửi ảnh (hoặc vector đã tiền xử lý,
  đúng khái niệm "CLIENT tiền xử lý" còn bỏ ngỏ ở mục 2.9) sang API của hệ
  thống KYC/AI Vision ngoài đó.
- Đề xuất: thêm 1 field **"mục đích campaign"** (VD `purpose`:
  `STUDENT_CARD` | `KYC_ENROLLMENT`) lúc tạo campaign (mục 3.2) — dùng field
  này để quyết định: (a) bộ góc chụp mặc định gợi ý (không bắt buộc, admin
  vẫn chỉnh được qua cơ chế 3.6), và (b) ảnh chụp xong route tới đích nào
  (fs-core, hay API của hệ thống KYC ngoài, hoặc cả hai).
- **Vẫn còn đúng khoảng trống đã nêu ở mục 2.9, chưa giải quyết ở đây**: cần
  tài liệu API/giao thức thật từ bên sở hữu hệ thống KYC/AI Vision (REST?
  định dạng ảnh hay vector? xác thực bằng gì?) trước khi thiết kế được chi
  tiết bước "gửi đi" này — mục 3.7 này chỉ xác nhận **nó dùng chung hạ tầng
  campaign/thiết bị**, chưa chốt được giao thức gửi dữ liệu cụ thể.

### 3.8. Chế độ kích hoạt chụp (AUTO/MANUAL) cấu hình theo campaign

**Hiện trạng trong code:** `WorkflowEngine` đã có sẵn cả 2 chế độ —
`setCaptureTriggerConfig({ mode, autoHoldMs })` nhận `mode: 'AUTO' | 'MANUAL'
| 'OFF'`; `AUTO` tự chụp khi giữ đúng tư thế đủ `autoHoldMs`; `MANUAL` chờ SV
hoặc CB Help bấm nút/cử chỉ để gọi `triggerManualCapture()` (đã sửa để
re-check đúng quality gate của bước hiện tại tại đúng thời điểm bấm, không
tin vào trạng thái cũ). Vấn đề: giá trị `mode`/`autoHoldMs` hiện đọc từ
`getSettings()` — **1 cấu hình cục bộ trên từng máy** (chỉnh qua debug
panel), không phải cấu hình tập trung, nên đổi chế độ hôm nay phải làm tay
từng máy.

**Đề xuất:** nối `captureMode` (+ `autoHoldMs` khi ở AUTO) vào đúng cơ chế
cấu hình theo campaign đã dùng cho số góc chụp (mục 3.6) — cùng 1 lần gọi
cấu hình lúc đăng ký/khởi động, thêm 1 field nữa vào cùng payload, không
phải xây cơ chế tải cấu hình riêng.

**Yêu cầu trước mắt:** mặc định chế độ chụp là **MANUAL — SV/CB Help chủ
động bấm nút chụp**, thay vì AUTO như code hiện đang mặc định
(`getSettings().captureMode || 'AUTO'`). AUTO vẫn giữ để dùng khi campaign
bật lên qua cấu hình, không xoá code, chỉ đổi hành vi mặc định khi campaign
chưa cấu hình gì.

---

## 4. Câu hỏi / quyết định còn mở

### Đã chốt (RESOLVED)

1. ~~Camera rớt giữa session: huỷ toàn bộ hay tiếp tục với camera còn lại?~~
   → **RESOLVED**: C0 (giữa) bắt buộc phải sống — hỏng thì dừng session. C1/C2
   (2 bên) hot-swap thủ công qua CB Help (chỉ định camera khác bù vai trò), hệ
   thống không tự huỷ session cũng không tự bỏ qua góc thiếu. Chi tiết mục 2.1.
4. ~~Nội dung + cơ chế consent — có cần đúng từ pháp lý cụ thể không, hay tạm
   thời dùng 1 câu chung chung?~~ → **RESOLVED một phần**: cơ chế đã chốt —
   nội dung consent cấu hình theo **campaign** (versioned, mặc định 1 nội
   dung chung chung nếu chưa cấu hình riêng), lưu lại thời điểm + bản đã
   hiển thị + ai xác nhận cho mỗi session, luôn hỏi lại mỗi session kể cả
   chụp lại. **Câu chữ pháp lý cụ thể vẫn cần lấy từ bên có thẩm quyền của
   đơn vị triển khai** — Looka không tự soạn nội dung. Chi tiết mục 2.4.
5. ~~"AI Vision" server: đã có sẵn hay cần xây mới? Giao thức giao tiếp là
   gì?~~ → **RESOLVED một phần**: đã có sẵn, bên thứ 3/hệ thống khác của đơn vị
   — không xây mới. Giao thức cụ thể (REST/gRPC, định dạng payload) **vẫn cần
   xin tài liệu từ bên sở hữu hệ thống** trước khi thiết kế client-side
   preprocessing. Chi tiết mục 2.9.
6. ~~Admin portal giai đoạn 1: cần UI web ngay, hay API-only trước?~~ →
   **RESOLVED**: làm trọn bộ website + API + UI ngay từ đầu, không chia giai
   đoạn. Chi tiết mục 3.4.
8. ~~Yêu cầu độ phân giải khuôn mặt >250x250 (mục 2.8): sửa ngay trong luồng 5
   góc hiện tại của Looka, hay chỉ áp dụng cho thiết kế đa camera sắp tới?~~ →
   **RESOLVED**: áp dụng cho toàn bộ luồng chụp ảnh, kể cả luồng hiện tại —
   là một khoảng trống có thật trong code hiện hành, không chỉ là spec tương
   lai. Chưa triển khai (đúng tinh thần làm docs trước), chỉ đã chốt phạm vi.
   Chi tiết mục 2.8.
11. ~~Màn phụ cho CB Help (mục 3.5) chỉ xem hay cũng thao tác quản lý? Là màn
    mở rộng cùng máy kiosk hay thiết bị riêng? Có phải chính là "Máy điều
    khiển" đã nhắc ở mục 1?~~ → **RESOLVED**: chỉ xem (read-only), không có
    thao tác quản lý — mục đích còn để công khai/minh bạch quy trình, nên
    không cần đăng nhập/phân quyền riêng. Là màn mở rộng của chính máy kiosk
    (không phải thiết bị riêng). Đúng là cách hiện thực hoá "Máy điều khiển".
    Chi tiết mục 3.5.
12. ~~Số góc chụp (5 góc hiện tại): cố định giống mọi kiosk, hay cấu hình được
    theo từng thiết bị?~~ → **RESOLVED**: cấu hình được theo từng thiết bị,
    nối vào cơ chế cấu hình đăng ký thiết bị ở mục 3.2. Hiện tại đang hardcode
    trong `defaultWorkflow`, chưa triển khai thay đổi. Chi tiết mục 3.6.
17. ~~Trạng thái "đã cài, chưa đăng ký" có chạy được không? Ai bấm "đăng ký"?
    Vĩnh viễn có đổi thành có hạn được không?~~ → **RESOLVED**: admin đăng ký
    thiết bị trên CMS **trước** khi app được cài (không phải app tự đăng ký,
    và không phải cài trước rồi mới đăng ký); trạng thái chặn là "đã cài
    nhưng chưa nạp mã kích hoạt" — chưa nạp thì app bị chặn hoàn toàn (cùng
    triết lý với chặn khi hết hạn); vĩnh viễn và có hạn đổi qua lại được (gia
    hạn được, ở cấp campaign). Chi tiết mục 3.2.

### Còn mở (OPEN)

2. Ngưỡng retry/timeout cụ thể (số lần, số phút) — hay để admin portal cấu hình
   theo từng thiết bị?
3. Video có upload lên fs-core như ảnh không, hay chỉ giữ local + tự xoá?
7. Mỗi kiosk có API key fs-core riêng (theo đề xuất mục 3.3) — có chấp nhận
   được việc phải quản lý N key thay vì 1 key chung như hiện tại không?
9. **(Mới, phát sinh từ mục 2.1)** Khi C0 kiêm nhiệm vai trò LEFT/RIGHT thay
   cho C1/C2 đã hỏng: SV có cần quay đầu theo góc thật (fallback về cơ chế
   "quay đầu trước 1 camera" của bản Looka hiện tại) hay hệ thống chấp nhận
   ảnh góc thẳng thay thế luôn, không cần quay đầu? Ảnh hưởng trực tiếp tới
   việc có cần 2 chế độ hướng dẫn UI song song hay không.
10. **(Mới, phát sinh từ mục 2.1)** Nếu chính C0 hỏng — đề xuất tạm thời là
    dừng session ngay (khác hẳn xử lý C1/C2), do ảnh CENTER là ảnh chính dùng
    để in/hiển thị — cần xác nhận đây có đúng là mức ưu tiên mong muốn không.
13. **(Mới, phát sinh từ mục 3.6)** Số góc chụp cấu hình được ở mức nào — chỉ
    bật/tắt trong 5 góc có sẵn, hay tự định nghĩa góc hoàn toàn mới? FRONT có
    bắt buộc, không được tắt, hay tuỳ chọn như các góc khác? — **ĐÃ CHỐT
    2026-09-04 (`b4aa392`)**: bật/tắt trong 5 góc có sẵn, FRONT bắt buộc.
    Ban đầu số khung cho phép là 3–5; **cập nhật 2026-09-05 (product owner)**:
    hạ xuống **2–5** để 1 kiosk 2 camera cũng chạy được `simultaneousCapture`
    — chi tiết ở mục 3.6.
14. **(Mới, phát sinh từ mục 3.6)** Đổi cấu hình số góc chụp cho 1 thiết bị đã
    đăng ký — áp dụng ngay phiên tiếp theo, hay cần khởi động lại app?
15. **(Mới, phát sinh từ mục 3.4 — thống kê thời gian trung bình)** Ghi log
    mốc thời gian chi tiết hơn cho quá trình upload — thêm cột vào chính bảng
    `upload_outbox` hiện có (ví dụ `sending_started_at`), hay tách hẳn 1 bảng
    nhật ký riêng theo từng lần thử (`upload_attempt_log`)? Bảng riêng cho
    lịch sử đầy đủ hơn (biết chính xác lần thử thứ mấy bị lỗi) nhưng phức tạp
    hơn khi triển khai và đồng bộ sang admin portal.
16. **(Mới, phát sinh từ mục 3.5 — hệ quả của quyết định "màn phụ chỉ xem")**
    Các thao tác quản lý trước đây giả định làm trên màn phụ — chọn camera
    thay thế (2.1), can thiệp retry/timeout (2.2), xử lý AMBIGUOUS/DUPLICATE
    (2.3), Manual confirm (2.7) — giờ cần 1 bề mặt UI khác để thực hiện. Có
    thể vẫn là màn kiosk chính qua 1 "chế độ CB Help" riêng, nhưng chưa chốt.

Đề xuất bước tiếp theo: chốt xong danh sách "Còn mở" phía trên, sau đó viết
implementation plan chi tiết theo đúng cấu trúc `docs/plans/` đã có
(implementation-plan.md + walkthrough.md), tách theo từng phase như đã làm cho
các phase 00-10 trước đó.
