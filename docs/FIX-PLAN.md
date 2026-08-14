# FIX PLAN — Looka Face Platform

> Danh sách sửa theo thứ tự. Làm từ trên xuống, **không nhảy nhóm**.
> Mỗi bước có: file cần sửa · việc cần làm · cách kiểm chứng.
> Nguồn: đối chiếu mã nguồn với `FACE_PLATFORM_MASTER_SPEC.md` ngày 13/08/2026.

**Tổng: 19 bước / ~20 man-day.**

| Nhóm | Nội dung | md | Khi nào |
|---|---|---:|---|
| [1](#nhóm-1--chặn-mọi-thứ-khác) | Dữ liệu không mất | 6 | Ngay, trước mọi việc khác |
| [2](#nhóm-2--trước-khi-có-dữ-liệu-thật) | Không làm bẩn DB | 5 | Trước khi nhập người thật |
| [3](#nhóm-3--trước-pilot) | Đúng nghiệp vụ | 9 | Trước pilot |
| [4](#nhóm-4--trước-khi-tin-số-độ-chính-xác) | Model thật | — | Trước khi công bố số |

---

## NHÓM 1 — Chặn mọi thứ khác

> Hiện tại **tắt app là mất sạch dữ liệu**, và hệ thống vẫn báo thành công.
> Không sửa xong nhóm này thì mọi việc khác đều vô nghĩa.

### Bước 1 — Persistence thật ✅ ĐÃ LÀM

**Vấn đề:** `new SQL.Database()` tạo DB trong RAM. Không có `db.export()` ở đâu cả → tắt app là mất hết.

**Đã làm — khác đề xuất ban đầu.** Kế hoạch cũ là `better-sqlite3`, nhưng nó cần biên dịch native
(node-gyp + VC++ Build Tools) mà máy build không phải lúc nào cũng có. Thay bằng **`node:sqlite`**,
builtin của Node, không cần biên dịch gì:

```
packages/database/src/sql/SqlDriver.ts        interface — không khoá vào một implementation
packages/database/src/sql/NodeSqliteDriver.ts node:sqlite, WAL, savepoint cho nested transaction
packages/database/src/PersistentStorageAdapter.ts  file thật trong userData
packages/database/src/migrations/             runner + 3 migration
```

Yêu cầu runtime: **Node ≥ 22.5**, nên đã nâng **Electron 34 → 37** (Node 22.21).
Đã đo thực tế trong Electron runtime: `node:sqlite` chạy được, transaction đúng.

`better-sqlite3` vẫn cắm được bất cứ lúc nào — chỉ là một implementation `SqlDriver` mới,
không đụng tầng trên.

**Kiểm chứng:** ✅ tự động — `packages/database/src/__tests__/Persistence.test.ts`
```
[x] Ghi → đóng → mở lại → dữ liệu vẫn còn
[x] File .db tồn tại trên đĩa
[x] Migration chạy lại là no-op
```

---

### Bước 2 — Bỏ CDN, đóng gói WASM (0.5 md)

**Vấn đề:** `locateFile: (file) => 'https://sql.js.org/dist/' + file` — sản phẩm "offline-first bắt buộc" mà tải engine DB từ Internet.

**File:** `packages/database/src/SQLiteStorageAdapter.ts:15`

```
1. Copy sql-wasm.wasm vào public/ của apps/web
2. locateFile: (file) => `/wasm/${file}`
3. Sau bước 1, apps/desktop không dùng sql.js nữa nên không ảnh hưởng
```

**Kiểm chứng:**
```
[ ] Ngắt mạng → mở apps/web → DB vẫn khởi tạo được
[ ] DevTools Network: không có request nào ra sql.js.org
```

---

### Bước 3 — Bỏ chế độ im lặng no-op (1 md)

**Vấn đề:** `catch { this.db = null }` rồi `run()` → `if (!this.db) return;`.
Chấm công báo **SUCCESS** trong khi không ghi gì.

**File:** `packages/database/src/SQLiteStorageAdapter.ts:10-24, 77-92`

```
1. initialize() thất bại → THROW, không nuốt lỗi
2. Xoá toàn bộ nhánh `if (!this.db) return` / `return []`
   → thay bằng: if (!this.db) throw new DatabaseNotReadyError()
3. Xoá memoryStore fallback (nó tạo ảo giác "vẫn chạy")
4. App bắt lỗi này → hiện màn hình lỗi cho admin, KHÔNG vào màn hình kiosk
```

**Kiểm chứng:**
```
[ ] Đổi dbPath thành đường dẫn không ghi được → app hiện màn hình lỗi rõ ràng
[ ] KHÔNG có trường hợp nào chấm công trả RECORDED khi DB chết
```

---

### Bước 4 — Transaction cho chấm công (1.5 md)

**Vấn đề:** `recordAttendance()` chạy 2 INSERT rời rạc, không có `BEGIN`/`COMMIT` nào trong toàn repo.
Chết giữa 2 lệnh → bản ghi chấm công không bao giờ lên server.

**File:** `packages/database/src/repositories/AttendanceRepository.ts:21-53`

```
1. Thêm adapter.transaction(fn) — better-sqlite3 có db.transaction() chạy đồng bộ
2. Bọc CẢ HAI insert:
     this.adapter.transaction(() => {
       insert attendance_records
       insert sync_queue
     })()
3. recordAttendance chuyển thành đồng bộ (better-sqlite3 vốn đồng bộ)
```

**Kiểm chứng:**
```
[ ] Cố tình cho INSERT sync_queue lỗi → attendance_records cũng KHÔNG có dòng nào
[ ] SELECT COUNT(*) attendance_records == SELECT COUNT(*) sync_queue (entity=ATTENDANCE)
```

---

### Bước 5 — `getStatus` phải kiểm tra thật (1 md)

**Vấn đề:** `ipcMain.handle('app:getStatus', () => ({ status:'ONLINE', dbConnected: true }))` — trả cứng.
Cộng với bước 3, admin thấy "DB OK" trong khi không có gì được ghi.

**File:** `apps/desktop/src/main/index.ts:31`

```
1. dbConnected = chạy thật SELECT 1 và bắt lỗi
2. Thêm: dbPath, dbSizeBytes, pendingSyncCount, lastWriteAt
3. Thêm aiServiceReachable (ping /api/v1/health, có timeout)
```

**Kiểm chứng:**
```
[ ] Tắt DB → getStatus trả dbConnected: false
[ ] Tắt python service → aiServiceReachable: false
```

---

## NHÓM 2 — Trước khi có dữ liệu thật

> Nhóm này chặn việc **làm bẩn database vĩnh viễn**.
> Một buổi demo với model mock có thể để lại dữ liệu rác không lọc ra được.

### Bước 6 — Đổi tên model mock (0.5 md)

**Vấn đề:** `extractor.py` khai `model_family = "ArcFace-Python"`, `model_version = "v1.0.0"` —
nhưng embedding là `sin(sum(ord(c)))` của chuỗi base64, không liên quan gì đến khuôn mặt.
Sau này cắm model thật sẽ **không phân biệt được bản ghi nào là giả**.

**File:** `services/python-ai/src/models/extractor.py:8-9`

```python
self.model_family  = "MOCK"          # KHÔNG BAO GIỜ để chữ "ArcFace" trên model giả
self.model_version = "mock-v0"
self.liveness_version = "mock-v0"
```

**Kiểm chứng:**
```
[ ] DELETE FROM face_embeddings WHERE model_family = 'MOCK'  → chạy được, lọc đúng
[ ] Không còn chuỗi "ArcFace" nào trong code mock (grep)
```

---

### Bước 7 — Chặn kích hoạt profile tạo bởi model MOCK (0.5 md)

**File:** `packages/biometric/src/ProfileBuilder.ts`

```
if (modelFamily === 'MOCK') {
  status = 'DRAFT';          // không bao giờ ACTIVE
}
```

**Kiểm chứng:**
```
[ ] Đăng ký bằng mock → profile ở DRAFT → KHÔNG vào recognition index
```

---

### Bước 8 — Ép tương thích version khi so vector (2 md)

**Vấn đề:** `identify()` so probe với **mọi** entry bất kể model, rồi báo `modelVersion` của
entry đầu tiên trong gallery. Gallery trộn 2 model → kết quả rác, im lặng.

**File:** `packages/recognition-engine/src/IdentificationEngine.ts:11-31, 50`

```
1. identify() nhận thêm tham số:
     requiredModel: { family, version, preprocessingVersion }
2. Lọc gallery TRƯỚC vòng lặp:
     const compatible = gallery.filter(e =>
       e.profile.modelFamily === requiredModel.family &&
       e.profile.modelVersion === requiredModel.version &&
       e.profile.preprocessingVersion === requiredModel.preprocessingVersion)
3. Nếu bị loại bớt → log cảnh báo kèm số lượng (KHÔNG im lặng)
4. Nếu compatible.length === 0 → UNKNOWN + lý do rõ ràng
5. modelVersion trong kết quả lấy từ requiredModel, KHÔNG lấy gallery[0]
```

**Kiểm chứng:**
```
[ ] Unit test: gallery có 2 model khác nhau → chỉ so với model khớp, có log cảnh báo
[ ] Unit test: gallery toàn model khác → trả UNKNOWN, không crash
```

---

### Bước 9 — Index + ràng buộc chống trùng (1 md)

**Vấn đề:** DDL 11 bảng, **0 `CREATE INDEX`**. `getLastAttendance` quét toàn bảng.
Không có unique → 2 frame xử lý song song cùng qua cooldown rồi cùng INSERT.

**File:** `packages/database/src/schema.ts`

```sql
CREATE INDEX IF NOT EXISTS idx_att_person_time  ON attendance_records(person_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_att_sync         ON attendance_records(sync_status);
CREATE INDEX IF NOT EXISTS idx_sync_ready       ON sync_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_emb_profile      ON face_embeddings(face_profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_person   ON face_profiles(person_id, status);

-- Chống trùng ở TẦNG DB, không chỉ ở tầng ứng dụng
ALTER TABLE attendance_records ADD COLUMN business_day TEXT;   -- 'YYYY-MM-DD'
CREATE UNIQUE INDEX IF NOT EXISTS uq_att_once
  ON attendance_records(person_id, type, business_day);
```

**Kiểm chứng:**
```
[ ] Gọi processRecognition() 10 lần song song cùng 1 person → đúng 1 dòng trong DB
[ ] EXPLAIN QUERY PLAN cho getLastAttendance → dùng index, không SCAN
```

---

### Bước 10 — Migration runner (1 md)

**Vấn đề:** chỉ có `CREATE TABLE IF NOT EXISTS`. Thêm cột về sau không có đường đi.

**File:** `packages/database/src/` (file mới `migrations/`)

```
1. Bảng schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER)
2. migrations/001-init.sql, 002-add-indexes.sql, ...
3. Lúc khởi động: đọc version hiện tại → chạy tuần tự các migration còn thiếu
4. Mỗi migration chạy trong 1 transaction
```

**Kiểm chứng:**
```
[ ] DB cũ (chưa có index) → khởi động app → tự lên version mới, dữ liệu còn nguyên
[ ] Chạy lại lần 2 → không làm gì, không lỗi
```

---

## NHÓM 3 — Trước pilot

### Bước 11 — Nối liveness vào luồng chấm công (2 md)

**Vấn đề:** endpoint `/api/v1/liveness` có nhưng **không ai gọi**.
`AttendanceService` hard-code `livenessScore: 1.0` → chống ảnh in hiện tại **bằng không**,
mà DB ghi 1.0 như thể đã kiểm.

**File:** `packages/attendance-engine/src/AttendanceService.ts:95`

```
1. processRecognition() nhận thêm livenessResult: LivenessResult | null
2. Nếu policy yêu cầu liveness mà chưa có/không đạt → REJECTED, KHÔNG ghi
3. Ghi score THẬT; không đo được thì ghi NULL, tuyệt đối không ghi số bịa
4. Đổi cột liveness_score sang nullable
```

**Kiểm chứng:**
```
[ ] Chụp ảnh in đưa vào camera → REJECTED (sau khi có model liveness thật ở bước 17)
[ ] Không có bản ghi nào có liveness_score = 1.0 mà chưa từng gọi API liveness
```

---

### Bước 12 — Truyền `qualityScore` thật (0.5 md)

**File:** `packages/attendance-engine/src/AttendanceService.ts:96`

```
Bỏ hard-code 0.9 → nhận từ QualityEvaluator của frame đã dùng để nhận diện.
```

---

### Bước 13 — Không lộ ứng viên khi UNKNOWN / AMBIGUOUS (1 md)

**Vấn đề:** `IdentificationEngine` trả `personId` + `candidates` cả khi `AMBIGUOUS`.
Spec §29 cấm — đứng trước camera đủ lâu là dò được hệ thống có những ai.

**File:** `packages/recognition-engine/src/IdentificationEngine.ts:59-67`

```
1. Kết quả trả ra NGOÀI service: AMBIGUOUS/UNKNOWN → KHÔNG có personId, KHÔNG có candidates
2. Giữ candidates trong một trường riêng chỉ dùng để GHI DB phục vụ phúc tra
   (ví dụ result.audit.candidates), tầng UI không được đọc trường này
3. UI chỉ hiện: "Không nhận diện được"
```

**Kiểm chứng:**
```
[ ] Unit test: status AMBIGUOUS → payload trả về UI không chứa personId
[ ] Grep renderer: không nơi nào render candidates
```

---

### Bước 14 — Temporal policy M-of-N (2 md)

**Vấn đề:** grep `temporal|consecutive|M_OF_N|votes` = **0 kết quả**.
Một frame duy nhất quyết định danh tính rồi ghi chấm công.

**File mới:** `packages/recognition-engine/src/TemporalConfirmer.ts`

```
1. Cửa sổ N=5 frame gần nhất, cần M=3 frame cùng personId mới chốt
2. identityLockMs = 3000: giữ danh tính 3s sau khi chốt
3. Mặt biến mất → HUỶ KHOÁ NGAY (nếu không, người sau bị chấm thành người trước)
4. AttendanceService chỉ nhận personId ĐÃ QUA TemporalConfirmer
```

**Kiểm chứng:**
```
[ ] Unit test: 2/5 frame khớp → chưa chốt; 3/5 → chốt
[ ] Unit test: mất mặt → khoá danh tính bị huỷ ngay frame kế tiếp
```

---

### Bước 15 — Ngưỡng ra file cấu hình có version (1.5 md)

**Vấn đề:** `ThresholdPolicy` trả cứng 0.75/0.65/0.55, margin 0.05.
`policyVersion` ghi vào DB là chuỗi `'BALANCED'` — đó là **tên mức**, không phải version.

**File:** `packages/recognition-engine/src/ThresholdPolicy.ts`

```
1. Đọc từ app_settings hoặc file config có: id, version, matchThreshold,
   ambiguityMargin, measuredFar, measuredFrr, measuredAt, sampleSize
2. attendance_records.policy_version ghi ID + version thật của profile ngưỡng
3. Đổi ngưỡng phải ghi audit_events
```

**Kiểm chứng:**
```
[ ] Đổi ngưỡng qua config → không cần build lại
[ ] Mỗi attendance_record truy được về đúng bộ ngưỡng đã dùng
```

---

### Bước 16 — Luật nghiệp vụ chấm công (1.5 md)

**File:** `packages/attendance-engine/src/AttendanceService.ts`

```
1. Kiểm person.status === 'ACTIVE' trước khi ghi
2. Cooldown tách theo type: CHECK_IN và CHECK_OUT đếm riêng
3. Ngày công: businessDayStartHour = 4 (ca đêm kết thúc 2h sáng thuộc ngày HÔM TRƯỚC)
   business_day = format(timestamp - 4h, 'YYYY-MM-DD')
4. Timezone khai tường minh: Asia/Ho_Chi_Minh
```

**Kiểm chứng:**
```
[ ] Person INACTIVE → REJECTED
[ ] Chấm lúc 01:30 ngày 15 → business_day = '2026-08-14'
```

---

### Bước 17 — Lọc tên file khi export (0.5 md)

**Vấn đề:** `filename = ${i+1}_${item.stepId}.png` — `stepId` từ renderer không lọc.
`stepId = "../../../evil"` thoát khỏi thư mục export.

**File:** `apps/desktop/src/main/index.ts:56`

```
const safe = String(item.stepId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
const filename = `${i + 1}_${safe}.png`;
```

**Kiểm chứng:**
```
[ ] stepId = "../../../evil" → file nằm ĐÚNG trong thư mục export
```

---

## NHÓM 4 — Trước khi tin số độ chính xác

### Bước 18 — Thay mock bằng model thật

```
1. KIỂM TRA GIẤY PHÉP THƯƠNG MẠI TRƯỚC (nhiều model FR mã nguồn mở chỉ cho phi thương mại)
2. InsightFace buffalo_l (ArcFace R100, 512-d, cosine) qua ONNX
3. Cập nhật FrModel: family/version/dim/metric + checksum file model
4. Xoá toàn bộ embedding model_family='MOCK' trước khi bật model thật
```

---

### Bước 19 — `PreprocessingSpec` + golden test vector

**Vấn đề:** hiện có **3 nơi** có thể sinh embedding — Python service, `MockEmbeddingExtractor` (TS),
và tương lai kiosk enroll. Ba nơi = ba cơ hội lệch tiền xử lý.
Lệch tiền xử lý → embedding lệch → **nhận diện kém đi mà không có lỗi nào báo ra**.

```
1. Định nghĩa PreprocessingSpec có version: cropSize, landmarkTemplate,
   interpolation, colorOrder, normalization mean/std, paddingMode
2. testdata/golden/: 20 ảnh cố định + mảng pixel sau align + embedding kỳ vọng
3. Test chạy cho MỌI implementation:
     maxAbsDiff(pixel) <= 1  và  cosine(embedding, expected) > 0.9999
4. Golden test FAIL thì CHẶN MERGE
5. Mọi truy vấn vector lọc CẢ modelVersion LẪN preprocessingVersion (bước 8)
```

**Quyết định kiến trúc cần chốt:** nên bỏ Python sidecar, chạy `onnxruntime-node` thẳng trong
Electron main — một ngôn ngữ, một pipeline tiền xử lý, không có ranh giới HTTP cho ảnh đi qua.
Nếu giữ Python thì **align phải làm đúng một nơi**, bên kia chỉ nhận tensor đã chuẩn hoá.

---

### Bước 20 — Benchmark trước khi công bố bất kỳ con số nào

```
[ ] ≥200 người, mỗi người ≥2 lần chụp cách nhau ≥1 tuần
[ ] Có nhóm khó: đeo kính ≥15%, đổi kiểu tóc, có/không trang điểm
[ ] Tính ROC → chọn ngưỡng theo nghiệp vụ (chấm công ưu tiên FRR thấp)
[ ] ĐO CHÊNH LỆCH FRR GIỮA CÁC NHÓM NHÂN KHẨU — ngưỡng chấp nhận ≤ 2 lần
[ ] Ghi toàn bộ vào FrModel.benchmark
```

---

## Ghi chú về quy trình

Bản audit `pillars-a-and-b-audit.md` kết luận **"ĐẠT 100%"** ở ba mục mà code không làm:
offline (WASM từ CDN), versioned (lưu nhưng không ép), transaction (không có).

Đây là điểm mù bình thường khi tự kiểm tra việc của mình. Cách chặn:
**tiêu chí nghiệm thu phải là test chạy được, không phải bảng đánh dấu.**

```
❌ "Offline-first: ĐẠT 100%"
✅ "Ngắt mạng → chấm công → tắt app → mở lại → bản ghi vẫn còn"     ← chạy được, không cãi được
```

Mọi ô `[ ]` trong tài liệu này viết theo kiểu thứ hai. Không đánh dấu xong nếu chưa chạy thật.

---

*Chi tiết phân tích đầy đủ: `../../docs/KE-HOACH-DU-AN.md` PHẦN XII.*
