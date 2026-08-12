# Phase 0: Architecture Foundation — Walkthrough

Đã hoàn thành khởi tạo kiến trúc Monorepo, thiết lập toàn bộ Domain Types & Contracts, Service Interfaces, Mock CV Engine cho testing/simulation, và UI Styling Foundation.

---

## Các Thay Đổi Đã Thực Hiện

### 1. Workspace Monorepo Root
- [package.json](file:///Users/skyline/PROJECTS/face-capture/package.json): Định nghĩa root workspace cho pnpm & Turborepo script.
- [pnpm-workspace.yaml](file:///Users/skyline/PROJECTS/face-capture/pnpm-workspace.yaml): Cấu hình pnpm monorepo workspace cho `packages/*` và `apps/*`.
- [turbo.json](file:///Users/skyline/PROJECTS/face-capture/turbo.json): Cấu hình Turborepo task pipelines cho build, test, lint, dev, clean.
- [tsconfig.base.json](file:///Users/skyline/PROJECTS/face-capture/tsconfig.base.json): Base TypeScript configuration dùng chung (strict mode, ES2022, NodeNext resolution).
- [.gitignore](file:///Users/skyline/PROJECTS/face-capture/.gitignore): Ignores build output, node_modules, .turbo, logs, SQLite databases.

### 2. Package `@face/core` (`packages/core`)
- [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/core/package.json) & [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/core/tsconfig.json)
- **Domain Types**:
  - [face.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/types/face.ts): `BoundingBox`, `FaceLandmark`, `FacePose` (Yaw/Pitch/Roll), `FaceQualityResult`, `FaceDetection`, `FaceState`.
  - [workflow.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/types/workflow.ts): `PoseTarget`, `QualityRequirement`, `CaptureStep`, `CaptureWorkflow`, `GuidanceState`, `CaptureSession`, `StepResult`.
  - [biometric.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/types/biometric.ts): `FaceEmbedding`, `FaceProfile`, `Person`, `RecognitionResult`, `LivenessResult`, `AttendanceResult`.
- **Service Interfaces**:
  - [cv.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/cv.ts): `CVEngine`, `FaceDetector`, `FaceEmbedder`, `LivenessDetector`.
  - [camera.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/camera.ts): `CameraService`, `CameraDevice`, `CameraConstraints`.
  - [workflow.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/workflow.ts): `WorkflowEngine`, `StepEvaluator`, `StabilityTracker`, `GuidanceEngine`, `CaptureController`.
  - [storage.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/interfaces/storage.ts): `StorageAdapter`, `ModelLoader`.
- **Errors**:
  - [errors/index.ts](file:///Users/skyline/PROJECTS/face-capture/packages/core/src/errors/index.ts): `FacePlatformError` custom error class và catalog mã lỗi theo category (`CAMERA`, `CV_ENGINE`, `WORKFLOW`, `BIOMETRIC`, `DATABASE`,...).

### 3. Package `@face/cv-engine` (`packages/cv-engine`)
- [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/package.json) & [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/tsconfig.json)
- [MockCVEngine.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/MockCVEngine.ts): Mock implementation cho `CVEngine`, hỗ trợ inject custom pose/quality/detection settings cho unit tests và simulation mode không cần camera vật lý.
- [MockCVEngine.test.ts](file:///Users/skyline/PROJECTS/face-capture/packages/cv-engine/src/__tests__/MockCVEngine.test.ts): Unit test suite kiểm tra khởi tạo, xử lý frame và trạng thái `NO_FACE`.

### 4. Package `@face/ui` (`packages/ui`)
- [package.json](file:///Users/skyline/PROJECTS/face-capture/packages/ui/package.json) & [tsconfig.json](file:///Users/skyline/PROJECTS/face-capture/packages/ui/tsconfig.json)
- [tailwind.config.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/tailwind.config.ts): Design tokens & custom keyframes (`face-pulse`, `capture-flash`).
- [utils.ts](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/lib/utils.ts): `cn()` utility (`clsx` + `tailwind-merge`).
- [globals.css](file:///Users/skyline/PROJECTS/face-capture/packages/ui/src/styles/globals.css): CSS variables cho light/dark theme.

---

## Kế Quả Verification

1. **Build Verification**:
   ```bash
   pnpm build
   ```
   Output: `Tasks: 3 successful, 3 total` (cả `@face/core`, `@face/cv-engine`, `@face/ui` đều compile thành công không có lỗi TypeScript).

2. **Unit Test Verification**:
   ```bash
   pnpm test
   ```
   Output: `pass 2, fail 0` (`MockCVEngine` test suite hoàn tất 100%).
