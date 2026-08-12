# Implementation Plan — Phase 7: Recognition Engine

Xây dựng package nhận diện khuôn mặt `@face/recognition-engine` (`packages/recognition-engine`), hỗ trợ bài toán Xác thực 1:1 (Verification) và Tự động nhận dạng 1:N (Identification), áp dụng các chính sách ngưỡng bảo mật Threshold Policy (`HIGH_SECURITY`, `BALANCED`, `CONVENIENCE`) và phân loại kết quả (`MATCH`, `UNKNOWN`, `AMBIGUOUS`).

## User Review Required

> [!IMPORTANT]
> - **1:1 Verification & 1:N Identification**: Hỗ trợ xác minh danh tính 1:1 (Xác nhận người dùng đúng là X) và nhận dạng 1:N (Tìm xem khuôn mặt thuộc về ai trong danh sách Gallery).
> - **Threshold Policies**:
>   - `HIGH_SECURITY`: Ngưỡng 0.75 (dùng cho cổng kiểm soát ra vào bảo mật cao).
>   - `BALANCED`: Ngưỡng 0.65 (dùng cho điểm danh thông thường).
>   - `CONVENIENCE`: Ngưỡng 0.55 (dùng cho gợi ý tìm kiếm bối cảnh mở).
> - **Ambiguity Protection**: Nếu khoảng cách giữa 2 ứng viên điểm cao nhất nhỏ hơn `0.05`, hệ thống đánh dấu trạng thái `AMBIGUOUS` để loại bỏ rủi ro nhận diện nhầm lẫn anh em sinh đôi hoặc người có nét mặt tương đồng.

## Open Questions

Không có câu hỏi mở cho Phase 7.

## Proposed Changes

### Package: `@face/recognition-engine` (`packages/recognition-engine`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/tsconfig.json)

#### [NEW] [src/ThresholdPolicy.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/ThresholdPolicy.ts)
- Quản lý các cấp độ ngưỡng `HIGH_SECURITY` (0.75), `BALANCED` (0.65), `CONVENIENCE` (0.55) và khoảng cách nghi vấn Ambiguity margin.

#### [NEW] [src/VerificationEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/VerificationEngine.ts)
- Thực hiện bài toán 1:1 Verification: So sánh probe vector với centroid/embeddings của `FaceProfile` mục tiêu, trả về `RecognitionResult` (`MATCH` / `UNKNOWN`).

#### [NEW] [src/IdentificationEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/IdentificationEngine.ts)
- Thực hiện bài toán 1:N Identification: So sánh probe vector với toàn bộ gallery `FaceProfile[]`, xếp hạng Top-K ứng viên và xác định trạng thái `MATCH`, `UNKNOWN`, hoặc `AMBIGUOUS`.

#### [NEW] [src/__tests__/RecognitionEngine.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/__tests__/RecognitionEngine.test.ts)
- Unit test suite kiểm thử 1:1 Verification, 1:N Identification, xếp hạng Top-K và phát hiện kết quả nghi vấn AMBIGUOUS.

#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/recognition-engine/src/index.ts)

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/recognition-engine`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Kiểm tra `IdentificationEngine` trả về `MATCH` với đúng `personId` khi probe vector sát với profile mẫu, và trả về `UNKNOWN` khi điểm số dưới ngưỡng threshold.
