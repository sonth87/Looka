# Implementation Plan — Phase 6: Embedding & Profile

Xây dựng package sinh và quản lý đặc trưng sinh trắc học khuôn mặt `@face/biometric` (`packages/biometric`), thực hiện trích xuất vector embedding 512 chiều, chuẩn hóa L2, tính độ tương đồng Cosine Similarity, và tổng hợp hồ sơ sinh trắc học `FaceProfile` từ nhiều mẫu góc chụp.

## User Review Required

> [!IMPORTANT]
> - **Modular Biometric Layer**: Thư viện `@face/biometric` tách riêng độc lập, chịu trách nhiệm tính toán vector embedding 512-d và so khớp khoảng cách sinh trắc học.
> - **L2 Normalization & Cosine Distance**: Tất cả vector đặc trưng đều được chuẩn hóa L2 về độ dài bằng 1 ($||v||_2 = 1.0$), cho phép so sánh độ tương đồng bằng phép tích vô hướng Dot Product cực nhanh ($S = \vec{u} \cdot \vec{v}$).
> - **Multi-Pose Aggregate Profile**: `ProfileBuilder` tạo hồ sơ sinh trắc học tổng hợp từ danh sách mẫu chụp đa góc (`FRONT`, `LEFT`, `RIGHT`, `UP`, `DOWN`) kèm điểm trọng số chất lượng.

## Open Questions

Không có câu hỏi mở cho Phase 6.

## Proposed Changes

### Package: `@face/biometric` (`packages/biometric`)

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/tsconfig.json)

#### [NEW] [src/vectorMath.ts](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/src/vectorMath.ts)
- Hàm toán học chuẩn hóa L2 vector (`l2Normalize`), tính khoảng cách Euclidean (`euclideanDistance`), và độ tương đồng Cosine (`cosineSimilarity`).

#### [NEW] [src/MockEmbeddingExtractor.ts](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/src/MockEmbeddingExtractor.ts)
- Generator sinh vector embedding 512 chiều deterministic dựa trên ID/Seed mẫu ảnh để thử nghiệm không phụ thuộc trọng số model heavy AI.

#### [NEW] [src/ProfileBuilder.ts](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/src/ProfileBuilder.ts)
- Đóng gói logic tổng hợp `FaceProfile` từ danh sách `CaptureStepResult`: lọc mẫu đạt chuẩn chất lượng, gán trọng số ưu tiên góc chính diện (FRONT), tính centroid vector chuẩn hóa và đóng gói DTO `FaceProfile`.

#### [NEW] [src/__tests__/Biometric.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/src/__tests__/Biometric.test.ts)
- Unit test suite kiểm tra phép toán L2 Normalization, Cosine Similarity, và quy trình tổng hợp Profile từ 5 góc chụp.

#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/biometric/src/index.ts)

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript build toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Chạy unit tests cho `@face/biometric`:
  ```bash
  pnpm test
  ```

### Manual Verification
- Kiểm tra tính toán `cosineSimilarity` giữa 2 vector trùng hợp trả về `1.0`, 2 vector vuông góc trả về `0.0`.
