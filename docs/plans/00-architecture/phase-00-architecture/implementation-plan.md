# Implementation Plan — Phase 0: Architecture Foundation

Thiết lập nền tảng kiến trúc Monorepo, định nghĩa toàn bộ domain types, interfaces, service contracts và mock implementations để chuẩn bị cho phát triển song song các package trong các phase tiếp theo.

## User Review Required

> [!IMPORTANT]
> - **Package Manager**: Sử dụng `pnpm` workspace kết hợp với `Turborepo` để quản lý monorepo theo đúng thiết kế kiến trúc.
> - **Build System**: TypeScript project references + Turborepo pipeline cho build, lint, và test.
> - **Mock CV Engine**: Bao gồm `MockCVEngine` ngay trong Phase 0 để cho phép lập trình viên và AI Agent test workflow & state machine độc lập mà không cần camera vật lý.

## Open Questions

Không có câu hỏi mở cho Phase 0. Kiến trúc đã được thống nhất trong [face_platform_architecture_deep_dive.md](file:///Users/skyline/PROJECTS/face-capture/face_platform_architecture_deep_dive.md).

## Proposed Changes

### Workspace Root Configuration

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/package.json)
- Khởi tạo root package.json với pnpm workspaces và scripts chính (`build`, `dev`, `test`, `lint`).

#### [NEW] [pnpm-workspace.yaml](file:///Users/skyline/PROJECTS/face-capture/pnpm-workspace.yaml)
- Khai báo workspace sub-directories (`packages/*`, `apps/*`).

#### [NEW] [turbo.json](file:///Users/skyline/PROJECTS/face-capture/turbo.json)
- Cấu hình pipeline xây dựng, cache và mối quan hệ phụ thuộc giữa các package tasks.

#### [NEW] [tsconfig.base.json](file:///Users/skyline/PROJECTS/face-capture/tsconfig.base.json)
- Cấu hình TypeScript chuẩn dùng chung cho tất cả packages trong monorepo (strict mode, ES2022 target, module resolution NodeNext/Bundler).

#### [NEW] [.gitignore](file:///Users/skyline/PROJECTS/face-capture/.gitignore)
- Bỏ qua `node_modules`, `dist`, `.turbo`, build outputs, temporary captures, log files.

---

### Package: `@face/core` (`packages/core`)

Nơi định nghĩa toàn bộ Domain Contracts, Enums, Interfaces, và Common Utilities.

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/core/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/core/tsconfig.json)
#### [NEW] [src/types/face.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/types/face.ts)
- `BoundingBox`, `FaceLandmark`, `FacePose` (Yaw/Pitch/Roll), `FaceQualityResult`, `FaceState`.
#### [NEW] [src/types/workflow.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/types/workflow.ts)
- `PoseTarget`, `QualityRequirement`, `CaptureStep`, `CaptureWorkflow`, `GuidanceState`, `CaptureSession`, `StepResult`.
#### [NEW] [src/types/biometric.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/types/biometric.ts)
- `FaceEmbedding`, `FaceProfile`, `RecognitionCandidate`, `RecognitionResult`, `LivenessResult`, `AttendanceResult`.
#### [NEW] [src/interfaces/cv.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/cv.ts)
- `CVEngine`, `FaceDetector`, `FaceEmbedder`, `LivenessDetector`.
#### [NEW] [src/interfaces/camera.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/camera.ts)
- `CameraService`, `CameraDevice`, `FrameInput`.
#### [NEW] [src/interfaces/workflow.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/workflow.ts)
- `WorkflowEngine`, `StepEvaluator`, `StabilityTracker`, `CaptureController`, `GuidanceEngine`.
#### [NEW] [src/interfaces/storage.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/storage.ts)
- `StorageAdapter`, `ModelLoader`.
#### [NEW] [src/errors/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/errors/index.ts)
- `FacePlatformError`, typed error codes (`CAMERA_UNAVAILABLE`, `FACE_NOT_FOUND`, `MULTIPLE_FACES`, `QUALITY_FAILED`, etc.).
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/index.ts)
- Central export cho `@face/core`.

---

### Package: `@face/cv-engine` (`packages/cv-engine`)

Abstraction layer cho Computer Vision và Mock implementation.

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/tsconfig.json)
#### [NEW] [src/MockCVEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/MockCVEngine.ts)
- Triển khai `CVEngine` giả lập cho testing & simulation (cho phép inject hoặc set pose/quality động qua slider/mock data).
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/index.ts)

---

### Package: `@face/ui` (`packages/ui`)

Shared Component Library & Design System configuration.

#### [NEW] [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/ui/package.json)
#### [NEW] [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/ui/tsconfig.json)
#### [NEW] [tailwind.config.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/tailwind.config.ts)
- Semantic color tokens (`--face-primary`, `--face-guide`, `--face-overlay`, `--face-error`), custom animations (`face-pulse`, `capture-flash`).
#### [NEW] [src/lib/utils.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/lib/utils.ts)
- `cn()` utility (`clsx` + `tailwind-merge`).
#### [NEW] [src/styles/globals.css](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/styles/globals.css)
- Tailwind base imports và CSS variables cho light/dark theme.
#### [NEW] [src/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/index.ts)

---

## Verification Plan

### Automated Tests
- Kiểm tra TypeScript compilation thành công trên toàn bộ workspace:
  ```bash
  pnpm build
  ```
- Kiểm tra import/export thành công giữa các package (`@face/core`, `@face/cv-engine`, `@face/ui`):
  ```bash
  pnpm test
  ```

### Manual Verification
- Kiểm tra `MockCVEngine` khởi tạo thành công và trả về `FaceState` hợp lệ theo hợp đồng type.
