# Kế hoạch thiết kế lại giao diện — kiosk, web, CMS

> **Trạng thái:** bản thảo để product owner duyệt — chưa code. Ngày lập:
> 2026-09-08. Bám theo toàn bộ quyết định đã chốt trong
> `campaign-config-sso-card-photo-discussion.md` (Q1–Q22 đã chốt; Q23 —
> chặn xác nhận phiên khi thiếu video — tạm theo mặc định, chưa hỏi riêng).
>
> Phạm vi: **kiosk desktop** (`apps/desktop` + `packages/ui`), **web**
> (`apps/web`, cùng luồng SSO), **CMS** (`apps/cms`), **màn hình mở rộng**
> (CB Help). Tài liệu này mô tả *màn hình, bố cục, trạng thái, thành phần,
> câu chữ* — không mô tả API/DB (đã có ở tài liệu thảo luận).

---

## 0. Nguyên tắc thiết kế

1. **Một luồng duy nhất, không đường tắt:** Đăng nhập → Chọn campaign →
   Trang campaign → Nhập mã SV → Chụp → Xác nhận → quay lại Nhập mã SV.
   Mọi phím tắt hiện có (`Ctrl+Shift+K/H/S`) chỉ mở cửa sổ phụ, không
   nhảy vào màn chụp.
2. **Campaign nói "chụp cái gì", kiosk nói "chụp bằng gì / như thế nào".**
   Trên màn hình, thông tin campaign (N ảnh, góc, ảnh thẻ) và cài đặt
   thiết bị (camera, tuần tự/đồng thời, tự động/bấm nút) luôn hiển thị
   ở **hai khối tách biệt**, không trộn.
3. **Mọi trạng thái chặn đều có lý do + hành động kế tiếp** ngay tại chỗ
   (nút mở Cài đặt thiết bị, nút Đăng ký, ngày mở campaign…). Không có
   nút mờ mà không giải thích.
4. **Offline-first ở kiosk:** mọi màn có trạng thái "mất kết nối" rõ ràng,
   dữ liệu cục bộ vẫn dùng được (danh sách đã chụp, cấu hình đã cache
   24h).
5. **Tái dùng trước, thêm mới sau.** Thành phần có sẵn được giữ nguyên
   hành vi (`StudentIdEntryScreen`, `SessionReviewModal`, `FrameTile`,
   `MultiFrameGrid`, `CbHelpFrames`, `CameraSetupScreen`, các panel CMS);
   thành phần mới liệt kê ở mục 6.
6. **Hai theme, không đổi:** kiosk/web giữ theme tối "liquid glass" hiện
   có (`LiquidGlassCard`); CMS giữ theme sáng (gray-50 / white / gray-900,
   Tailwind 4). Kích thước chạm tối thiểu 44 px trên kiosk.
7. **Từ vựng thống nhất** (mục 4) — cùng một từ cho cùng một trạng thái ở
   kiosk, web, CMS.

---

## 1. Bản đồ màn hình

```
KIOSK / WEB                                  CMS (admin, SSO)
────────────────────────────────             ─────────────────────────────────
S1 Đăng nhập (SSO)                           C0 Đăng nhập (SSO, đã có)
 └ S2 Chọn campaign                          C1 Tổng quan (StatsOverview, đã có)
    └ S3 Trang campaign                      C2 Campaign
       ├ S4 Nhập mã SV (đã có)                 ├ C2.1 Danh sách
       │  └ S5 Màn chụp                        ├ C2.2 Tạo / Sửa (form 3 phần)
       │     └ S6 Xem lại & xác nhận (đã có)   └ C2.3 Chi tiết (5 tab)
       ├ S7 Cài đặt thiết bị (mở rộng)             ├ Thống kê
       ├ S8 Màn hình mở rộng (đã có, kiểm tra)     ├ Phiên chụp
       └ S9 Danh sách đã chụp đầy đủ (đã có)       ├ Cán bộ chụp (mới)
                                                    ├ Thiết bị (chỉ xem)
G  Trạng thái toàn cục: mất mạng,                   └ Cài đặt
   hết phiên đăng nhập, campaign đổi            C3 Góc chụp (mới — danh mục)
   trạng thái giữa chừng, mất camera            C4 Sinh viên (đã có, thêm cột)
                                                C5 Duyệt ảnh (mới — khu vực riêng,
                                                   vai trò REVIEWER; xem
                                                   cms-photo-review-plan.md)
```

Web (`apps/web`) dùng đúng S1–S6 và S9 của kiosk qua `@face/ui`; không có
S7/S8 (không có camera vật lý nhiều vai trò, không có cửa sổ phụ) — trên
web S3 hiện "1 camera · Tuần tự" cố định.

---

## 2. Kiosk / Web — từng màn hình

### S1. Đăng nhập

**Mục đích:** lấy token SSO; lần đầu trên máy còn tự đăng ký thiết bị
ngầm (không có UI cho việc này ngoài một dòng trạng thái).

```
┌──────────────────────────────────────────────┐
│                                              │
│              [Looka]  Chụp ảnh thẻ            │
│                                              │
│     ┌────────────────────────────────┐       │
│     │  Đăng nhập bằng tài khoản     │       │
│     │  Microsoft 365 của trường     │       │
│     └────────────────────────────────┘       │
│                                              │
│   Máy: PC-PHONG-A101 · Phiên bản 0.2.0       │
│   ● Đã kết nối máy chủ                       │
│                                              │
└──────────────────────────────────────────────┘
```

- Nút duy nhất mở cửa sổ SSO (desktop: `BrowserWindow` tới
  `VITE_URL_LOGIN_SSO?continueUrl=https://<origin CMS>/desktop-callback`,
  app bắt redirect và đọc token khỏi query string rồi tự đóng cửa sổ —
  **không** dùng `looka://`, SSO chỉ chấp nhận `continueUrl` https tuyệt
  đối; web: redirect như CMS). Trong lúc chờ: nút đổi thành "Đang chờ
  đăng nhập…" + nút "Hủy". Nếu người dùng đóng cửa sổ SSO giữa chừng →
  về S1 với dòng "Đã hủy đăng nhập".
- Dòng trạng thái máy chủ: ● xanh "Đã kết nối" / ● xám "Không kết nối
  được máy chủ — kiểm tra mạng" (vẫn cho bấm đăng nhập; SSO cần mạng nên
  sẽ báo lỗi rõ).
- Lỗi: "Đăng nhập không thành công. Thử lại." + mã lỗi nhỏ bên dưới.
- Sau đăng nhập lần đầu: toast nhỏ "Đã ghi nhận thiết bị này" (self-enroll
  xong). Không có bước nào yêu cầu cán bộ thao tác.
- Nhớ đăng nhập: có (token trong `secrets.dat`); mở app lần sau vào thẳng
  S2. Nút "Đăng xuất" nằm ở S2/S3 (góc trên phải, menu tài khoản).

### S2. Chọn campaign

**Mục đích:** liệt kê campaign, cho biết ngay campaign nào vào được.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Looka · Chọn campaign                        ● Online   [NV A ▾]     │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 2026DOT01 · Chụp ảnh thẻ K20                       [Đang mở]     │ │
│ │ 01/09 – 30/09/2026 · 10 ảnh/SV · 312/1.200 SV                    │ │
│ │ ✔ Đã duyệt                                         [Vào →]      │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ 2026DOT02 · Bổ sung K19                            [Đang mở]     │ │
│ │ 05/09 – 20/09/2026 · 5 ảnh/SV · 40/200 SV                        │ │
│ │ ○ Chưa đăng ký                                  [Đăng ký]       │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ 2026DOT03 · Tân sinh viên K21                      [Chưa mở]     │ │
│ │ Mở ngày 15/10/2026 · 10 ảnh/SV                                   │ │
│ │ ◐ Chờ duyệt (gửi 08/09 09:12)                    [Xem]          │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ 2025DOT04 · Ảnh thẻ K19                            [Hết hạn]     │ │
│ │ 01/03 – 31/03/2026                                               │ │
│ │ ✔ Đã duyệt                                         [Xem]        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ Cài đặt thiết bị  ·  Màn hình mở rộng                                │
└──────────────────────────────────────────────────────────────────────┘
```

- Mỗi thẻ: mã · tên; khoảng ngày; N ảnh/SV; tiến độ SV (đã chụp / chỉ
  tiêu, ẩn phần chỉ tiêu nếu không đặt); **badge trạng thái campaign**
  (mục 4) ở góc phải; **dòng tình trạng duyệt** + nút hành động.
- Nút hành động theo tổ hợp:

| Trạng thái campaign | Tình trạng duyệt | Nút |
|---|---|---|
| Đang mở | Đã duyệt | **Vào →** (nổi bật) |
| Đang mở | Chưa đăng ký | **Đăng ký** → gửi yêu cầu, thẻ đổi sang "Chờ duyệt" |
| Đang mở | Chờ duyệt / Từ chối / Thu hồi | Xem (S3 dạng khóa) |
| Chưa mở / Hết hạn / Tạm dừng / Đã đóng | bất kỳ | Xem (S3 dạng khóa) |

- Sắp xếp: Đang mở + Đã duyệt lên đầu; Đã đóng ẩn sau nút "Hiện campaign
  đã đóng".
- Trống: "Chưa có campaign nào. Liên hệ CTSV." Mất mạng: hiện danh sách
  từ cache 24h + băng "Đang dùng dữ liệu đã lưu lúc 09:10".
- Menu tài khoản (góc phải): tên, email, "Đăng xuất".

### S3. Trang campaign

**Mục đích:** cổng vào duy nhất của việc chụp; kiểm tra đủ điều kiện và
cho cán bộ thấy máy này sẽ chụp như thế nào trước khi bắt đầu.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Chọn campaign     2026DOT01 · Chụp ảnh thẻ K20      [Đang mở]      │
├──────────────────────────────────┬───────────────────────────────────┤
│ CAMPAIGN (chụp cái gì)           │ THIẾT BỊ NÀY (chụp bằng gì)       │
│ 01/09 – 30/09/2026               │ 2 camera: CENTER ✔  LEFT ✔        │
│ Chỉ tiêu 1.200 SV · đã 312      │ Cách chụp: Đồng thời              │
│ 10 ảnh / SV                      │ Kích hoạt: Tự động (giữ 1,5 s)    │
│  1 Thẳng (ảnh thẻ 4x6) · CENTER  │ Dự kiến: 6 vòng / SV              │
│  2 Trái 30° · LEFT               │ ⚠ Camera RIGHT không có → 3 ảnh   │
│  3 Phải 30° · RIGHT ⚠            │   sẽ chụp bằng CENTER, SV quay đầu │
│  … (cuộn)                        │                                   │
│ Quay video: CENTER               │ [Cài đặt thiết bị]                │
├──────────────────────────────────┴───────────────────────────────────┤
│                    [ ● Thực hiện chụp ảnh ]                          │
│        Tài khoản đã được duyệt · Campaign đang mở · 2 camera         │
├──────────────────────────────────────────────────────────────────────┤
│ Đã chụp trên máy này hôm nay: 12 · Tổng campaign: 312   [Xem danh sách]│
└──────────────────────────────────────────────────────────────────────┘
```

- Khối trái: đọc từ campaign config (danh sách N dòng, dòng ảnh thẻ có
  nhãn "ảnh thẻ 4x6", camera ưu tiên; dòng thiếu camera trên máy này đánh
  ⚠).
- Khối phải: đọc từ Cài đặt thiết bị (S7) — số camera đã gán, tuần
  tự/đồng thời, tự động/bấm nút, số vòng dự kiến do bộ quy đổi tính, cảnh
  báo fallback. Khi campaign bật quay video, thêm dòng **"Ghi hình: ✔ sẵn
  sàng (CENTER, LEFT)"** — kết quả kiểm tra thử `MediaRecorder` 1 giây +
  dung lượng đĩa (tài liệu thảo luận 3.10); thất bại → "✖ CENTER không
  ghi được — <lý do>" và **khóa nút chụp** (điều kiện thứ 4).
- **Nút "Thực hiện chụp ảnh"** — chỉ bật khi: campaign Đang mở **và** Đã
  duyệt **và** ≥1 camera gán **và** (nếu campaign bật quay video) ghi hình
  sẵn sàng. Dòng dưới nút luôn hiện 3 điều kiện với ✔/✖ (4 khi có quay
  video); khi bị khóa, nút mờ và dòng dưới đổi thành lý do + hành động:
  - "✖ Campaign chưa mở — mở ngày 15/10/2026"
  - "✖ Campaign đã hết hạn 30/09/2026"
  - "✖ Campaign đang tạm dừng"
  - "✖ Tài khoản chưa được duyệt — đã gửi yêu cầu 08/09 09:12" /
    "✖ Yêu cầu bị từ chối: <ghi chú>" / "○ Chưa đăng ký [Đăng ký]"
  - "✖ Chưa gán camera [Cài đặt thiết bị]"
- Cảnh báo (không khóa): "Đã đạt chỉ tiêu 1.200/1.200" và "Campaign hết
  hạn sau 2 ngày" hiện dạng băng vàng trên nút (Q5/Q6: cảnh báo, không
  chặn).
- Dòng cuối: số đã chụp trên máy này hôm nay + tổng campaign (khi
  online); "Xem danh sách" mở S9.

### S4. Nhập mã sinh viên (đã có — `StudentIdEntryScreen`)

Giữ nguyên. Bổ sung: hiện tên campaign + "vòng lặp" ở góc trên ("2026DOT01
· SV tiếp theo"), nút "← Về trang campaign" (thay vì chỉ thoát), và khi
tra cứu trả về SV **đã có phiên trong campaign này** thì hiện cảnh báo
"SV này đã chụp 10/10 lúc 09:41 trên máy PC-A102 — chụp lại sẽ tạo phiên
mới, phiên cũ vẫn giữ" với nút "Chụp lại" / "Hủy" (Q20).

### S5. Màn chụp

**Mục đích:** chụp đủ N ảnh theo vòng, cán bộ luôn biết đang chụp ai, vòng
mấy, còn ai chờ.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 2026DOT01   Vòng 2/6 · 3/10 ảnh                    ● Online  ⚙  ▢  ⏹ Hủy    │
├──────────────────┬──────────────────────────────────┬──────────────────────┤
│ NGƯỜI ĐƯỢC CHỤP  │                                  │ ĐÃ CHỤP / ĐANG CHỤP  │
│ 2210xxxx         │   ┌────────────┐ ┌────────────┐  │ ● Đang chụp          │
│ Nguyễn Văn A     │   │ CENTER     │ │ LEFT       │  │   2210xxxx N.V.A     │
│ CNTT-K20 · KTPM  │   │ live +     │ │ live       │  │   vòng 2/6 · 3/10    │
│                  │   │ overlay    │ │            │  │──────────────────────│
│ Vòng này:        │   │ "Phải 30°" │ │ "Trái 45°" │  │ ✔ 2210yyyy T.T.B     │
│  • Phải 30° (C)  │   └────────────┘ └────────────┘  │   10/10 · 09:41      │
│  • Trái 45° (L)  │                                  │ ✔ 2210zzzz L.V.C     │
│                  │      Quay mặt sang phải 30°      │   10/10 · 09:38      │
│ Đã xong:         │      ▓▓▓▓▓▓▓░░░  giữ 1,5 s       │ ✔ 2210wwww P.T.D     │
│ [1][2][3]        │              ( ● )               │   10/10 · 09:35 (A102)│
│  ▢  ▢  ▢         │        nút chụp (thủ công)       │   … cuộn             │
│                  │                                  │──────────────────────│
│                  │                                  │ Hôm nay 12 · Tổng 312│
├──────────────────┴──────────────────────────────────┴──────────────────────┤
│ [Cài đặt thiết bị]  [Màn hình mở rộng]                 [Chụp lại vòng này] │
└────────────────────────────────────────────────────────────────────────────┘
```

**Ba vùng, kích thước cố định** (desktop 16:9 ≥ 1366 px): trái 240 px,
phải 300 px, giữa co giãn. Dưới 1366 px (web, laptop nhỏ): vùng phải thu
thành nút "Đã chụp (12)" mở ngăn kéo; vùng trái thu còn badge 2 dòng.

**Vùng trái — `SubjectInfoBadge` + tiến độ vòng** (mới):
- Mã SV (to), tên, lớp · ngành · khóa (từ `StudentSubjectInfo`).
- "Vòng này": các dòng ảnh của vòng hiện tại kèm chữ cái camera.
- "Đã xong": dải thumbnail ảnh đã chụp theo số thứ tự; bấm vào một ảnh →
  chụp lại riêng ảnh đó (đi qua cơ chế `retakeStep`, đã có).

**Vùng giữa — giữ `DesktopCaptureView` + `MultiFrameGrid`**, thay đổi:
- Lưới chỉ hiện các khung của **vòng hiện tại** (1 khung khi tuần tự; K
  khung khi đồng thời). Khung CENTER có overlay hướng dẫn tư thế + thanh
  giữ (`StabilityProgress`, đã có); khung bên chỉ live + nhãn góc.
- Hướng dẫn tư thế chính giữa dưới lưới (`GuidanceMessage`, đã có), câu
  chữ lấy từ `instruction_vi` của preset.
- **Kích hoạt:** Tự động → không có nút, thanh giữ chạy tới khi chụp; Thủ
  công → `ShutterButton` (đã có) nổi bật, thanh giữ ẩn, cử chỉ tay nếu
  bật trong S7.
- Sau khi chụp một vòng: flash + ảnh "bay" về dải "Đã xong" bên trái
  (`FlyingThumbnail`, đã có), tự sang vòng kế sau 1 s.
- Các control debug hiện chiếm góc phải trên (AI Sensitivity, overlay,
  chế độ) **chuyển vào nút ⚙ trên thanh tiêu đề** (popover), không còn
  nằm trên màn chụp.

**Vùng phải — `CapturedListPanel`** (mới, thay cửa sổ ẩn `Ctrl+Shift+S`
trong ngữ cảnh đang chụp):
- Mục "Đang chụp": SV hiện tại + vòng/ảnh, cập nhật từng ảnh.
- Danh sách "Đã chụp": mới nhất lên đầu; dòng chụp trên máy khác có tên
  máy nhỏ (Q19: toàn campaign khi online, local khi offline — có băng
  "Chỉ hiện máy này (mất mạng)"). Bấm dòng → xem ảnh (S9 dạng drawer),
  **chỉ xem** (Q20).
- Chân: "Hôm nay N · Tổng campaign M".

**Thanh tiêu đề:** campaign · vòng/ảnh · trạng thái mạng · ⚙ (cài đặt
nhanh: độ nhạy AI, overlay) · ▢ (màn hình mở rộng) · ⏹ Hủy phiên (xác
nhận 2 bước, đã có `handleCancelWorkflow`).

**Ghi hình (khi campaign bật):** mỗi khung đang ghi có nhãn **● REC 00:42
· 3,1 MB** góc trên trái khung, số MB tăng mỗi giây (từ `timeslice` 1 s).
Ba giây không có dữ liệu → nhãn đỏ nhấp nháy "Mất dữ liệu ghi hình" và
recorder tự khởi động lại một lần; vẫn hỏng → băng đỏ trên lưới "Video
CENTER không ghi được — phiên này sẽ phải chụp lại" (không cắt ngang SV,
nhưng S6 sẽ chặn xác nhận). Không có nhãn REC nào khi campaign không bật
quay video — để cán bộ nhìn là biết có đang ghi hay không.

**Trạng thái chặn trong S5** (thay `FramesBlockedPanel` chặn cứng):
- Mất camera giữa phiên (`devicechange`): khung đó chuyển xám "Mất camera
  LEFT — cắm lại hoặc [Tiếp tục bằng CENTER]" (tính lại vòng) — chỉ chặn
  khi không còn camera nào.
- Campaign đổi trạng thái giữa phiên (hết hạn/tạm dừng/thu hồi duyệt,
  phát hiện khi đồng bộ): **cho chụp xong phiên đang dở**, chặn phiên
  mới ở S4 với lý do. Không cắt ngang SV đang đứng trước máy.

### S6. Xem lại & xác nhận (đã có — `SessionReviewModal`)

Giữ nguyên hành vi (xem N ảnh, chụp lại từng ảnh, "Xác nhận & Lưu hồ
sơ"). Bổ sung: đánh dấu ảnh nào là **ảnh thẻ 4x6** (khung viền + nhãn),
hiện ảnh có `fallback: true` với nhãn nhỏ "chụp thay bằng CENTER" (Q18),
và tổng kết "10/10 ảnh · 6 vòng · Tự động". Khi campaign bật quay video:
dòng **"Video: ✔ 42 s · 3,1 MB (CENTER) · ✔ 42 s (LEFT)"** sau khi kiểm
tra file xong; nếu thiếu → "✖ Video CENTER thiếu — phải chụp lại", nút
"Xác nhận & Lưu hồ sơ" **mờ** và chỉ còn "Chụp lại toàn bộ" (Q23).

### S7. Cài đặt thiết bị (mở rộng `CameraSetupScreen`)

**Mục đích:** một nơi duy nhất cho mọi thứ thuộc về máy này.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Cài đặt thiết bị — PC-PHONG-A101                              [Đóng] │
├──────────────────────────────────────────────────────────────────────┤
│ 1. GÁN CAMERA (campaign 2026DOT01 cần: CENTER, LEFT, RIGHT)          │
│ ┌──────────┬───────────────────────┬────────────┬───────────────────┐ │
│ │ Vai trò  │ Camera                │ Góc đặt    │ Xem trước         │ │
│ │ CENTER * │ [Logitech C920      ▾]│ 0°         │ [live]            │ │
│ │ LEFT     │ [USB Camera #2      ▾]│ [−30°]     │ [live]            │ │
│ │ RIGHT    │ [— chưa gán —       ▾]│ [+30°]     │ ⚠ 3 ảnh sẽ chụp   │ │
│ └──────────┴───────────────────────┴────────────┴─── bằng CENTER ───┘ │
│ ▸ Vai trò khác (UP, DOWN) — thu gọn                                  │
│ 2. CÁCH CHỤP        (•) Đồng thời — K camera bấm cùng lúc mỗi vòng    │
│                     ( ) Tuần tự — từng ảnh một                        │
│ 3. KÍCH HOẠT CHỤP   (•) Tự động — đủ tư thế thì chụp, giữ [1,5 s ▾]   │
│                     ( ) Thủ công — bấm nút   [ ] cho phép cử chỉ tay  │
│ 4. KIỂM TRA         Dự kiến 6 vòng / SV cho campaign này              │
│                     [Chụp thử 1 vòng (không lưu)]  ← chỉ cho cán bộ  │
│                                                       đã duyệt (Q13)  │
│                                              [Hủy]  [Lưu cài đặt]     │
└──────────────────────────────────────────────────────────────────────┘
```

- Phần 1 giữ đúng hành vi hiện có (hàng theo vai trò campaign cần, chọn
  camera đã dùng ở vai trò khác thì chuyển sang, cảnh báo thiếu, cập nhật
  khi cắm/rút). Thêm cột **Góc đặt** (yaw/pitch vật lý, mặc định theo vai
  trò).
- Phần 2/3 là **nguồn duy nhất** của tuần tự/đồng thời và tự động/thủ
  công (không còn ở campaign). "Đồng thời" mờ + ghi chú khi máy chỉ có 1
  camera.
- Phần 4: số vòng dự kiến tính ngay khi đổi cài đặt; "Chụp thử" chỉ hiện
  cho tài khoản đã duyệt với campaign đang chọn, không tạo phiên, không
  lưu (Q13 áp dụng cho người *chưa* duyệt).
- Mở từ: S2/S3/S5 (nút), `Ctrl+Shift+K` (giữ). Vẫn là cửa sổ riêng như
  hiện nay.

### S8. Màn hình mở rộng (đã có — `CbHelpFrames`)

Giữ nguyên bố cục và vòng đời (`idle | live | review | done`). Thay đổi
duy nhất: header hiện "SV 2210xxxx · Vòng 2/6 · 3/10", lưới hiện khung
của **vòng hiện tại**, dưới lưới có dải ảnh đã xong. Ảnh thẻ có nhãn. Khi
`done`: lưới đầy đủ N ảnh, giữ đến khi phiên mới. Kiểm tra theo checklist
3.8.3 của tài liệu thảo luận trên phần cứng thật.

**Vì SV là người nhìn màn này (U-Q3 đã chốt)**, S8 phải mang phần hướng
dẫn mà hiện chỉ có trên màn chính: câu hướng dẫn tư thế **cỡ chữ ≥ 48 px**
("Quay mặt sang phải 30°"), thanh giữ tư thế / đếm ngược to, nhãn ● REC,
và lời chào "Xin chào Nguyễn Văn A" khi bắt đầu (đã có `GREETING`). S8
**không** hiện danh sách "Đã chụp" của SV khác (riêng tư), không hiện mã
SV khác, không hiện control nào. Snapshot `cbhelp:publish` cần thêm
`guidance { instruction, progress, countdown }` — hiện chỉ mang khung
hình. Câu hỏi để ngỏ: có **lật gương riêng phần preview live trên S8**
không (quyết định "never mirror" trong ROADMAP áp dụng cho ảnh chụp và
preview; SV nhìn preview không lật sẽ thấy mình di chuyển ngược chiều) —
U-Q7 ở mục 8.

### S9. Danh sách đã chụp đầy đủ (đã có — `RecentStudentsScreen`)

Giữ cửa sổ `Ctrl+Shift+S` làm bản đầy đủ: tìm theo mã/tên, lọc theo
ngày/máy, xem ảnh + video của phiên. Bổ sung cột "Máy", "Campaign",
"Cách chụp" (Tự động/Thủ công) và nút "Mở trong CMS" (copy link) — chỉ
xem (Q20).

### G. Trạng thái toàn cục

| Tình huống | Hiển thị | Hành vi |
|---|---|---|
| Mất mạng | Chấm ● xám trên thanh tiêu đề mọi màn + băng mỏng "Đang làm việc ngoại tuyến — dữ liệu sẽ đồng bộ khi có mạng" | S2/S3 dùng cache ≤24h; S5 chụp bình thường (upload outbox đã có); quá 24h chưa xác nhận được → S3 khóa "Cần kết nối để xác nhận quyền" |
| Token SSO hết hạn | Modal "Phiên đăng nhập đã hết — đăng nhập lại" | Không mất phiên chụp đang dở; sau đăng nhập lại về đúng màn cũ |
| Tài khoản bị thu hồi duyệt | Băng đỏ ở S3; S2 badge "Thu hồi" | Cho xong phiên đang dở, chặn phiên mới |
| Campaign hết hạn giữa ngày | Băng vàng "Campaign đã hết hạn lúc 17:00" | Như trên |
| Không camera nào | S3 khóa + nút Cài đặt thiết bị | — |
| Lỗi upload tích lũy | Chấm vàng + số ở thanh tiêu đề "3 ảnh chờ upload" | Bấm mở danh sách outbox (đã có dữ liệu) |

---

## 3. CMS — từng màn hình

### C0. Đăng nhập (đã có) — giữ nguyên. Sau đăng nhập, người không có quyền
admin (theo `AdminRoleGuard`) thấy trang "Tài khoản của bạn chưa được cấp
quyền quản trị" thay vì vào được mọi thứ như hiện nay.

### C1. Tổng quan (`StatsOverview`, đã có)

Thêm: cột "Tự động / Thủ công" (%) và "Số vòng TB / SV" theo campaign;
ô KPI "Đang chụp lúc này" (số phiên `SESSION_STARTED` chưa `COMPLETED`
trong 15 phút gần nhất, theo máy).

### C2.1. Danh sách campaign (`CampaignList`, đã có)

Cột: Mã · Tên · Khóa · Thời gian · **Trạng thái** (badge mục 4, tự suy +
thủ công) · N ảnh · Tiến độ (đã chụp / chỉ tiêu, thanh) · Chờ duyệt (số
người) · Thao tác. Bộ lọc trạng thái; "Tạo campaign" → C2.2.

### C2.2. Tạo / Sửa campaign (`CreateCampaignPage` / `EditCampaignPage`)

Form **3 phần, cuộn dọc, có mục lục bên trái**; cùng một component cho
tạo và sửa (hiện đang là 2 trang gần trùng).

```
┌────────────┬─────────────────────────────────────────────────────────┐
│ 1 Thông tin│ 1. THÔNG TIN                                            │
│ 2 Ảnh chụp │ Mã [2026DOT01]  Tên [Chụp ảnh thẻ K20      ]  Khóa [K20]│
│ 3 Ảnh thẻ  │ Mô tả [                                              ] │
│            │ Bắt đầu [01/09/2026 08:00]  Hết hạn [30/09/2026 17:00]  │
│            │ Chỉ tiêu SV [1200]  Trạng thái thủ công [— Tự động ▾]   │
│            │ Trạng thái hiệu lực: [Đang mở]  (tự suy từ ngày)        │
│            ├─────────────────────────────────────────────────────────┤
│            │ 2. ẢNH CHỤP  — 10 ảnh · cần tối đa 3 camera  [Mẫu 5 ▾ 10]│
│            │ ┌──┬────────────────┬────────┬───────────┬──────┬──────┐ │
│            │ │# │ Góc            │ Camera │ Đánh giá  │ Ảnh  │      │ │
│            │ │  │                │ ưu tiên│ yaw/pitch │ thẻ  │      │ │
│            │ │1 │ Thẳng          │ CENTER │ 0±12/0±12 │ (•)  │ ⋮ 🗑 │ │
│            │ │2 │ Trái 30°       │ LEFT   │ −30±8     │ ( )  │ ⋮ 🗑 │ │
│            │ │3 │ Phải 30°       │ RIGHT  │ +30±8     │ ( )  │ ⋮ 🗑 │ │
│            │ │… │                │        │           │      │      │ │
│            │ └──┴────────────────┴────────┴───────────┴──────┴──────┘ │
│            │ [+ Thêm góc từ danh mục]   Quay video: [x]CENTER [ ]LEFT…│
│            │ Xem trước trên kiosk: [1 camera: 10 bước] [3 camera: 4 vòng]│
│            ├─────────────────────────────────────────────────────────┤
│            │ 3. ẢNH THẺ                                              │
│            │ Cỡ [4x6 cm ▾]  DPI [300 ▾]  Nền [■ #FFFFFF]             │
│            │ Làm mịn [x] bật  Mức [Nhẹ ▾]   Tỉ lệ đầu [0.70–0.80]     │
│            │ Xem trước: [ảnh mẫu → khung crop]                        │
│            │                                     [Hủy] [Lưu campaign] │
└────────────┴─────────────────────────────────────────────────────────┘
```

- Phần 2: bảng N dòng kéo thả; **"Thêm góc từ danh mục"** mở picker (C3)
  → dòng mới điền sẵn pose mặc định → ô "Đánh giá" **bắt buộc xác nhận**
  (viền vàng cho tới khi cán bộ bấm vào). Mẫu 5/10 ảnh thay toàn bộ bảng
  (xác nhận trước). Radio "Ảnh thẻ" đúng 1 dòng. Dòng tổng: "10 ảnh ·
  cần tối đa 3 camera" tính từ camera ưu tiên phân biệt.
- "Xem trước trên kiosk": mô phỏng bộ quy đổi cho 1/2/3/5 camera — để
  CTSV thấy campaign 10 ảnh sẽ mất mấy vòng trên máy 2 camera.
- **Không còn** ô chế độ chụp, tự động/thủ công, chụp đồng thời (đã về
  kiosk).
- Phần 3: `card_spec`; xem trước crop trên một ảnh mẫu cố định.

### C2.3. Chi tiết campaign (`CampaignDetail`) — 5 tab

| Tab | Nội dung | Thành phần |
|---|---|---|
| Thống kê | tiles hiện có + **Tự động / Thủ công** (2 ô, tooltip cử chỉ/nút), số vòng TB, theo máy, 30 ngày chồng màu | `StatsPanel` (sửa) |
| Phiên chụp | danh sách hiện có + cột "Kích hoạt", "Vòng", "Máy", **"Video"** (Có n / Đang upload / **Thiếu** — đỏ khi campaign bật quay mà không có); bộ lọc "phiên thiếu video"; drawer có ảnh gốc + **ảnh thẻ 4x6** cạnh nhau, nút "Xử lý lại ảnh thẻ", trình phát video theo camera | `SessionsPanel`, `SessionDetailDrawer` (sửa) |
| **Cán bộ chụp** (mới) | hàng chờ duyệt (tên, email, máy đã đăng nhập, thời điểm gửi) với **Duyệt / Từ chối (ghi chú)**; danh sách đã duyệt với **Thu hồi**; lọc trạng thái | `MembersPanel` (mới) |
| Thiết bị | chỉ xem: tên máy, người đăng nhập gần nhất, lần xác thực cuối, số camera, cách chụp/kích hoạt (từ `SESSION_REPORT`), "Xem ảnh đã chụp", **Thu hồi** | `DevicesPanel` (bỏ form đăng ký + tải zip) |
| Cài đặt | = C2.2 ở chế độ sửa + `CampaignDangerActions` | đã có |

### C3. Góc chụp — danh mục (mới)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Góc chụp                                             [+ Thêm góc]   │
│ ┌────────┬──────────────┬────────┬─────────────┬───────┬──────────┐ │
│ │ Mã     │ Tên          │ Camera │ Mặc định    │ Dùng  │          │ │
│ │ FRONT  │ Thẳng        │ CENTER │ 0±12 / 0±12 │ 12 cp │ Sửa      │ │
│ │ LEFT_30│ Trái 30°     │ LEFT   │ −30±8       │ 9 cp  │ Sửa      │ │
│ │ SMILE  │ Thẳng, cười  │ CENTER │ 0±12, smile │ 2 cp  │ Sửa Ẩn   │ │
│ └────────┴──────────────┴────────┴─────────────┴───────┴──────────┘ │
│ Mẫu: [5 ảnh chuẩn] [10 ảnh chuẩn]  [+ Tạo mẫu từ campaign…]        │
└──────────────────────────────────────────────────────────────────────┘
```

Form thêm/sửa: mã (khóa sau khi tạo), tên, câu hướng dẫn cho SV, camera
ưu tiên, yaw/pitch/roll target ± tolerance với **hình minh họa đầu quay
theo giá trị đang nhập** (SVG đơn giản), yêu cầu chất lượng tùy chọn.
Góc hệ thống (5 góc gốc) không xóa, chỉ sửa. Ẩn góc đang nằm trong
campaign Đang mở → cảnh báo, không chặn.

### C4. Sinh viên (`StudentsPage`, đã có)

Thêm cột "Đang chụp" (máy + vòng, từ `SESSION_STARTED`), cột "Ảnh thẻ"
(thumbnail 4x6 hoặc "chưa xử lý"), lọc "chỉ SV thiếu ảnh thẻ". Drawer SV
→ phiên → `SessionDetailDrawer` (giữ).

---

## 4. Hệ thống thiết kế và từ vựng

### 4.1. Từ vựng thống nhất (dùng ở cả kiosk, web, CMS)

| Khái niệm | Từ dùng | Không dùng |
|---|---|---|
| Campaign | **Campaign** (giữ, CMS đã dùng) | đợt, chiến dịch |
| Trạng thái campaign | **Chưa mở · Đang mở · Hết hạn · Tạm dừng · Đã đóng** | active/expired |
| Tình trạng duyệt | **Chưa đăng ký · Chờ duyệt · Đã duyệt · Từ chối · Thu hồi** | pending/approved |
| Kích hoạt chụp | **Tự động · Thủ công** (chi tiết: Bấm nút / Cử chỉ tay) | AUTO/MANUAL/OFF |
| Cách chụp | **Tuần tự · Đồng thời** | sequential/simultaneous |
| Vòng | **Vòng k/K** | round |
| Ảnh mục tiêu | **N ảnh / SV** | khung, frame |
| Ảnh thẻ | **Ảnh thẻ 4x6** | card photo |
| Camera vai trò | **CENTER · LEFT · RIGHT · UP · DOWN** (giữ mã, thêm nhãn "giữa/trái/phải/trên/dưới" khi rê chuột) | — |
| Cán bộ chụp | **Cán bộ chụp** (người đăng nhập kiosk) | operator, user |

### 4.2. Màu badge (cùng bảng cho kiosk tối và CMS sáng, chỉ đổi nền)

| Trạng thái | Màu |
|---|---|
| Đang mở / Đã duyệt / Online / Tự động | xanh lá (emerald) |
| Chưa mở / Chờ duyệt | vàng (amber) |
| Hết hạn / Từ chối / Thu hồi / Offline | đỏ (rose) |
| Tạm dừng / Đã đóng / Thủ công | xám (slate) |
| Ảnh thẻ | xanh dương (blue) viền |

### 4.3. Kích thước và tương tác trên kiosk

- Mục tiêu chạm ≥ 44 px; nút chính "Thực hiện chụp ảnh" ≥ 64 px cao.
- Chữ mã SV ở vùng trái ≥ 28 px; tên ≥ 20 px (cán bộ đứng cách 1 m).
- Không dùng hover để lộ hành động (kiosk có thể cảm ứng) — mọi hành động
  là nút thấy được; tooltip chỉ bổ sung.
- Phím tắt giữ: `Ctrl+Shift+K` (S7), `Ctrl+Shift+H` (S8),
  `Ctrl+Shift+S` (S9); thêm `Esc` = Hủy phiên (có xác nhận).

### 4.4. Câu chữ chuẩn cho lý do khóa (dùng chung S2/S3/S4)

- "Campaign chưa mở — mở ngày {date}"
- "Campaign đã hết hạn {date}"
- "Campaign đang tạm dừng"
- "Tài khoản chưa được duyệt — đã gửi yêu cầu {datetime}"
- "Yêu cầu bị từ chối: {note}"
- "Quyền tham gia đã bị thu hồi"
- "Chưa gán camera cho máy này"
- "Cần kết nối máy chủ để xác nhận quyền (đã ngoại tuyến quá 24 giờ)"

---

## 5. Tiêu chí nghiệm thu giao diện

| Màn | Kiểm tra |
|---|---|
| S1 | Đăng nhập thành công → S2; lỗi hiện mã; lần đầu có toast thiết bị |
| S2 | 4 tổ hợp trạng thái × duyệt hiện đúng nút (bảng S2); Đăng ký → Chờ duyệt không cần tải lại; offline hiện cache + băng |
| S3 | Nút chỉ bật khi đủ 3 điều kiện (4 khi campaign bật quay video — kiểm tra ghi hình thử pass); mỗi lý do khóa hiện đúng câu 4.4 + hành động; số vòng dự kiến đổi ngay khi sửa S7 |
| S5 | Trái: đúng SV, đúng vòng; giữa: chỉ khung vòng hiện tại; phải: "Đang chụp" cập nhật từng ảnh, danh sách toàn campaign khi online; campaign 10 ảnh trên máy 2 camera chụp đủ 10; máy 1 camera 10 bước; rút camera không treo |
| S6 | Ảnh thẻ được đánh dấu; ảnh fallback có nhãn |
| S7 | Đổi Tuần tự/Đồng thời và Tự động/Thủ công có hiệu lực phiên kế tiếp không cần khởi động lại; "Đồng thời" mờ khi 1 camera |
| S8 | Checklist 10 mục ở tài liệu thảo luận 3.8.3, trên màn hình thứ hai thật |
| C2.2 | Thêm góc từ danh mục bắt buộc xác nhận độ; đúng 1 ảnh thẻ; mẫu 5/10 thay bảng có xác nhận; không còn ô chế độ chụp |
| C2.3 | Duyệt/Từ chối/Thu hồi phản ánh lên kiosk trong ≤ 1 phút khi online; Thiết bị không còn nút đăng ký/tải zip |
| C3 | Ẩn góc đang dùng → cảnh báo; 5 góc gốc không xóa được |
| Toàn bộ | Từ vựng 4.1 đồng nhất; badge 4.2 đồng nhất; không có chữ tiếng Anh kỹ thuật lộ ra người dùng cuối |

---

## 6. Thành phần: mới / sửa / giữ

| Thành phần | Gói | Loại | Ghi chú |
|---|---|---|---|
| `LoginScreen` | `packages/ui` | **mới** | dùng chung desktop/web; desktop bơm hàm mở cửa sổ SSO qua `faceAPI` |
| `CampaignPickerScreen` | `packages/ui` | **mới** | thẻ campaign + badge + nút theo bảng S2 |
| `CampaignHomeScreen` | `packages/ui` | **mới** | S3, hai khối + nút chính + điều kiện |
| `CampaignStatusBadge`, `MembershipBadge` | `packages/ui` | **mới** | dùng cả CMS qua copy nhẹ (CMS không import `@face/ui`) |
| `SubjectInfoBadge` | `packages/ui` | **mới** | vùng trái S5 |
| `CapturedListPanel` | `packages/ui` | **mới** | vùng phải S5; nguồn local + API |
| `RoundPlanSummary` | `packages/ui` | **mới** | "K camera · Đồng thời · Tự động · N vòng", dùng S3/S7 |
| `DesktopCaptureView` | `packages/ui` | sửa | 3 vùng, lưới theo vòng, debug vào ⚙ |
| `FramesBlockedPanel` | `packages/ui` | sửa | chỉ chặn khi 0 camera; còn lại thành cảnh báo trong khung |
| `StudentIdEntryScreen` | `packages/ui` | sửa | header campaign, cảnh báo SV đã chụp |
| `SessionReviewModal` | `packages/ui` | sửa | nhãn ảnh thẻ, nhãn fallback |
| `CameraSetupScreen` | `apps/desktop` | sửa lớn | thành "Cài đặt thiết bị" 4 phần |
| `CbHelpFrames` | `apps/desktop` | sửa nhỏ | header vòng, dải ảnh đã xong |
| `RecentStudentsScreen` | `apps/desktop` | sửa nhỏ | thêm cột |
| `App.tsx` (desktop, web) | `apps/*` | sửa | máy trạng thái S1→S6 thay vì mount thẳng `FaceCaptureApp` |
| `CampaignForm` (gộp Create/Edit) | `apps/cms` | **mới** | form 3 phần |
| `CaptureAnglesTable` (thay `CaptureFramesEditor`) | `apps/cms` | **mới** | bảng N dòng + picker + mẫu + xem trước vòng |
| `AnglePresetsPage`, `AnglePresetForm`, `AnglePicker` | `apps/cms` | **mới** | C3 |
| `MembersPanel` | `apps/cms` | **mới** | tab Cán bộ chụp |
| `DevicesPanel` | `apps/cms` | sửa | bỏ đăng ký/zip, thêm cột cài đặt máy |
| `StatsPanel`, `StatsOverview`, `SessionsPanel`, `SessionDetailDrawer`, `StudentsPage` | `apps/cms` | sửa | cột/ô mới |
| `Layout` | `apps/cms` | sửa | nav thêm "Góc chụp"; chặn theo `AdminRoleGuard` |

---

## 7. Thứ tự làm giao diện (khớp lộ trình tài liệu thảo luận)

| Bước | Màn | Phụ thuộc backend | Ước lượng |
|---|---|---|---|
| U1 | C3 Góc chụp + C2.2 form 3 phần + `CaptureAnglesTable` | preset + campaign fields (giai đoạn 1) | 4 ngày |
| U2 | C2.3 tab Cán bộ chụp + Thiết bị chỉ xem + badge trạng thái ở C2.1 | members API | 2 ngày |
| U3 | S1 + S2 + S3 + máy trạng thái `App.tsx` (desktop, web) | SSO cho user, `/v1/me/campaigns`, self-enroll | 4 ngày |
| U4 | S7 Cài đặt thiết bị 4 phần + `RoundPlanSummary` | bộ quy đổi (3b) | 3 ngày |
| U5 | S5 ba vùng + S4/S6 bổ sung + S8/S9 chỉnh | bộ quy đổi, students API | 5 ngày |
| U6 | C1/C2.3 thống kê Tự động/Thủ công, C4 cột mới, drawer ảnh thẻ | stats byTrigger, CARD_PHOTO | 2 ngày |
| U7 | Kiểm thử theo mục 5 trên máy 2 camera + màn hình thứ hai thật | — | 2 ngày |

Tổng ~22 ngày công UI, chạy song song với backend theo giai đoạn 1–5 của
tài liệu thảo luận. Không commit cho tới khi lượt test tay từng bước
được xác nhận (quy tắc dự án).

---

## 8. Câu hỏi còn mở riêng về giao diện

| # | Câu hỏi | Đề xuất |
|---|---|---|
| U-Q1 | Kiosk là màn cảm ứng hay chuột/bàn phím? Độ phân giải chuẩn (1920×1080 ngang?) | **ĐÃ CHỐT 2026-09-08: 1920×1080 ngang**; thiết kế chạm được, chuột vẫn dùng |
| U-Q2 | Kiosk giữ theme tối hiện nay hay chuyển sáng như CMS? | Chưa hỏi riêng — tài liệu này **tạm áp dụng** giữ tối (nguyên tắc 6); đổi nếu product owner muốn |
| U-Q3 | SV có nhìn màn hình kiosk không (self-service) hay chỉ cán bộ nhìn, SV nhìn màn hình mở rộng? | **ĐÃ CHỐT 2026-09-08: cán bộ nhìn kiosk, SV nhìn màn hình mở rộng** → S5 tối ưu cho cán bộ, S8 tối ưu cho SV (chữ to, ít thông tin, hướng dẫn tư thế lớn) |
| U-Q4 | Có cần ảnh chân dung cũ của SV (từ hệ Admin) hiện ở vùng trái để đối chiếu không? | Có, khi API tra cứu thật có ảnh; để chỗ sẵn |
| U-Q5 | Danh sách "Đã chụp" mặc định hiện toàn campaign hay máy này? | Toàn campaign, có nút lọc "Máy này" |
| U-Q6 | Có cần chế độ "một cán bộ, nhiều campaign cùng lúc" (đổi campaign nhanh không thoát)? | Không; đổi campaign đi qua S2 |
| U-Q7 | Màn hình mở rộng (SV nhìn): có lật gương **riêng phần preview live** để SV tự chỉnh tư thế tự nhiên hơn không? Ảnh chụp vẫn không lật | Có, chỉ preview live trên S8; ghi rõ vào ROADMAP để không mâu thuẫn với quyết định "never mirror" |
| U-Q8 | Có hiện nội dung **đồng ý thu thập dữ liệu** (`consent_content` đã có trong campaign nhưng chưa nơi nào hiển thị) cho SV trên S8 trước khi chụp không? Ai bấm đồng ý — SV hay cán bộ? | Hiện trên S8 dạng toàn màn, cán bộ bấm "SV đã đồng ý" trên S5; ghi `consent_version` vào phiên |
