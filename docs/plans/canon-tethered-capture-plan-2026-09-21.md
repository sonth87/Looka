# Plan: Chụp ảnh + quay video qua Canon EOS R6 Mark II/III — kết hợp USB (gphoto2) + HDMI (capture card)

> **CẬP NHẬT MỚI NHẤT (2026-09-21, sau khi cắm camera thật) — BƯỚC 0 HOÀN
> TẤT THẬT SỰ, đã xác nhận trên chính máy ảnh Canon EOS R6 Mark II thật:**
> "Kiểm tra kết nối"/"Xem live view" trong Camera Setup giờ báo "Đã kết nối
> — Canon EOS R6m2" và hiện được khung live view thật. Đường đi tới đây có
> **4 lỗi thật, độc lập nhau, mỗi lỗi chỉ lộ ra khi test với phần cứng
> thật** — không lỗi nào trong số này lộ ra qua build/dev/đóng gói giả lập,
> đúng như phần trạng thái cũ của doc này đã cảnh báo trước:
>
> 1. **Driver WinUSB tự build (`wdi-simple.exe` tự compile từ mã nguồn
>    libwdi qua MinGW/MSYS2) bị máy này CHẶN cài** — lỗi Windows thật:
>    `0xE000022F "Driver package does not contain a catalog file, and Code
>    Integrity is enforced"`. Nguyên nhân: máy này bật **Memory Integrity
>    (HVCI/Core Isolation)**, driver tự build không có chữ ký hợp lệ (không
>    có cert thật để nhúng qua `--with-userdir`) nên bị từ chối thẳng, kể cả
>    khi chạy với quyền Admin thật (`Start-Process -Verb RunAs`). **Sửa
>    bằng cách dùng bản Zadig CHÍNH THỨC** (`zadig-2.9.exe`, tải từ
>    `github.com/pbatard/libwdi/releases`, có chữ ký Authenticode hợp lệ
>    của Akeo Consulting/Pete Batard) — bản này KHÔNG bị chặn, cài driver
>    thành công thật (xác nhận qua `Get-PnpDevice`: cả `MI_00` lẫn `MI_01`
>    của camera chuyển từ class `WPD` sang `USBDevice`). Camera EOS lộ ra
>    **2 interface USB riêng** — phải chọn ĐÚNG "Canon Digital Camera
>    (Interface 0)" (= `MI_00`, interface PTP/Still-Image thật gphoto2
>    cần), không phải "iAP Interface (Interface 1)" (`MI_01`, giao diện
>    riêng của Canon, gphoto2 không dùng).
> 2. **Camera bị Windows báo "phantom"/`Present: False` nhiều lần giữa
>    chừng** — không phải lỗi driver, mà do camera tự ngủ/tắt sau một lúc
>    cắm không thao tác; đánh thức máy + cắm lại cáp là camera hiện lại
>    `Present: True` ngay.
> 3. **`usb1.dll` (plugin transport USB của gphoto2) load lỗi âm thầm** —
>    `objdump`/debug log cho thấy nó thiếu `libusb-1.0.dll`, một DLL KHÔNG
>    nằm trong danh sách mà `setup-gphoto2-windows.ps1`'s bước `ldd
>    gphoto2.exe` từng quét ra, vì `ldd` chỉ thấy DLL `gphoto2.exe` tự link
>    TĨNH lúc build — không thấy DLL mà các plugin camlibs/iolibs tự
>    `dlopen()` lúc CHẠY.
> 4. **`ptp2.dll` (plugin DUY NHẤT nhận diện được Canon EOS qua PTP) cũng
>    load lỗi cùng kiểu** — thiếu `libxml2-16.dll` + `libjpeg-8.dll` (+ bắc
>    cầu `zlib1.dll` cho libxml2), cùng nguyên nhân gốc với lỗi #3. Không
>    có `ptp2.dll` load được thì `--auto-detect` LUÔN rỗng bất kể driver
>    WinUSB đã đúng chưa hay camera có cắm hay không — đây là nguyên nhân
>    gốc thật sự khiến các lần test trước đó (kể cả sau khi driver đã đúng)
>    vẫn báo "Chưa kết nối".
>
> **Đã sửa tận gốc, không chỉ vá tay:** `setup-gphoto2-windows.ps1` giờ có
> thêm bước quét `ldd` cho TỪNG file `.dll` trong 2 thư mục plugin
> `libgphoto2/`/`libgphoto2_port/` (không chỉ quét `gphoto2.exe`), tự gộp
> mọi DLL ucrt64 còn thiếu và copy vào — máy nào chạy lại script này từ đầu
> trên MSYS2 sạch sẽ không còn dính lỗi #3/#4 nữa. 4 DLL còn thiếu
> (`libusb-1.0.dll`, `libxml2-16.dll`, `libjpeg-8.dll`, `zlib1.dll`) đã
> được copy tay vào `resources/gphoto2-win/` cho lần này, và app đã đóng
> gói lại (`pnpm package:win:dir`) + xác nhận file đó có mặt thật trong
> `release/win-unpacked/resources/gphoto2/`.
>
> **1 lỗi thứ 5, khác loại — sửa trong code `tetheredCamera.ts`:** cách bắt
> ảnh cũ (`--filename <path Windows tuyệt đối> --force-overwrite`) BỊ HỎNG
> thật trên Windows — gphoto2 tự thêm tiền tố `"thumb_"` vào TOÀN BỘ chuỗi
> đường dẫn (`thumb_D:\...` thay vì chỉ tên file), bước `rename()` nội bộ
> của nó sau đó lỗi `"Invalid argument"`, thoát với exit code 0 (im lặng,
> wrapper không phát hiện được cho tới khi `fs.readFile` báo ENOENT). Sửa
> bằng cách đổi hẳn sang `--stdout` (đọc bytes ảnh trực tiếp qua stdout của
> subprocess dưới dạng `Buffer`, không qua file tạm/rename nào cả) —
> `captureToTempFile()` đổi tên thành `captureViaStdout()`, thêm hẳn
> `runGphoto2Binary()` riêng (giữ `Buffer` thô thay vì decode UTF-8, tránh
> làm hỏng bytes nhị phân ảnh JPEG). Đã xác nhận qua Node.js thật (không
> phải PowerShell `>` — PowerShell 5.1 tự ý decode/re-encode stdout nhị
> phân của tiến trình native, làm hỏng byte, từng đánh lừa 1 lần lúc test
> tay) rằng file trả về đúng magic bytes JPEG thật (`ffd8...`).
>
> **Còn lại, giống hệt trạng thái cũ bên dưới, CHƯA đụng tới:** wiring
> camera tethered vào round logic thật của một phiên chụp
> (`FaceCaptureApp.tsx`/`multiFrame.ts`) — khung "CAM 01 · GIỮA" trong màn
> chụp thật vẫn chỉ hiện placeholder khi gán camera tethered vào vai trò,
> KHÔNG tự stream live view vào đó — đây là việc CỐ Ý chưa làm, không phải
> lỗi. Live-view polling interval (1000ms) vẫn chưa đo/tinh chỉnh dựa trên
> fps thật đo được từ camera thật.
>
> ---
>
> **BƯỚC 0 (phần mềm) + BƯỚC 1+4 (một phần) IMPLEMENTED/VERIFIED 2026-09-21**
> — build sạch, VÀ lần đầu tiên trong plan này thật sự chạy được
> `gphoto2.exe` thật trên máy Windows thật của người dùng (không phải suy
> đoán từ tài liệu nữa). Vẫn **CHƯA test được với camera thật** — người
> dùng chưa cắm máy vào lúc này, đó là bước tiếp theo duy nhất còn lại.
>
> **Sự cố thật gặp phải + đã sửa khi setup (đáng nhớ, không phải lý
> thuyết):**
> 1. Tên gói `mingw-w64-x86_64-gphoto2` (bản đầu đoán theo `mingw64` cổ
>    điển) **không còn tồn tại** — MSYS2 đã chuyển gphoto2 sang repo
>    `ucrt64` (`mingw-w64-ucrt-x86_64-gphoto2`). Đã sửa lại
>    `setup-gphoto2-windows.ps1` theo tên gói đúng.
> 2. `which gphoto2` qua `bash -lc` gọi thẳng không tìm ra file dù cài
>    thành công thật — vì bash.exe gọi trực tiếp kiểu này khởi động môi
>    trường MSYS mặc định (PATH không có `/ucrt64/bin`), không phải môi
>    trường UCRT64. Sửa bằng cách set `MSYSTEM=UCRT64` trước khi gọi bash
>    (đúng cách shortcut "MSYS2 UCRT64" chính thức làm) + kiểm tra thẳng
>    đường dẫn cố định thay vì phụ thuộc `which`.
> 3. File `.ps1` có tiếng Việt (dấu, gạch ngang —) nhưng không có UTF-8 BOM
>    → Windows PowerShell 5.1 đọc sai encoding, corrupt ký tự, script lỗi
>    parse hàng loạt trông như file bị hỏng be bét. Sửa bằng cách ghi lại
>    file với BOM UTF-8 (`New-Object System.Text.UTF8Encoding($true)`).
>    **Ghi nhớ cho mọi file `.ps1` tiếng Việt sau này trong dự án này.**
>
> **Đã xác nhận thật (không phải đoán) trên máy thật, sau khi sửa 3 lỗi
> trên:**
> - `pacman -Sy` cài `mingw-w64-ucrt-x86_64-gphoto2`/`-libgphoto2` thành
>   công, kéo theo 89 gói phụ thuộc — kích thước cài đặt thật ~725MB.
> - `gphoto2.exe --version` chạy sạch, không lỗi thiếu DLL:
>   `libgphoto2_port 0.12.2 iolibs: disk ptpip usb1` — xác nhận plugin USB
>   nạp đúng.
> - **Việc nạp plugin (camlibs/iolibs) tự hoạt động đúng dù chạy từ CWD
>   khác, KHÔNG cần set `CAMLIBS`/`IOLIBS`** — đã tự tay test both cách
>   (có/không set 2 biến này) từ `D:\Work\camera_server` (khác hẳn thư mục
>   chứa exe), kết quả giống hệt nhau. Nghĩa là `resolvePluginEnv()` trong
>   `tetheredCamera.ts` là một lớp phòng thủ thêm (không hại gì khi giữ
>   lại), KHÔNG phải điều kiện bắt buộc như lo ngại ban đầu — ít nhất với
>   bản MSYS2/build này. Có thể khác với bản đóng gói electron-builder
>   thật (chưa test) — vẫn giữ code phòng thủ đó.
> - `gphoto2.exe --auto-detect` khi CHƯA cắm camera nào in ra đúng y hệt
>   format `detectTetheredCamera()` trong `tetheredCamera.ts` đã giả định:
>   dòng header `Model .... Port`, dòng gạch ngang, KHÔNG có dòng dữ liệu
>   — code parse (tìm dòng chứa `usb:`) xử lý đúng trường hợp này, trả về
>   `connected: false`.
>
> `apps/desktop/resources/gphoto2-win/` giờ có đủ file thật (gphoto2.exe +
> 13 DLL + camlibs `libgphoto2/2.5.34/` gồm `ptp2.dll` (driver Canon) +
> iolibs `libgphoto2_port/0.12.2/` gồm `usb1.dll`) — không còn là thư mục
> rỗng chỉ có README nữa. **Bước còn lại duy nhất: cắm camera thật, chạy
> lại `gphoto2.exe --auto-detect`, xem có nhận ra máy không** (có thể cần
> Zadig đổi driver WinUSB trước — chưa thử).
>
> **CẬP NHẬT tiếp — Bước 6 (đóng gói) cũng đã build thật + tự bắt được 1
> lỗi packaging thật:** chạy `pnpm package:win:dir` (electron-builder đóng
> gói thật, không phải giả lập) — phát hiện `extraResources`'s filter ban
> đầu (`["*.exe", "*.dll"]`) chỉ khớp file nằm phẳng ngay trong
> `resources/gphoto2-win/`, KHÔNG đệ quy vào 2 thư mục con `libgphoto2/`/
> `libgphoto2_port/` — nghĩa là bản đóng gói thật sẽ thiếu toàn bộ driver
> camera (`ptp2.dll`) dù bản dev chạy tay vẫn ổn, một lỗi chỉ lộ ra khi
> đóng gói thật, không lộ khi chỉ chạy `tsc`/dev. Đã sửa filter thành
> `["**/*", "!**/*.dll.a", "!README.md", "!.gitignore"]` (đệ quy toàn bộ,
> trừ file `.dll.a` không cần lúc chạy + file tài liệu/gitignore), đóng gói
> lại, xác nhận `release/win-unpacked/resources/gphoto2/` giờ có đủ
> `libgphoto2/2.5.34/ptp2.dll` + `libgphoto2_port/0.12.2/usb1.dll`, và
> `gphoto2.exe --version`/`--auto-detect` chạy đúng y hệt bản dev khi gọi
> thẳng TỪ VỊ TRÍ ĐÓNG GÓI THẬT (`release\win-unpacked\resources\gphoto2\`).
> `Looka.exe` (app chính) cũng đóng gói thành công. Đây là xác nhận đầu-
> cuối thật cho toàn bộ chuỗi cài đặt → đóng gói, chỉ còn thiếu camera thật
> cắm vào.
> Đã làm: `apps/desktop/src/main/tetheredCamera.ts` (module gọi
> `gphoto2` qua `child_process`, có timeout, dọn temp file, không phải
> native addon — đúng kiến trúc đã chốt); 3 IPC handler mới
> (`tetheredCamera:status`/`capture`/`getLiveViewFrame`) nối vào
> `main/index.ts` theo đúng khuôn `camera:setRoleMapping`; `preload/
> index.ts` expose 3 hàm `faceAPI.getTetheredCameraStatus`/
> `captureTetheredPhoto`/`getTetheredLiveViewFrame`; `CameraSetupScreen.tsx`
> thêm hẳn 1 bảng "MÁY ẢNH CANON QUA DÂY (GPHOTO2)" (nút Kiểm tra kết nối/
> Chụp thử/Xem live view, ảnh xem trực tiếp trong màn hình — đúng công cụ
> Bước 0 cần, không phải chạy tay dòng lệnh nữa) + biến camera tethered
> thành một tuỳ chọn thật trong `<select>` gán vai trò
> (`TETHERED_DEVICE_ID = 'tethered:gphoto2'`, chỉ hiện ra sau khi "Kiểm
> tra kết nối" xác nhận có máy — không tự thêm khi chưa xác nhận được).
> `electron-builder.json` đã thêm `extraResources` trỏ vào
> `resources/gphoto2-win/` (đã tạo thư mục + README hướng dẫn — thư mục
> CỐ Ý rỗng, chờ người triển khai tự đặt file `.exe`/`.dll` thật vào sau
> Bước 0, không commit binary vào repo).
>
> **Chưa làm, cần làm tiếp sau khi Bước 0 xác nhận trên phần cứng thật:**
> Bước 2's polling interval hiện hard-code 1000ms trong
> `toggleTetheredLiveView` (ghi rõ trong comment là "điểm khởi đầu, chưa
> tinh chỉnh" — chưa đo fps thật); `wdi-simple.exe`/tự động hoá driver
> WinUSB (Bước 6's phần "tự động đổi driver") **chưa code** — `README.md`
> trong `resources/gphoto2-win/` đã dọn chỗ đóng gói sẵn nhưng
> `tetheredCamera.ts` chưa gọi tới nó; **quan trọng nhất**: wiring camera
> tethered vào luồng chụp THẬT của một phiên (round logic trong
> `FaceCaptureApp.tsx`/`multiFrame.ts` — nơi CENTER/LEFT/RIGHT thật sự
> được dùng để lưu ảnh vào hồ sơ sinh viên) **hoàn toàn chưa đụng tới** —
> những gì đã code là lớp kết nối nền tảng + bảng test độc lập trong Camera
> Setup, cố ý dừng ở đó để tránh đoán mò code sâu khi chưa có phần cứng
> thật xác nhận `gphoto2 --auto-detect`/`--capture-image-and-download`/
> `--capture-preview` thật sự chạy đúng với 2 máy R6 Mark II/III như tài
> liệu gphoto2 mô tả.

## Bối cảnh

Người dùng có máy ảnh Canon **EOS R6 Mark II và/hoặc EOS R6 Mark III** và
muốn nối dây vào máy kiosk, để hệ thống Looka có thể:

1. Hiện hình ảnh trực tiếp (live view) từ Canon lên màn hình trước khi chụp.
2. Bấm nút chụp trong app → máy Canon tự bấm màn trập thật → ảnh tự động tải
   về và đi vào đúng luồng lưu trữ/xử lý hiện có (giống ảnh webcam hôm nay).
3. **(Mới, 2026-09-21)** Cũng cần quay video được, không chỉ ảnh tĩnh.

**Lịch sử quyết định trong ngày 2026-09-21 (ghi lại để không lặp lại vòng
lặp):**
1. Bản đầu: tự viết helper process gọi thẳng Canon EDSDK.
2. Người dùng hỏi "có cách nào khác/thay vì EDSDK?" → đổi sang
   [digiCamControl](https://github.com/dukus/digiCamControl) (phần mềm mã
   nguồn mở có sẵn HTTP API, giảm khối lượng code cần viết).
3. Người dùng hỏi cụ thể 2 model **R6 Mark II / R6 Mark III** có dùng được
   không → kiểm tra trang danh sách camera hỗ trợ của digiCamControl → cả
   2 model đều **KHÔNG** có trong danh sách công khai.
4. Người dùng yêu cầu "dùng thư viện chắc chắn sử dụng được" → kiểm tra
   trực tiếp trang release note chính thức của Canon EDSDK → xác nhận
   EDSDK (SDK gốc) có hỗ trợ cả 2 máy → đổi plan quay lại tự viết bridge
   gọi thẳng EDSDK, vì đó là nguồn "chắc chắn" duy nhất tìm được lúc đó.
5. Người dùng phản hồi: đăng ký Canon Developer Program mất nhiều thời
   gian, hỏi có mã nguồn mở nào khác không → khảo sát **libgphoto2**
   (thư viện mã nguồn mở, không cần đăng ký với Canon, giao tiếp trực tiếp
   qua chuẩn PTP) → **tìm thấy bằng chứng tương thích thật, cụ thể cho cả
   2 model** → đổi sang dùng gphoto2/libgphoto2 qua USB.
6. Người dùng hỏi về live view "gọi liên tục có nặng không" → khảo sát
   thực tế cộng đồng: gphoto2 có trần fps thấp mang tính cấu trúc (thường
   dưới 10fps, có báo cáo trễ 4-5 giây) — không mượt bằng EDSDK chính chủ.
7. Người dùng hỏi có thể dùng dây khác không, và xác nhận **cần cả ảnh lẫn
   video** → phát hiện: USB (gphoto2) không phù hợp cho quay video (công
   cụ dành cho ảnh tĩnh), còn HDMI + capture card thì làm được cả live
   view mượt lẫn quay video thật, qua đúng luồng webcam có sẵn của Looka
   (không cần code mới cho phần này) — đổi lại, HDMI không điều khiển
   được màn trập từ xa.
8. Người dùng làm rõ lại: KHÔNG bắt buộc cắm cả 2 dây cùng lúc trên cùng 1
   camera — mà muốn Looka **hỗ trợ SẴN CẢ 2 kiểu**, cắm dây/thiết bị nào
   thì dùng kiểu đó ("đến khi cắm dây nào thì sử dụng dây đó"). **Bản plan
   này chốt theo hướng: xây cả 2 đường độc lập, vận hành viên chọn dùng
   đường nào tùy tình huống/kiosk**, không ép phải dùng cả 2 cùng lúc trên
   1 máy ảnh (dù về mặt kỹ thuật 2 đường KHÔNG loại trừ nhau — vẫn có thể
   dùng cả 2 nếu muốn, xem ghi chú ở "Điểm chưa chốt").

**Ý quan trọng nhất rút ra được:** đường **HDMI + capture card** thực ra
**KHÔNG cần code mới** — một capture card khi cắm vào kiosk PC tự hiện ra
với Windows/trình duyệt như một webcam bình thường, và hệ thống Looka
hiện tại (`BrowserCameraService`/`getUserMedia`) **đã tự nhận diện và dùng
được ngay**, giống hệt một webcam Logitech — kể cả live view lẫn quay
video (hệ thống đã có sẵn khả năng quay video qua webcam, xem
`session_videos`/`camera_role` trong dữ liệu hiện có). Vận hành viên chỉ
cần mua capture card + cáp HDMI, cắm vào, chọn nó trong màn Camera Setup
như chọn một webcam bất kỳ — xong, không cần chờ plan này triển khai
xong. Phần **thật sự cần code mới trong plan này chỉ là đường USB/gphoto2**
(chụp ảnh thật do app tự bấm) — các bước bên dưới đều nói về đường này.

Tài liệu này CHỈ là plan — chưa code gì. Người dùng cần duyệt trước khi bắt
đầu triển khai, đúng quy ước của dự án (không code ngay sau khi có plan).

## Bằng chứng tương thích — xác minh trực tiếp trong mã nguồn libgphoto2 (2026-09-21)

[libgphoto2](https://github.com/gphoto/libgphoto2) là thư viện mã nguồn mở
(giấy phép LGPL cho thư viện lõi, GPL cho công cụ dòng lệnh `gphoto2` đi
kèm — xem ghi chú giấy phép ở "Điểm chưa chốt"), giao tiếp camera qua
**chuẩn PTP** trực tiếp — **không cần đăng ký Canon Developer Program,
không cần xin SDK, không cần chờ duyệt hồ sơ**.

Đã xem trực tiếp mã nguồn (không suy đoán), tìm thấy file định nghĩa khả
năng thiết bị — trông như được sinh ra từ một phiên kết nối thật với máy
thật (có số liệu thẻ nhớ cụ thể), cho **cả 2 model**:

- [`camlibs/ptp2/cameras/canon-eos-r6-markii.txt`](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/cameras/canon-eos-r6-markii.txt)
  — có `Canon EOS Capture, Canon EOS Capture 2` (chụp qua lệnh chuyên
  dụng của Canon, không phải PTP capture thông thường — đúng cách EOS
  hoạt động), có `EOS_GetViewFinderData` (live view), file
  download/delete/upload, autofocus, zoom, cân bằng trắng, GPS log.
- [`camlibs/ptp2/cameras/canon-eos-r6-markIII.txt`](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/cameras/canon-eos-r6-markIII.txt)
  — có `Canon EOS Capture, Canon Capture 2`, `EVF Mode`/`Viewfinder`
  toggle/`Zoom` (live view), remote release, điều khiển đầy đủ ISO/cân
  bằng trắng/bù trừ phơi sáng/khẩu độ/tốc độ màn trập.

→ Cả 2 máy đều có định nghĩa khả năng RIÊNG, ĐẦY ĐỦ (chụp + live view),
không phải suy đoán từ một model gần giống.

**Windows:** libgphoto2 có bản build Windows chính thức, cập nhật đều đặn
qua [MSYS2](https://packages.msys2.org/packages/mingw-w64-x86_64-libgphoto2)
(gói `mingw-w64-x86_64-libgphoto2`, cập nhật gần nhất khảo sát được là
2026-05-31 — khoảng 4 tháng trước ngày viết plan này) — không phải dự án
chỉ chạy tốt trên Linux rồi bỏ mặc Windows.

## Hiện trạng hệ thống (đã khảo sát thật, không đoán — không đổi qua các bản)

- Camera hiện tại 100% đi qua API trình duyệt chuẩn: `packages/camera/src/
  BrowserCameraService.ts` dùng `navigator.mediaDevices.enumerateDevices()`/
  `getUserMedia()`, trả về `MediaStream` thật.
- Interface chung `CameraService`
  (`packages/core/src/interfaces/camera.ts:17-28`) có `start(): Promise<
  MediaStream>` và `getFrame(): FrameInput` — ràng buộc chặt vào mô hình
  `MediaStream` của trình duyệt. **Một camera tethered qua gphoto2 không có
  `MediaStream` thật**, nên không thể cấy thẳng vào interface này mà không
  sửa nó — cần một abstraction song song, không phải sửa cái cũ.
- Chụp ảnh hiện tại: `packages/ui/src/components/screens/FaceCaptureApp.tsx`
  gọi `cameraServiceRef.current.captureBase64Snapshot()`, bên trong
  `BrowserCameraService.ts` vẽ frame từ `<video>` ra `<canvas>` rồi
  `toDataURL('image/jpeg')`.
- Ảnh base64 đó được gửi qua IPC sang main process, `apps/desktop/src/main/
  uploads.ts:144` chuyển thành `Buffer`, ghi vào **SQLite outbox**
  (`UploadOutboxRepository`), rồi một worker nền đẩy lên fs-core
  (`packages/fs-client`). **Phần này giữ nguyên hoàn toàn** — camera tethered
  chỉ cần đưa bytes vào đúng chỗ này là xong, không cần viết lại pipeline
  lưu trữ/upload.
- Gán camera theo vai trò (CENTER/LEFT/RIGHT) đang là
  `CameraRoleMapping = Partial<Record<CameraRole, string>>`
  (`apps/desktop/src/main/secrets.ts:407`) — value hiện tại là
  `deviceId` của `enumerateDevices()`. Đây là kiểu string đơn giản, nên có
  thể tái dùng được cho camera tethered bằng một quy ước id giả (vd
  `tethered:<serial>`), không cần đổi kiểu dữ liệu.
- IPC giữa main↔renderer cho camera đã có tiền lệ rõ (`camera:getRoleMapping`
  /`camera:setRoleMapping` tại `apps/desktop/src/main/index.ts:652-664`,
  kèm broadcast `camera:roleMappingChanged` khi đổi) — camera tethered sẽ
  theo đúng khuôn này.
- Đóng gói: `apps/desktop/package.json`'s `electron-builder.json`, Windows
  target là `nsis` + `zip`, kiến trúc `x64` duy nhất. Electron `37.10.3`.

## Chọn công nghệ: gphoto2 CLI làm subprocess (không EDSDK, không digiCamControl)

**Kiến trúc tích hợp: gọi công cụ dòng lệnh `gphoto2` như một subprocess từ
Electron main process** (`child_process.spawn`), KHÔNG viết native
addon/bridge C++ nào cả:

- Chụp: `gphoto2 --capture-image-and-download --filename <path>`
- Xem trạng thái/máy đang cắm: `gphoto2 --auto-detect`
- Live view: `gphoto2 --capture-preview` (xuất 1 khung hình JPEG mỗi lần
  gọi) — gọi lặp lại theo chu kỳ để có hiệu ứng video, giống cách
  `liveview.jpg` của digiCamControl hoạt động (polling ảnh tĩnh, không
  phải stream thật) — cần xác nhận độ trễ/khung hình/giây thực tế ở
  Bước 0 với đúng 2 máy này.

**Vì sao chọn cái này thay vì EDSDK trực tiếp (bản plan trước) hay
digiCamControl:**
- **Không cần đăng ký Canon Developer Program, không chờ duyệt** — đúng
  yêu cầu mới nhất của người dùng.
- **Có bằng chứng tương thích thật, cụ thể cho cả 2 model** — điều
  digiCamControl không có.
- Không cần viết/biên dịch native code (C++/C# bridge) — chỉ cần gọi
  subprocess bằng `child_process` sẵn có của Node, y hệt độ đơn giản của
  phương án digiCamControl (gọi ra ngoài, không tự viết logic điều khiển
  camera), nhưng lần này có xác nhận tương thích rõ ràng.
- Mã nguồn mở thật sự (không phải phần mềm đóng gói sẵn không rõ nội bộ
  dùng bản SDK nào như digiCamControl) — có thể tự build lại/vá nếu cần.

**Đánh đổi cần biết rõ, không giấu:**
- `gphoto2 --capture-preview` là polling ảnh tĩnh từng lần gọi (không phải
  luồng video thật). Quan trọng hơn: **bản thân gphoto2 có trần fps thấp
  mang tính cấu trúc** (cộng đồng báo cáo phổ biến dưới 10fps, có nơi báo
  độ trễ 4-5 giây khi stream) — KHÔNG chỉ là vấn đề "gọi nhiều hay ít", mà
  là giới hạn thật của công cụ so với EDSDK chính chủ (thường mượt hơn hẳn,
  15-30fps). Xem chi tiết + nguồn ở Bước 2 bên dưới. Đây là đánh đổi thật
  cần cân nhắc nếu mục tiêu là live view thật mượt cho vận hành viên.
- Cần đóng gói binary Windows của gphoto2 (từ MSYS2) kèm theo Looka —
  tương tự việc đóng gói digiCamControl, chỉ khác là gphoto2 nhỏ gọn hơn
  và không có giao diện đồ họa cần ẩn đi.
- Giấy phép: thư viện lõi libgphoto2 là **LGPL**, công cụ dòng lệnh
  `gphoto2` là **GPL** — gọi nó như một subprocess bên ngoài (không liên
  kết tĩnh vào code Looka) thường được xem là an toàn về mặt giấy phép,
  nhưng đây là nhận định chung, **không phải tư vấn pháp lý** — nên có
  người phụ trách pháp lý/giấy phép của công ty xác nhận lại trước khi
  đóng gói phân phối, đặc biệt nếu Looka được bán/phân phối cho bên khác.
- ⚠️ **Driver USB — CẬP NHẬT 2026-09-21 (sửa lại nhận định trước đó, đã
  kiểm tra sâu hơn):** trên Windows, gphoto2 hoạt động qua `libusb`, camera
  cần được đổi driver USB sang `WinUSB` thì gphoto2 mới "nhìn thấy" và điều
  khiển được máy — **KHÔNG cần dùng Zadig thủ công như nhận định ban đầu**.
  [libwdi](https://github.com/pbatard/libwdi) (thư viện Zadig chính nó
  được xây trên đó) có công cụ dòng lệnh `wdi-simple.exe` hỗ trợ cờ
  `--silent`, tài liệu chính thức ghi rõ tích hợp được thẳng vào script
  NSIS — **đúng định dạng installer Looka đang dùng sẵn**. Nghĩa là bước
  đổi driver **có thể tự động hoá được**, đóng gói kèm trong Looka, không
  cần người dùng tự tải/chạy Zadig tay. Ràng buộc thật còn lại: (a) cần
  quyền quản trị (UAC) — 1 lần bấm "Đồng ý" khi cài, không phải tải gì
  thêm; (b) camera cần đang CẮM SẴN lúc bước đổi driver này chạy — nên hợp
  lý nhất là để Looka tự chạy bước này **lúc phát hiện camera Canon cắm
  vào lần đầu** (chạy nền, không cần app installer chính biết trước camera
  đã cắm hay chưa), không nhất thiết phải làm ngay lúc cài Looka.
  Vẫn giữ nguyên: **sau khi đổi, camera sẽ KHÔNG còn dùng được với phần
  mềm chính hãng của Canon (EOS Utility, driver PTP mặc định của Windows)
  trên máy đó nữa cho tới khi đổi driver ngược lại** — điều này không đổi,
  chỉ có CÁCH đổi driver là tự động hoá được, không phải bản thân việc đổi
  driver biến mất. Xem bảng chi tiết ngay bên dưới.

## Khi tải app Looka về máy — cái gì tự có sẵn, cái gì vẫn phải làm tay

> Cập nhật 2026-09-21: nhờ `libwdi`/`wdi-simple.exe` (xem ngay trên), driver
> WinUSB giờ **đóng gói tự động được** — bảng dưới đây sửa lại so với nhận
> định ban đầu (lúc đó tưởng bắt buộc chạy tay Zadig).

Đây là phần trả lời thẳng câu hỏi "tải app về máy rồi thì còn cần tải gì
nữa không, có setup được trong lúc tải app không":

| | Tự động (đóng gói/code sẵn trong Looka) | Vẫn cần 1 thao tác của người dùng |
|---|---|---|
| Binary `gphoto2.exe` + DLL đi kèm | ✅ Bundle sẵn trong installer (`electron-builder` extraResources) | |
| `wdi-simple.exe` (công cụ đổi driver, thay cho việc tự tải Zadig) | ✅ Bundle sẵn, gọi ngầm bởi Looka, không cần người dùng biết tới nó | |
| Code Looka gọi gphoto2 (IPC, subprocess, UI) | ✅ Có sẵn khi cài, không cần thao tác gì thêm | |
| **Đổi driver WinUSB cho đúng máy ảnh** | ✅ Looka tự chạy ngầm lúc phát hiện camera Canon cắm vào lần đầu | ⚠️ 1 cú bấm "Đồng ý" ở hộp thoại quyền quản trị Windows (UAC) — không phải tải/cài gì, chỉ là 1 lần xác nhận |
| Dùng lại camera đó với EOS Utility/phần mềm Canon chính hãng trên máy đó | | ❌ Sẽ không dùng được nữa trên máy đó, trừ khi có người vào Device Manager đổi driver ngược lại tay |

**Nói ngắn gọn — trả lời thẳng câu hỏi "còn cần tải gì nữa không":**
Nếu triển khai đúng như thiết kế này, **KHÔNG cần tải/cài thêm gì tách
riêng cả** — mọi thứ (gphoto2 + công cụ đổi driver) đã nằm trong bản cài
Looka. Thứ duy nhất người dùng thấy là **một hộp thoại xin quyền quản trị
Windows hiện ra đúng 1 lần, đúng lúc cắm camera Canon vào kiosk đó lần
đầu** — bấm "Có/Yes" là xong, không phải một bước "đi tải phần mềm khác".
Điều duy nhất KHÔNG tự động được, và sẽ không bao giờ tự động được dù đóng
gói kỹ tới đâu, là: **camera đó sẽ không dùng chung được với phần mềm
chính hãng của Canon trên máy đó nữa** sau bước này — đây là giới hạn kỹ
thuật thật (một cổng USB chỉ dùng được 1 driver tại một thời điểm), không
phải do thiếu công đóng gói.

## Kiến trúc đề xuất

```
Canon EOS R6 II/III (USB) ──── gphoto2 CLI (subprocess, spawn theo lệnh)
                                      │  stdout/file (JPEG bytes, không HTTP/pipe)
                                      ▼
                    Electron main process (apps/desktop/src/main)
                    — module quản lý subprocess, KHÔNG native addon
                                      │  IPC (giống camera:setRoleMapping)
                                      ▼
                    Renderer (packages/ui) — màn Camera Setup + màn chụp
                                      │  ảnh JPEG bytes, giống base64 snapshot hôm nay
                                      ▼
              uploads.ts → SQLite outbox → upload worker → fs-core (GIỮ NGUYÊN)
```

## Các bước triển khai

### Bước 0 — Cài đặt & xác nhận thủ công trước khi code (làm trước tiên)
- Tải bản Windows của gphoto2 (qua MSYS2 `mingw-w64-x86_64-gphoto2`/
  `libgphoto2`, hoặc bản portable build sẵn nếu có), cài lên đúng máy
  kiosk thật.
- Cắm Canon R6 Mark II/III vào, chạy tay từ dòng lệnh (Command Prompt/
  PowerShell), KHÔNG qua Looka:
  - `gphoto2 --auto-detect` — xác nhận máy được nhận diện.
  - `gphoto2 --capture-image-and-download` — xác nhận chụp thật + tải
    file về máy tính thành công.
  - `gphoto2 --capture-preview` (gọi lặp lại vài lần) — xác nhận live
    view lấy được ảnh, đo thử độ trễ/tần suất gọi được bao nhiêu
    khung/giây thực tế.
- Nếu Windows tự động giữ mất cổng USB (driver mặc định của Windows nhận
  camera trước) — cần thử/ghi lại cách xử lý (thường phải gỡ/disable
  driver camera mặc định của Windows cho thiết bị này, hoặc cài driver
  libusb thay thế qua Zadig — công cụ phổ biến đi kèm hướng dẫn
  libgphoto2 cho Windows).

### Bước 1 — Module quản lý subprocess trong Electron main process
- Module mới trong `apps/desktop/src/main` dùng `child_process.spawn` gọi
  binary `gphoto2.exe` đã đóng gói kèm app.
- Bọc các lệnh: detect, capture-and-download, capture-preview (đọc
  stdout/file ra buffer), theo dõi tiến trình (không để subprocess treo
  vô thời hạn — có timeout).
- IPC handlers mới theo đúng khuôn `camera:setRoleMapping` đã có
  (`apps/desktop/src/main/index.ts:652-664`) — ví dụ
  `tetheredCamera:capture`, `tetheredCamera:getLiveViewFrame`,
  `tetheredCamera:status`.

### Bước 2 — Live view

> ⚠️ **Đã kiểm tra kỹ theo câu hỏi "gọi liên tục để tránh giật lắc có nặng
> không" (2026-09-21):** từng khung hình JPEG preview KHÔNG nặng (ảnh nhỏ,
> giải mã/vẽ rất nhẹ, không phải gánh nặng CPU/băng thông). NHƯNG bản thân
> gphoto2 có **trần tốc độ khung hình thấp mang tính cấu trúc, không phải
> do mình gọi nhiều hay ít**: người dùng thực tế báo cáo phổ biến **dưới
> 10 khung hình/giây** với cả `--capture-preview` lẫn `--capture-movie`
> (nghẽn ở chính lệnh `gp_camera_capture_preview()` bên trong gphoto2,
> không phải do băng thông camera/USB), và khi stream qua
> `--capture-movie --stdout` có báo cáo **độ trễ 4-5 giây** — nếu đúng vậy
> thì CẢM GIÁC "giật lắc/trễ" sẽ rõ hơn cả việc chỉ thấp fps. Đây là hạn
> chế thật của gphoto2 so với EDSDK chính chủ (thường đạt 15-30fps mượt
> hơn nhiều vì là cách Canon tự làm, không qua PTP chung). **Bắt buộc đo
> thật ở Bước 0 với đúng 2 máy R6 Mark II/III** trước khi cam kết trải
> nghiệm live view mượt cho vận hành viên — không giả định sẽ mượt.
> (Nguồn: [gphoto2 GitHub issue #321](https://github.com/gphoto/gphoto2/issues/321),
> [issue #405](https://github.com/gphoto/gphoto2/issues/405).)
>
> **Lối thoát cho kiosk nào cần live view thật mượt:** không bắt buộc dùng
> live view qua gphoto2 — nếu kiosk đó cũng gắn thêm capture card qua HDMI
> (xem "Ý quan trọng nhất" ở đầu tài liệu), vận hành viên có thể chọn dùng
> feed HDMI đó làm preview chính (mượt, đúng luồng webcam có sẵn), còn
> gphoto2 chỉ lo mỗi việc bấm chụp + tải ảnh (Bước 3) — khi đó bước live
> view này trở thành TÙY CHỌN, không bắt buộc phải làm nếu kiosk có HDMI.

- Main process gọi `gphoto2 --capture-preview` theo chu kỳ (tần suất xác
  định thật ở Bước 0, không giả định trước), gửi từng khung JPEG qua IPC
  sang renderer.
- Renderer cần **component preview mới** (không tái dùng `<video>` hiện
  tại vì đây không phải `MediaStream`) — vẽ liên tục từng JPEG nhận được
  lên `<canvas>`/`<img>`.
- Dừng vòng lặp live view đúng theo màn hình đang mở, không để chạy nền
  vô ích khi không cần (mỗi lần gọi là một subprocess mới hoặc một tiến
  trình con giữ kết nối — cần chọn cách nào ít tốn tài nguyên hơn khi đo
  thực tế ở Bước 0/1).

### Bước 3 — Chụp + lấy file về
- Gọi `--capture-image-and-download`, đọc file JPEG vừa tải về từ đĩa.
- Đẩy bytes vào **đúng chỗ** `uploads.ts` hôm nay đang nhận base64 snapshot
  — không đổi gì ở outbox/upload worker.
- Cấu hình camera lưu JPEG (không RAW) để khớp thẳng pipeline AI/thẻ hiện
  tại, không cần thêm bước convert.

### Bước 4 — Giao diện gán vai trò camera
- Mở rộng `CameraSetupScreen.tsx`/`CameraRoleMapping` để chọn "Canon (dây,
  qua gphoto2)" làm một vai trò, hiển thị tên máy/trạng thái kết nối riêng
  (khác hẳn `deviceId` của webcam).
- **Đường HDMI + capture card KHÔNG cần mục riêng ở đây** — nó tự hiện ra
  trong đúng danh sách webcam có sẵn hôm nay (`enumerateDevices()`), chọn
  y hệt cách chọn một webcam bình thường. Vận hành viên có thể gán role
  CENTER = Canon qua gphoto2 (chụp ảnh thật), role khác = capture card qua
  HDMI (nếu muốn preview/quay video mượt hơn) — hoặc chỉ dùng 1 trong 2,
  tùy kiosk. Không cần code gì thêm cho phần lựa chọn HDMI.

### Bước 5 — Chịu lỗi cho kiosk
- gphoto2 binary chưa cài đúng chỗ/thiếu — phát hiện và báo lỗi rõ ngay
  lúc khởi động, không đợi tới lúc bấm chụp mới biết.
- Camera bị driver Windows mặc định giữ mất cổng USB (lỗi thực tế hay
  gặp nhất với tethered shooting nói chung, xem ghi chú Bước 0).
- Subprocess treo/không phản hồi (timeout), mất kết nối giữa chừng, hết
  pin, đầy thẻ nhớ — báo lỗi rõ cho vận hành viên, không bao giờ crash
  kiosk (đúng tinh thần các chỗ khác trong app đã làm, ví dụ `reprocess`
  xử lý sidecar lỗi sạch sẽ).

### Bước 6 — Đóng gói
- Bundle binary Windows của gphoto2 (từ MSYS2) vào `electron-builder`
  (`files`/`extraResources`) — không cần bundle DLL SDK của hãng nào,
  không cần cài đặt phần mềm bên thứ ba riêng như digiCamControl.
- **Bundle thêm `wdi-simple.exe` (từ [libwdi](https://github.com/pbatard/libwdi))**
  — dùng để tự động đổi driver WinUSB cho camera, xem chi tiết ở mục "Khi
  tải app Looka về máy". Gọi với đúng VID/PID (mã hãng/mã thiết bị USB)
  của từng model Canon (R6 Mark II và R6 Mark III có PID khác nhau, cần
  tra đúng cho từng model — xác nhận ở Bước 0 khi có máy thật) và cờ
  `--silent`.
- Thiết kế thời điểm gọi `wdi-simple.exe`: **không phải lúc cài Looka**
  (camera chưa chắc đã cắm) mà là **lúc main process phát hiện một thiết
  bị Canon mới cắm vào chưa có driver WinUSB đúng** — kích hoạt hộp thoại
  UAC đúng lúc đó, một lần cho mỗi máy ảnh mới trên mỗi kiosk.
- Xác nhận lại vấn đề giấy phép LGPL/GPL (libgphoto2/gphoto2) trước khi
  phát hành (xem "Đánh đổi" ở trên) — `libwdi` bản thân là LGPL v3, cũng
  cần xác nhận cùng lúc.
- Kiểm tra phần mềm diệt virus có chặn nhầm binary điều khiển camera
  không.

### Bước 7 — Test trên phần cứng thật
- **Không thể test trong phiên làm việc này** — Claude Code không có máy
  ảnh Canon thật để kết nối. Toàn bộ Bước 0-6 khi code xong sẽ cần người
  dùng tự kiểm thử trên kiosk thật + Canon thật (R6 Mark II và/hoặc Mark
  III), khác với các phần khác của hệ thống mà Claude có thể tự verify qua
  HTTP/trình duyệt.

## Điểm chưa chốt — cần quyết định trước hoặc trong lúc code

- Xác nhận giấy phép LGPL (libgphoto2)/GPL (gphoto2 CLI) có ổn với cách
  Looka được phân phối/bán hay không — cần người phụ trách pháp lý xác
  nhận, không phải quyết định kỹ thuật thuần túy.
- Độ trễ/tần suất khung hình thật của `--capture-preview` trên đúng 2 máy
  này — chỉ biết chắc sau Bước 0, ảnh hưởng trực tiếp thiết kế Bước 2.
- Cách xử lý driver USB mặc định của Windows giữ mất camera (Zadig/libusb
  hay cách khác) — cần chốt ở Bước 0 trước khi thiết kế Bước 6 (đóng gói/
  hướng dẫn cài đặt cho vận hành viên).
- Có cần chạy nhiều camera tethered cùng lúc trên 1 kiosk không (vd CENTER
  là Canon, LEFT/RIGHT vẫn là webcam), hay chỉ 1 Canon duy nhất?
- Có cần lưu cả RAW không, hay JPEG là đủ cho toàn bộ pipeline thẻ/AI hiện
  tại?
- **Nếu một kiosk cụ thể muốn cắm CẢ USB lẫn HDMI vào CÙNG MỘT máy ảnh
  cùng lúc** (để vừa có app tự bấm chụp qua gphoto2, vừa có preview mượt
  qua HDMI) — chưa xác nhận được máy có cho dùng đồng thời cả 2 cổng hay
  không (đã tra cứu nhưng không tìm được câu trả lời rõ ràng). Không
  chặn plan này (2 đường vẫn dùng ĐỘC LẬP được, không cần cả 2 cùng lúc),
  nhưng nếu vận hành viên muốn kết hợp trên 1 máy, cần tự thử ở Bước 0.

## Không đụng tới (rõ ràng ngoài phạm vi plan này)

- Luồng webcam hiện tại (`BrowserCameraService`, `CameraService` interface)
  — giữ nguyên 100%, camera tethered là đường SONG SONG, không thay thế.
- Pipeline lưu trữ/upload (`uploads.ts`, SQLite outbox, fs-core) — không
  đổi, camera tethered chỉ là một nguồn bytes mới đưa vào đúng chỗ cũ.
- **Canon EDSDK trực tiếp** — đã cân nhắc (bản plan trước cùng ngày), bỏ
  vì người dùng không muốn tốn thời gian đăng ký Developer Program. Có
  thể xem lại nếu gphoto2 gặp giới hạn thật sự không giải quyết được ở
  Bước 0.
- **digiCamControl** — đã cân nhắc, bỏ vì không có xác nhận tương thích
  công khai cho 2 model này (xem "Lịch sử quyết định" ở đầu tài liệu).
- Hỗ trợ đa hãng máy ảnh khác ngoài Canon — ngoài phạm vi (dù libgphoto2
  bản thân hỗ trợ đa hãng, phần code tích hợp trong plan này chỉ nhắm
  đúng 2 model Canon đang dùng).

## Verification

Phần code KHÔNG phụ thuộc phần cứng thật (mở rộng kiểu dữ liệu
`CameraRoleMapping`, IPC handler wiring, UI chọn vai trò) verify được như
thường lệ: build/lint/test. Phần THẬT SỰ chạy được (gphoto2 nhận diện máy,
capture, live view polling, tải file) bắt buộc kiểm thử trên kiosk thật với
Canon thật — người dùng tự làm, Claude không tự verify được phần này.

**Chưa code gì trong tài liệu này — chờ người dùng duyệt plan trước khi bắt
đầu triển khai.**

---
Nguồn tham khảo (khảo sát 2026-09-21, xem trực tiếp mã nguồn/trang chính
thức, không suy đoán):
[libgphoto2 — canon-eos-r6-markii.txt](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/cameras/canon-eos-r6-markii.txt),
[libgphoto2 — canon-eos-r6-markIII.txt](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/cameras/canon-eos-r6-markIII.txt),
[MSYS2 mingw-w64-x86_64-libgphoto2 package](https://packages.msys2.org/packages/mingw-w64-x86_64-libgphoto2),
[libwdi (pbatard/libwdi) — công cụ tự động hoá cài driver WinUSB, dùng thay Zadig thủ công](https://github.com/pbatard/libwdi),
[EDSDK Release Note, Canon South & Southeast Asia](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note)
(dùng cho bản plan trước, vẫn còn giá trị tham khảo nếu quay lại phương án
EDSDK).
