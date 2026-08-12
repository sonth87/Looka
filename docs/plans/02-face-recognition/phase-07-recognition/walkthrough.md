# Phase 7: Recognition Engine — Walkthrough

Đã hoàn thành triển khai package engine nhận diện khuôn mặt `@face/recognition-engine` (`packages/recognition-engine`), hỗ trợ bài toán Xác thực 1:1 (`VerificationEngine`), Nhận dạng tự động 1:N (`IdentificationEngine`), bộ chính sách ngưỡng bảo mật `ThresholdPolicy`, và cơ chế cảnh báo kết quả nghi vấn `AMBIGUOUS`.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Package `@face/recognition-engine` (`packages/recognition-engine`)
- [ThresholdPolicy.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/ThresholdPolicy.ts):
  - Định nghĩa chính sách ngưỡng bảo mật:
    - `HIGH_SECURITY`: Ngưỡng match `>= 0.75` (Access Control nâng cao).
    - `BALANCED`: Ngưỡng match `>= 0.65` (Điểm danh chuẩn).
    - `CONVENIENCE`: Ngưỡng match `>= 0.55` (Gợi ý bối cảnh mở).
    - Ambiguity margin: `0.05` (nếu khoảng cách 2 ứng viên đầu nhỏ hơn 0.05 sẽ bị gắn cờ `AMBIGUOUS`).
- [VerificationEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/VerificationEngine.ts):
  - Bài toán 1:1 Verification: So sánh probe vector với profile mục tiêu, trả về `MATCH` hoặc `UNKNOWN` kèm điểm tương đồng Cosine Similarity.
- [IdentificationEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/IdentificationEngine.ts):
  - Bài toán 1:N Identification: Tìm kiếm so sánh probe vector trên toàn bộ danh sách Gallery `FaceProfile[]`, xếp hạng Top-K ứng viên và phân loại chính xác `MATCH`, `UNKNOWN`, hoặc `AMBIGUOUS`.
- [RecognitionEngine.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/__tests__/RecognitionEngine.test.ts):
  - Unit test suite kiểm tra bài toán 1:1, 1:N, xếp hạng Top-K ứng viên và cảnh báo điểm sát nhau AMBIGUOUS.
- Export trong `packages/recognition-engine/src/index.ts`.

---

## Kết Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 9 successful, 9 total` (tất cả 11 workspace packages compile 100% không lỗi).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 24, fail 0` (toàn bộ 24 unit tests thuộc tất cả các package đều passed).
