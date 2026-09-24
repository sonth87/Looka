# Plan: Tự động dò kết nối Canon qua polling định kỳ có backoff (Phương án C)

## Bối cảnh

Sau khi audit toàn bộ luồng chụp/xem trước/ghi nhận ảnh Canon tethered
(2026-09-24, xem `docs/plans/canon-tethered-capture-plan-2026-09-21.md` cho
lịch sử gốc), người dùng hỏi: "tại sao phải tự dò kết nối máy ảnh? có thể
tự động không?" — hiện tại việc biết Canon có đang cắm hay không **chỉ xảy
ra khi người vận hành chủ động bấm nút "Kiểm tra kết nối"** trong Camera
Setup, không có tín hiệu chủ động nào khi cắm/rút dây lúc không ai đang mở
đúng màn đó.

Đã thảo luận 3 phương án để tự động hoá việc này:
- **A. Native USB library (`usb`/libusb node addon)** — có hotplug event
  thật, nhưng cần compile native khớp ABI Electron 37, đúng loại rủi ro dự
  án đã chủ động né khi quyết định không dùng `sharp` cho việc lật ảnh.
- **B. WMI event subscription qua PowerShell subprocess** — không cần
  native module, đúng convention subprocess+stdout sẵn có của dự án (giống
  `startMovieStream()`), nhưng **rủi ro thật khi gửi bản release cho máy
  khác dùng**: nhiều máy Windows ở đơn vị có IT quản lý bật Group
  Policy/AppLocker chặn chạy PowerShell script hoàn toàn, kể cả với
  `-ExecutionPolicy Bypass` — không kiểm soát được máy đích có bị khoá hay
  không.
- **C. Poll định kỳ có backoff** — không tức thời bằng A/B, nhưng **không
  thêm cơ chế mới nào có thể bị máy đích chặn** — chỉ tái dùng đúng
  `gphoto2.exe` đã được chứng minh đóng gói/chạy được trên máy khác rồi.

Người dùng xác nhận sẽ gửi bản release cho máy khác dùng → chọn **phương án
C**. Tài liệu này scope chi tiết cho C.

## Hiện trạng đã xác minh (không suy đoán)

- `detectTetheredCamera()` ([tetheredCamera.ts:303](../../apps/desktop/src/main/tetheredCamera.ts))
  chạy `gphoto2 --auto-detect` thật, đi qua `withCameraLock()`
  ([tetheredCamera.ts:279](../../apps/desktop/src/main/tetheredCamera.ts)) —
  hàng đợi dùng chung với live-view/capture, vì gphoto2 chỉ giữ được 1
  phiên PTP/USB tại một thời điểm.
- Hàm này **chỉ có đúng 1 nơi gọi tới trong toàn bộ code hiện tại**:
  IPC handler `tetheredCamera:status`
  ([index.ts:703](../../apps/desktop/src/main/index.ts)), và IPC handler đó
  chỉ được renderer gọi từ **1 chỗ duy nhất**: nút "Kiểm tra kết nối" trong
  `CameraSetupScreen.tsx` (`checkTetheredCamera`, dòng 543-551) — không có
  caller tự động nào.
- `CampaignGate.tsx` **cố ý không gọi** `getTetheredCameraStatus()` (comment
  rõ ràng ở dòng 452-458) — thay vào đó suy luận gián tiếp: 1 khung live-view
  về thành công = coi như đã kết nối. Cách này chỉ hoạt động SAU KHI đã có
  role gán cho Canon và màn đó đã bắt đầu poll live-view, không giúp gì cho
  việc biết trạng thái TRƯỚC đó.
- Chưa có kênh push nào từ main→renderer riêng cho trạng thái kết nối
  Canon. Tiền lệ push đã có trong code: `camera:roleMappingChanged`
  ([index.ts:671](../../apps/desktop/src/main/index.ts),
  `mainWindow?.webContents.send(...)`), expose qua preload bằng
  `onCameraRoleMappingChanged` ([preload/index.ts:862](../../apps/desktop/src/preload/index.ts))
  — trả về hàm hủy đăng ký, đúng khuôn cần theo.
- **Camera Setup chạy trong 1 `BrowserWindow` RIÊNG**
  (`cameraSetupWindow.ts`), không chung cửa sổ với `CampaignGate`/
  `FaceCaptureApp` (mainWindow). Một sự kiện push cần gửi tới đúng TẤT CẢ
  cửa sổ đang mở có liên quan, không chỉ `mainWindow`.
- **Lỗi liên quan đã phát hiện, chưa sửa** (từ log thật trong phiên audit
  2026-09-24): `ensureMovieStream()` không có backoff khi start thất bại
  liên tiếp — khi không có camera, main process đã spawn/chết 47 tiến trình
  gphoto2 liên tục không nghỉ trong 1 phiên test ngắn. Plan này **phải**
  tránh lặp lại đúng lỗi đó cho vòng polling detect mới.

## Kiến trúc đề xuất

```
setInterval (main process, có backoff)
        │  chỉ chạy khi có role nào đó gán cho Canon
        ▼
detectTetheredCamera()  ──── withCameraLock (hàng đợi dùng chung có sẵn)
        │  so sánh với trạng thái lần trước
        ▼  (chỉ gửi khi trạng thái THỰC SỰ đổi)
webContents.send('tetheredCamera:connectionChanged', status)
        │  gửi tới mọi BrowserWindow đang mở liên quan
        ▼
mainWindow (CampaignGate/FaceCaptureApp) + cameraSetupWindow (nếu đang mở)
```

## Các bước triển khai

### Bước 1 — Module polling + backoff (main process)

File mới: `apps/desktop/src/main/tetheredCameraWatcher.ts` (tách riêng khỏi
`tetheredCamera.ts` — file đó chỉ nên lo việc bọc lệnh gphoto2, không lo
lịch trình polling, đúng cách `cbHelpWindow.ts` đã tách riêng khỏi
`index.ts`).

Trách nhiệm:
- `startWatcher()`/`stopWatcher()` — bật/tắt vòng polling.
- Chu kỳ đề xuất (cần chốt lại ở phần "Điểm chưa chốt"):
  - Chưa kết nối: bắt đầu 3s, thất bại liên tiếp thì nhân đôi, tối đa 30s.
  - Đã kết nối ổn định: giãn cố định ra 15s (chỉ cần đủ để phát hiện rút
    dây, không cần nhanh).
  - Kết nối thành công 1 lần → reset về chu kỳ cơ bản nếu sau đó mất kết
    nối trở lại.
- Không bắt đầu 1 vòng detect mới nếu vòng trước còn đang chờ xử lý (tránh
  dồn nhiều lệnh detect xếp hàng cùng lúc trong `withCameraLock`).
- Chỉ chạy khi `Object.values(cameraRoleMapping).includes(TETHERED_DEVICE_ID)`
  — đúng điều kiện `tetheredAnyRoleAssigned` đã dùng ở `CampaignGate.tsx`/
  `FaceCaptureApp.tsx` — kiosk không dùng Canon thì không polling vô ích.
- Dừng hẳn khi có phiên chụp thật đang chạy (đúng tinh thần `CampaignGate.tsx`
  hiện đã dừng poll live-view khi `started=true`) — tránh detect cạnh tranh
  tài nguyên với capture thật.

### Bước 2 — Push kết quả cho renderer

- Kênh IPC broadcast mới: `tetheredCamera:connectionChanged`, theo đúng
  khuôn `camera:roleMappingChanged`.
- Cần 1 helper nhỏ duyệt qua các cửa sổ đang mở (mainWindow +
  cameraSetupWindow, lấy từ `cameraSetupWindow.ts`'s biến module-level hiện
  có) thay vì chỉ gọi `mainWindow?.webContents.send(...)` — nếu không, màn
  Camera Setup đang mở sẽ không nhận được cập nhật tự động.
- Chỉ gửi khi trạng thái thực sự đổi so với lần trước (connected/model có
  đổi) — không gửi mỗi tick, tránh renderer re-render vô ích.

### Bước 3 — Renderer lắng nghe

- `preload/index.ts`: thêm `onTetheredConnectionChanged(callback)`, đúng
  khuôn `onCameraRoleMappingChanged` (trả về hàm hủy đăng ký).
- `CampaignGate.tsx`: thêm listener mới, giữ nguyên cơ chế suy luận gián
  tiếp qua live-view hiện có (không thay thế — sự kiện mới cho biết SỚM,
  trước cả khi màn đó bắt đầu poll live-view thật).
- `CameraSetupScreen.tsx`: nút "Kiểm tra kết nối" giữ nguyên (chủ động, tức
  thì theo yêu cầu người dùng), nhưng thêm listener để tự cập nhật badge
  trạng thái khi có sự kiện push tới trong lúc màn đang mở — không cần bấm
  lại nút.

### Bước 4 — Dọn dẹp đúng lúc app tắt

- `stopWatcher()` được gọi trong lifecycle quit của `index.ts` (cùng chỗ
  các cleanup khác như `stopUploads`/`closeCbHelpWindow` đang được gọi) —
  không để interval treo lại sau khi app đã thoát.

### Bước 5 — Tiện thể sửa luôn lỗi backoff đã biết

`ensureMovieStream()` trong `tetheredCamera.ts` hiện không có backoff khi
start thất bại liên tiếp (xem "Hiện trạng"). Vì logic backoff của Bước 1
(tăng dần khi thất bại, reset khi thành công) about giống hệt thứ
`ensureMovieStream()` đang thiếu, nên **đề xuất sửa cùng lúc**, dùng chung
1 helper backoff nhỏ cho cả 2 nơi — tránh viết 2 bản logic tương tự nhau ở
2 chỗ khác nhau trong cùng 1 file.

## Điểm chưa chốt — cần quyết định trước khi code

- Chu kỳ chính xác (3s/15s/30s ở Bước 1 chỉ là đề xuất, chưa đo trên máy
  thật) — có thể cần tinh chỉnh sau khi thấy hành vi thật.
- Polling có nên bắt đầu ngay từ lúc app khởi động (kể cả khi CHƯA từng gán
  role nào cho Canon), hay chỉ bắt đầu sau khi có ít nhất 1 role đang gán?
  Đề xuất: chỉ polling khi có role gán cho Canon — tránh polling vô ích
  trên kiosk chưa từng/không dùng Canon.
- Có polling tiếp trong lúc đang có phiên chụp thật chạy, hay tạm dừng hẳn?
  Đề xuất: tạm dừng hẳn (Bước 1 đã nêu), giống cách `CampaignGate.tsx` đã
  làm với poll live-view.
- Bước 5 (sửa `ensureMovieStream()` cùng lúc) — làm chung hay tách plan
  riêng? Đề xuất: làm chung vì logic backoff trùng lặp, nhưng đây là quyết
  định của người dùng.

## Không đụng tới (ngoài phạm vi)

- Không đổi cơ chế live-view (`getTetheredLiveViewFrame`/movie-stream) —
  plan này chỉ thêm 1 lớp "biết có kết nối hay không" chạy song song,
  không thay thế cách suy luận gián tiếp hiện có của `CampaignGate.tsx`.
- Không triển khai phương án B (WMI hotplug) hay A (native usb) — đã cân
  nhắc và loại vì rủi ro triển khai lên máy khác không kiểm soát được (xem
  "Bối cảnh").
- Không đổi luồng chụp ảnh/capture thật, không đổi
  `captureTetheredPhoto()`/`recordExternalCapture`.
- Không đụng tới phần tách kiến trúc "role → thiết bị" đã bàn riêng (45 chỗ
  check `TETHERED_DEVICE_ID` rải rác) — đó là một cuộc thảo luận/quyết định
  khác, ngoài phạm vi plan này.

## Verification

- Phần logic backoff/chu kỳ verify được bằng unit test (giả lập
  `detectTetheredCamera` thất bại liên tiếp → kiểm tra chu kỳ giãn ra đúng
  công thức; giả lập thành công → kiểm tra reset đúng) — không cần camera
  thật.
- Phần push/broadcast tới nhiều cửa sổ verify được qua build/typecheck +
  test thủ công mở đồng thời `CampaignGate` và Camera Setup.
- Phần thực tế "cắm/rút dây thật có báo đúng trong bao lâu" cần test trên
  kiosk thật với Canon thật — người dùng tự làm.

**Chưa code gì trong tài liệu này — chờ người dùng duyệt plan trước khi bắt
đầu triển khai.**
