<#
.SYNOPSIS
  Tự động hoá phần "chỉ là gõ lệnh" của Bước 0/6 trong
  docs/plans/canon-tethered-capture-plan-2026-09-21.md: cài gphoto2 qua
  MSYS2, tìm DLL phụ thuộc, copy toàn bộ (gồm cả thư mục plugin camera
  camlibs/iolibs) vào apps/desktop/resources/gphoto2-win/ — đúng chỗ
  tetheredCamera.ts's gphoto2BinaryPath() đã tìm sẵn cho cả dev lẫn bản
  đóng gói.

.DESCRIPTION
  KHÔNG làm (không làm được, không nên làm):
    - Cài MSYS2 — đó là một trình cài GUI người dùng tự chạy một lần, xem
      https://www.msys2.org/. Script này chỉ DÙNG một bản MSYS2 đã cài
      sẵn, không cài mới.
    - Cắm máy ảnh / chạy Zadig đổi driver WinUSB — cần thao tác tay trên
      phần cứng thật, xem lại hướng dẫn Bước 0 trong cuộc trò chuyện.
  Dừng lại rõ ràng (exit code khác 0) ở bất kỳ bước nào thất bại, kèm
  hướng dẫn cụ thể phải làm gì tiếp — không âm thầm bỏ qua lỗi.

  Dùng gói `ucrt64` (`mingw-w64-ucrt-x86_64-gphoto2`), KHÔNG phải
  `mingw64`/`mingw-w64-x86_64-gphoto2` — bản plan đầu đoán nhầm tên gói cũ;
  kiểm tra tay trên máy thật (2026-09-21) xác nhận `mingw64` không còn gói
  gphoto2 nữa, MSYS2 đã chuyển gói này sang repo `ucrt64` (toolchain UCRT
  được khuyến nghị thay cho `mingw64` cổ điển).

.EXAMPLE
  .\setup-gphoto2-windows.ps1
#>

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err2($msg) { Write-Host $msg -ForegroundColor Red }

$msys2Root = 'C:\msys64'
$bash = Join-Path $msys2Root 'usr\bin\bash.exe'
# Gọi bash.exe trực tiếp (không qua shortcut "MSYS2 UCRT64" của Start Menu)
# khởi động môi trường MSYS mặc định, PATH không có /ucrt64/bin — set
# MSYSTEM=UCRT64 trước khi gọi để login shell tự nạp đúng profile ucrt64,
# giống hệt cách shortcut chính thức làm bên trong.
$env:MSYSTEM = 'UCRT64'

Write-Step "Kiểm tra MSYS2"
if (-not (Test-Path $bash)) {
    Write-Err2 "Không tìm thấy MSYS2 ở $msys2Root (thiếu $bash)."
    Write-Warn2 "Cài MSYS2 trước: https://www.msys2.org/ (chạy trình cài, để mặc định cài vào $msys2Root), rồi chạy lại script này."
    exit 1
}
Write-Host "OK — thấy MSYS2 ở $msys2Root"

Write-Step "Cài gói mingw-w64-ucrt-x86_64-gphoto2 (+ libgphoto2) qua pacman"
& $bash -lc "pacman -Sy --noconfirm mingw-w64-ucrt-x86_64-gphoto2 mingw-w64-ucrt-x86_64-libgphoto2 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Err2 "pacman thất bại (exit $LASTEXITCODE)."
    Write-Warn2 "Nếu đây là lần đầu mở MSYS2: chạy tay 'pacman -Syu' trước (có thể phải chạy 2 lần — lần đầu MSYS2 tự đóng terminal giữa chừng để cập nhật runtime lõi, mở lại rồi chạy 'pacman -Syu' lần nữa), xong rồi chạy lại script này."
    exit 1
}

Write-Step "Tìm đường dẫn gphoto2.exe"
# KHÔNG dùng `which gphoto2` qua `bash -lc` — gọi bash.exe trực tiếp kiểu
# này khởi động môi trường "MSYS2 MSYS" (MSYSTEM=MSYS) mặc định, PATH của
# nó KHÔNG có /ucrt64/bin (chỉ có khi mở đúng cửa sổ Start Menu "MSYS2
# UCRT64", hoặc set MSYSTEM=UCRT64 trước khi gọi) — dù gói cài thành công
# thật, `which` vẫn báo không thấy. Kiểm tra thẳng đường dẫn cố định của
# gói ucrt64 đáng tin cậy hơn, không phụ thuộc PATH của shell con.
$gphotoExeWin = Join-Path $msys2Root 'ucrt64\bin\gphoto2.exe'
if (-not (Test-Path $gphotoExeWin)) {
    Write-Err2 "Không thấy file ở '$gphotoExeWin' dù pacman báo cài thành công — kiểm tra lại bước cài ở trên."
    exit 1
}
$gphotoExePosix = '/ucrt64/bin/gphoto2.exe'
Write-Host "gphoto2.exe: $gphotoExeWin"

Write-Step "Liệt kê DLL phụ thuộc (ldd) — chỉ lấy DLL nằm trong ucrt64, bỏ qua DLL hệ thống Windows"
$lddLines = & $bash -lc "ldd '$gphotoExePosix'" 2>$null
$dllWinPaths = @()
foreach ($line in $lddLines) {
    if ($line -match '=>\s+(/ucrt64/\S+\.dll)') {
        $posix = $matches[1]
        $win = Join-Path $msys2Root ($posix -replace '^/ucrt64/', 'ucrt64\').Replace('/', '\')
        if (Test-Path $win) { $dllWinPaths += $win }
    }
}
Write-Host "Tìm thấy $($dllWinPaths.Count) DLL trong ucrt64 (không tính DLL hệ thống Windows đã sẵn có)."

$destDir = Join-Path $PSScriptRoot '..\resources\gphoto2-win'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

Write-Step "Copy gphoto2.exe + DLL vào $destDir"
Copy-Item -Path $gphotoExeWin -Destination $destDir -Force
Write-Host "  gphoto2.exe"
foreach ($dll in $dllWinPaths) {
    Copy-Item -Path $dll -Destination $destDir -Force
    Write-Host "  $(Split-Path $dll -Leaf)"
}

Write-Step "Copy thư mục plugin camera (camlibs/iolibs) — cần để gphoto2.exe nhận diện được máy ảnh sau khi copy ra khỏi MSYS2"
$camlibsSrc = Join-Path $msys2Root 'ucrt64\lib\libgphoto2'
$iolibsSrc = Join-Path $msys2Root 'ucrt64\lib\libgphoto2_port'
if (Test-Path $camlibsSrc) {
    Copy-Item -Path $camlibsSrc -Destination (Join-Path $destDir 'libgphoto2') -Recurse -Force
    Write-Host "  libgphoto2\ (camera drivers)"
} else {
    Write-Warn2 "  KHÔNG thấy $camlibsSrc — gphoto2 --auto-detect có thể không nhận ra máy ảnh nào. Kiểm tra lại gói mingw-w64-ucrt-x86_64-libgphoto2 đã cài chưa."
}
if (Test-Path $iolibsSrc) {
    Copy-Item -Path $iolibsSrc -Destination (Join-Path $destDir 'libgphoto2_port') -Recurse -Force
    Write-Host "  libgphoto2_port\ (I/O transport, gồm cả USB)"
} else {
    Write-Warn2 "  KHÔNG thấy $iolibsSrc — tương tự, kiểm tra lại gói libgphoto2."
}

# `ldd gphoto2.exe` ở bước trên CHỈ thấy DLL gphoto2.exe tự link tĩnh lúc
# build (libgphoto2-6.dll, libgphoto2_port-12.dll, runtime chung...) —
# KHÔNG thấy DLL mà các plugin camlibs/iolibs tự dlopen() lúc CHẠY (ví dụ
# usb1.dll cần libusb-1.0.dll; ptp2.dll — plugin duy nhất nhận diện được
# Canon EOS qua PTP — cần libxml2-16.dll + libjpeg-8.dll + zlib1.dll bắc
# cầu qua libxml2). Thiếu các DLL này, plugin đó lặng lẽ load lỗi
# ("The specified module could not be found") và `--auto-detect` báo trống
# ngay cả khi máy ảnh thật đã cắm và driver WinUSB đã đúng — lỗi phát hiện
# ngày 2026-09-21 khi test thật với Canon EOS R6 Mark II, sau khi driver
# WinUSB (qua Zadig) đã đúng nhưng vẫn không nhận được máy do đúng lỗi này.
# Sửa: quét ldd cho TỪNG .dll vừa copy trong 2 thư mục plugin, gộp mọi DLL
# ucrt64 còn thiếu, copy thẳng vào cùng thư mục với gphoto2.exe (thứ tự tìm
# DLL mặc định của Windows luôn có thư mục chứa .exe).
Write-Step "Quét DLL phụ thuộc của TỪNG plugin camlibs/iolibs (lỗi thật đã gặp: ldd ở bước trên bỏ sót các DLL này)"
$pluginDlls = @()
foreach ($pluginDir in @((Join-Path $destDir 'libgphoto2'), (Join-Path $destDir 'libgphoto2_port'))) {
    if (Test-Path $pluginDir) {
        $pluginDlls += Get-ChildItem -Path $pluginDir -Filter '*.dll' -Recurse
    }
}
$haveNames = (Get-ChildItem -Path $destDir -Filter '*.dll').Name | ForEach-Object { $_.ToLower() }
$extraDlls = New-Object System.Collections.Generic.HashSet[string]
foreach ($dll in $pluginDlls) {
    $posixPath = '/ucrt64/' + ($dll.FullName.Substring($msys2Root.Length + 7) -replace '\\', '/')
    $lddOut = & $bash -lc "ldd '$posixPath' 2>/dev/null"
    foreach ($line in $lddOut) {
        if ($line -match '=>\s+(/ucrt64/\S+\.dll)') {
            $depWin = Join-Path $msys2Root (($matches[1] -replace '^/ucrt64/', 'ucrt64\').Replace('/', '\'))
            $depName = Split-Path $depWin -Leaf
            if ($haveNames -notcontains $depName.ToLower()) {
                [void]$extraDlls.Add($depWin)
            }
        }
    }
}
if ($extraDlls.Count -eq 0) {
    Write-Host "  Không thiếu DLL nào thêm."
} else {
    foreach ($depWin in $extraDlls) {
        if (Test-Path $depWin) {
            Copy-Item -Path $depWin -Destination $destDir -Force
            Write-Host "  $(Split-Path $depWin -Leaf) (phụ thuộc bắc cầu của plugin, ldd chính gphoto2.exe không thấy)"
        }
    }
}

Write-Host "`nXONG phần tự động hoá được." -ForegroundColor Green
Write-Host "Các bước còn lại BẮT BUỘC làm tay (script không thể làm thay):" -ForegroundColor Yellow
Write-Host "  1. Cắm máy ảnh Canon vào cổng USB-C của máy kiosk này."
Write-Host "  2. Nếu Windows chưa nhận đúng: tải Zadig (https://zadig.akeo.ie/), chọn đúng"
Write-Host "     thiết bị Canon trong danh sách, cài driver WinUSB (Replace Driver)."
Write-Host "  3. Test lại bằng chính file vừa copy:"
Write-Host "     & `"$destDir\gphoto2.exe`" --auto-detect" -ForegroundColor White
Write-Host "  4. Báo lại kết quả bước 3 — quan trọng nhất trong toàn bộ Bước 0."
