# Face Guided Capture — Product & Technical Specification

> **Document type:** Product Requirements + Technical Architecture + Implementation Plan
> **Target:** AI Coding Agent / AI Software Engineer
> **Platform:** Electron Desktop
> **Frontend:** React + TypeScript
> **Processing:** Offline / Local-first
> **Status:** Initial Architecture Specification
> **Version:** 1.0

---

# 1. Project Overview

## 1.1. Product

Xây dựng một ứng dụng desktop chạy bằng Electron, kết nối với camera/webcam và hướng dẫn người dùng thực hiện một chuỗi thao tác chụp ảnh khuôn mặt.

Ứng dụng không chỉ hiển thị camera mà phải có khả năng:

1. Phát hiện khuôn mặt.
2. Xác định vị trí khuôn mặt.
3. Phân tích facial landmarks.
4. Ước lượng hướng đầu:
   - Yaw
   - Pitch
   - Roll

5. Kiểm tra chất lượng khuôn mặt/ảnh.
6. Xác định người dùng đã đáp ứng yêu cầu của bước hiện tại hay chưa.
7. Hướng dẫn người dùng điều chỉnh tư thế theo thời gian thực.
8. Khi điều kiện đạt và ổn định đủ lâu, tự động chụp ảnh.
9. Chuyển sang bước tiếp theo.
10. Hoàn thành toàn bộ workflow.
11. Lưu ảnh và metadata kết quả.
12. Có khả năng chạy hoàn toàn offline.

Ví dụ workflow:

```text
START
  ↓
Prepare camera
  ↓
Detect face
  ↓
Nhìn thẳng
  ↓
Auto Capture
  ↓
Quay sang trái
  ↓
Auto Capture
  ↓
Quay sang phải
  ↓
Auto Capture
  ↓
Nhìn lên
  ↓
Auto Capture
  ↓
Nhìn xuống
  ↓
Auto Capture
  ↓
COMPLETE
```

---

# 2. Product Goal

Mục tiêu chính:

> Tạo ra một hệ thống "Guided Face Capture" có khả năng tự động hướng dẫn, kiểm tra và chụp ảnh khuôn mặt theo một workflow được định nghĩa trước.

Hệ thống phải ưu tiên:

- Offline
- Privacy
- Realtime
- Stable
- Deterministic
- Có thể cấu hình
- Có thể mở rộng
- Không phụ thuộc cloud AI trong MVP
- Không phụ thuộc Python runtime trong MVP
- Có thể thay đổi model CV sau này

---

# 3. Core Principle

Không xây hệ thống theo mô hình:

```text
Camera
 ↓
AI / LLM
 ↓
"AI nghĩ rằng mặt đang quay trái"
```

Thay vào đó:

```text
Camera
 ↓
Frame
 ↓
Face Detection
 ↓
Face Landmarks
 ↓
Head Pose
 ↓
Quality Assessment
 ↓
Deterministic Rule Engine
 ↓
Workflow Engine
 ↓
Guidance / Capture
```

LLM không phải thành phần bắt buộc của hệ thống.

Các quyết định quan trọng nên mang tính deterministic.

---

# 4. Scope

## 4.1. MVP

MVP phải hỗ trợ:

- Camera enumeration
- Camera selection
- Camera preview
- Permission handling
- Face detection
- Face landmarks
- Head pose
- Yaw
- Pitch
- Roll
- Face bounding box
- Face size
- Face position
- Blur detection
- Brightness detection
- Basic occlusion/visibility detection
- Pose validation
- Quality validation
- Stability detection
- Auto capture
- Workflow steps
- Step transition
- Retry
- Session
- Image capture
- Metadata
- Local storage
- UI feedback
- Error states
- Offline processing

---

# 5. Future Scope

Các tính năng sau không bắt buộc trong MVP nhưng architecture phải có khả năng mở rộng:

- Liveness detection
- Anti-spoofing
- Face recognition
- Face verification
- Multiple face handling nâng cao
- Custom workflow editor
- TTS guidance
- Voice instructions
- Advanced face quality model
- ONNX models
- GPU acceleration
- Image enhancement
- Camera calibration
- Lens distortion correction
- Session export
- Audit log
- Workflow versioning
- Remote configuration
- Enterprise policy
- Multi-camera workflow
- Barcode/QR integration
- Identity verification workflow

---

# 6. Non-Goals

MVP không cần:

- Cloud face recognition
- Upload camera frame lên server
- LLM phân tích từng frame
- Python server
- Python sidecar
- Remote inference
- Internet connection để nhận diện khuôn mặt
- Real-time backend
- Database server

Mục tiêu là local-first.

---

# 7. High-Level Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                       ELECTRON                          │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                    RENDERER                       │  │
│  │                                                   │  │
│  │  React UI                                         │  │
│  │      │                                            │  │
│  │      ├── Camera UI                                │  │
│  │      ├── Guidance UI                              │  │
│  │      ├── Face Overlay                             │  │
│  │      ├── Workflow Progress                        │  │
│  │      └── Result UI                                │  │
│  │                                                   │  │
│  │              ↓                                    │  │
│  │       Camera Service                              │  │
│  │              ↓                                    │  │
│  │       Video Frame Pipeline                        │  │
│  │              ↓                                    │  │
│  │         CV Engine                                 │  │
│  │              │                                    │  │
│  │       ┌──────┼─────────┐                          │  │
│  │       ↓      ↓         ↓                          │  │
│  │    Detect  Landmark  Quality                      │  │
│  │       │      │         │                          │  │
│  │       └──────┼─────────┘                          │  │
│  │              ↓                                    │  │
│  │          Head Pose                                │  │
│  │              ↓                                    │  │
│  │          FaceState                                │  │
│  │              ↓                                    │  │
│  │       Workflow Engine                             │  │
│  │          │          │                             │  │
│  │          ↓          ↓                             │  │
│  │      Guidance     Capture                         │  │
│  │                     │                             │  │
│  │                     ↓                             │  │
│  │                  Storage                          │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                      MAIN                         │  │
│  │                                                   │  │
│  │  Electron lifecycle                               │  │
│  │  IPC                                               │  │
│  │  File system                                       │  │
│  │  App storage                                       │  │
│  │  Native integrations                              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

# 8. Recommended Tech Stack

## 8.1. Desktop

```text
Electron
```

Responsibilities:

- Desktop lifecycle
- Window management
- Native filesystem
- App packaging
- Native permissions
- IPC
- Local resource management

---

# 9. Frontend

```text
React
TypeScript
```

React chỉ chịu trách nhiệm UI/state presentation.

Không đưa CV processing trực tiếp vào React render cycle.

---

# 10. Camera

Sử dụng:

```text
navigator.mediaDevices.getUserMedia()
```

Camera API:

```text
MediaDevices
MediaStream
HTMLVideoElement
Canvas / OffscreenCanvas
```

Camera không nên phụ thuộc Electron-specific native camera API nếu Web API đáp ứng đủ nhu cầu.

---

# 11. Computer Vision

## Primary MVP

Ưu tiên:

```text
MediaPipe Face Landmarker
```

Chạy local.

Model được bundle hoặc quản lý local.

Không yêu cầu Internet trong quá trình inference.

---

# 12. Future CV Runtime

Architecture phải abstraction để có thể thay bằng:

```text
ONNX Runtime
```

với các model:

```text
face-detector.onnx
face-landmark.onnx
face-quality.onnx
anti-spoof.onnx
```

Không để Workflow Engine phụ thuộc trực tiếp vào MediaPipe.

---

# 13. CV Abstraction

Không viết:

```ts
workflow -> MediaPipe API
```

Mà phải viết:

```text
CV Engine
    ↓
FaceState
    ↓
Workflow
```

Ví dụ:

```ts
interface CVEngine {
  initialize(): Promise<void>;

  processFrame(frame: VideoFrame | ImageBitmap): Promise<FaceState>;

  dispose(): Promise<void>;
}
```

MediaPipe implementation:

```ts
MediaPipeCVEngine;
```

ONNX implementation:

```ts
ONNXCVEngine;
```

Workflow không cần biết implementation nào đang chạy.

---

# 14. FaceState

Đây là contract quan trọng nhất giữa CV và Workflow.

```ts
interface FaceState {
  timestamp: number;

  detected: boolean;

  faceCount: number;

  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  center?: {
    x: number;
    y: number;
  };

  pose?: {
    yaw: number;
    pitch: number;
    roll: number;
  };

  quality?: {
    faceSize: number;
    brightness: number;
    sharpness: number;

    eyesVisible?: boolean;
    mouthVisible?: boolean;

    occluded?: boolean;
  };

  landmarks?: FaceLandmark[];

  confidence?: number;
}
```

Đây phải là domain contract.

---

# 15. Face Detection

Hệ thống cần xác định:

```text
Có khuôn mặt hay không?
```

Output:

```text
detected
faceCount
bbox
confidence
```

---

# 16. Multiple Face Handling

MVP nên hỗ trợ phát hiện nhiều mặt.

Nếu:

```text
faceCount === 0
```

→ yêu cầu người dùng đưa mặt vào camera.

Nếu:

```text
faceCount === 1
```

→ bình thường.

Nếu:

```text
faceCount > 1
```

→ mặc định:

```text
Không chụp
```

Thông báo:

```text
Vui lòng chỉ để một người trong khung hình.
```

Không được tự ý chọn một khuôn mặt nếu workflow yêu cầu một người.

---

# 17. Face Position

Khuôn mặt phải nằm trong vùng hợp lệ.

Ví dụ:

```text
┌─────────────────────────┐
│                         │
│      ┌───────────┐      │
│      │           │      │
│      │    FACE   │      │
│      │           │      │
│      └───────────┘      │
│                         │
└─────────────────────────┘
```

Các thông số:

```text
normalizedCenterX
normalizedCenterY
faceWidthRatio
faceHeightRatio
```

Không hard-code pixel.

---

# 18. Face Size

Sử dụng normalized ratio:

```text
faceWidth / frameWidth
```

Ví dụ:

```text
minFaceWidthRatio = 0.25
maxFaceWidthRatio = 0.70
```

Mục tiêu:

- Không quá xa
- Không quá gần

---

# 19. Head Pose

Ba thông số chính:

```text
yaw
pitch
roll
```

## Yaw

Quay trái/phải.

```text
-30° ← LEFT

  0° ← FRONT

+30° ← RIGHT
```

## Pitch

Ngẩng/cúi.

```text
+30° ← UP

  0° ← FRONT

-30° ← DOWN
```

## Roll

Nghiêng đầu.

```text
-15° ← tilt left

  0° ← straight

+15° ← tilt right
```

Convention phải được chuẩn hóa trong `PoseService`.

Không được để từng model sử dụng convention khác nhau.

---

# 20. Pose Target

Workflow không nên chỉ có:

```ts
yaw: 30;
```

mà nên có tolerance.

```ts
interface PoseTarget {
  yaw?: {
    target: number;
    tolerance: number;
  };

  pitch?: {
    target: number;
    tolerance: number;
  };

  roll?: {
    target: number;
    tolerance: number;
  };
}
```

Ví dụ:

```ts
{
  yaw: {
    target: 30,
    tolerance: 5
  },

  pitch: {
    target: 0,
    tolerance: 8
  },

  roll: {
    target: 0,
    tolerance: 5
  }
}
```

---

# 21. Pose Validation

Không chỉ kiểm tra:

```text
yaw đúng
```

Mà phải kiểm tra toàn bộ:

```text
Pose
+
Position
+
Face size
+
Quality
+
Stability
```

Ví dụ:

```text
READY =
  faceDetected
  AND exactlyOneFace
  AND positionValid
  AND faceSizeValid
  AND yawValid
  AND pitchValid
  AND rollValid
  AND brightnessValid
  AND sharpnessValid
  AND occlusionValid
  AND stable
```

---

# 22. Quality Engine

Quality Engine chịu trách nhiệm đánh giá frame.

Các nhóm chính:

```text
1. Face size
2. Face position
3. Brightness
4. Sharpness / blur
5. Occlusion
6. Eye visibility
7. Facial landmark quality
8. Optional image quality model
```

---

# 23. Blur Detection

MVP có thể sử dụng classical CV.

Ví dụ:

```text
Laplacian variance
```

Concept:

```text
sharpnessScore > threshold
```

Không nhất thiết cần AI model.

---

# 24. Brightness

Có thể tính:

```text
mean luminance
```

và kiểm tra:

```text
minBrightness
maxBrightness
```

Cần tránh:

- Quá tối
- Quá sáng
- Cháy vùng mặt

---

# 25. Stability Detection

Không được capture ngay khi một frame đúng.

Ví dụ:

```text
Frame 1 → correct
Frame 2 → correct
Frame 3 → correct
Frame 4 → correct
Frame 5 → correct
```

hoặc:

```text
correct condition
       ↓
stable >= 500ms
       ↓
capture
```

Có thể sử dụng:

```ts
stabilityDurationMs;
```

thay vì hard-code số frame.

---

# 26. Capture State Machine

Capture phải có state rõ ràng.

```text
IDLE
 ↓
EVALUATING
 ↓
READY
 ↓
STABILIZING
 ↓
COUNTDOWN
 ↓
CAPTURING
 ↓
VALIDATING
 ↓
SAVED
 ↓
NEXT_STEP
```

Có thể có:

```text
FAILED
RETRY
TIMEOUT
```

---

# 27. Workflow Engine

Workflow là danh sách các bước.

Ví dụ:

```ts
interface CaptureWorkflow {
  id: string;
  version: number;
  name: string;
  steps: CaptureStep[];
}
```

Step:

```ts
interface CaptureStep {
  id: string;

  instruction: string;

  pose?: PoseTarget;

  quality?: QualityRequirement;

  stability?: {
    durationMs: number;
  };

  countdown?: {
    enabled: boolean;
    durationMs: number;
  };

  capture: {
    enabled: boolean;
  };
}
```

---

# 28. Example Workflow

```ts
const workflow = {
  id: "face-enrollment",
  version: 1,

  steps: [
    {
      id: "front",

      instruction: "Nhìn thẳng vào camera",

      pose: {
        yaw: {
          target: 0,
          tolerance: 5,
        },

        pitch: {
          target: 0,
          tolerance: 5,
        },

        roll: {
          target: 0,
          tolerance: 5,
        },
      },

      stability: {
        durationMs: 500,
      },

      capture: {
        enabled: true,
      },
    },

    {
      id: "left",

      instruction: "Quay mặt sang trái",

      pose: {
        yaw: {
          target: -30,
          tolerance: 5,
        },

        pitch: {
          target: 0,
          tolerance: 8,
        },

        roll: {
          target: 0,
          tolerance: 5,
        },
      },

      stability: {
        durationMs: 500,
      },

      capture: {
        enabled: true,
      },
    },

    {
      id: "right",

      instruction: "Quay mặt sang phải",

      pose: {
        yaw: {
          target: 30,
          tolerance: 5,
        },

        pitch: {
          target: 0,
          tolerance: 8,
        },

        roll: {
          target: 0,
          tolerance: 5,
        },
      },

      stability: {
        durationMs: 500,
      },

      capture: {
        enabled: true,
      },
    },
  ],
};
```

---

# 29. Workflow phải data-driven

Không hard-code:

```ts
if (step === 1) ...
if (step === 2) ...
if (step === 3) ...
```

Workflow phải là data.

Mục tiêu:

```text
Workflow A
Front
Left
Right

Workflow B
Front
Up
Down
Left
Right

Workflow C
Front
Blink
Smile
Left
Right
```

Engine xử lý tất cả theo cùng một cơ chế.

---

# 30. Guidance Engine

Workflow Engine không nên trực tiếp render UI.

Nó tạo ra:

```ts
interface GuidanceState {
  instruction: string;

  status:
    | "SEARCHING_FACE"
    | "POSITIONING"
    | "ADJUSTING"
    | "READY"
    | "STABILIZING"
    | "COUNTDOWN"
    | "CAPTURING"
    | "SUCCESS"
    | "ERROR";

  progress: number;

  hints: GuidanceHint[];
}
```

Ví dụ:

```json
{
  "status": "ADJUSTING",
  "instruction": "Quay sang trái",
  "progress": 0.4,
  "hints": ["Quay thêm một chút sang trái"]
}
```

---

# 31. Dynamic Guidance

Không chỉ:

```text
Quay trái
```

Mà nên phản hồi theo sai số.

Ví dụ:

```text
target yaw = -30
current yaw = -5
```

→

```text
Quay sang trái thêm.
```

Nếu:

```text
current yaw = -27
```

→

```text
Gần đúng, giữ nguyên.
```

Nếu:

```text
current yaw = -40
```

→

```text
Quay lại một chút.
```

---

# 32. Guidance Priority

Nếu có nhiều lỗi cùng lúc, không hiển thị tất cả.

Ví dụ:

```text
Face quá nhỏ
Yaw sai
Brightness thấp
Blur cao
```

Không nên:

```text
4 lỗi cùng lúc
```

Nên có priority:

```text
1. No face
2. Multiple faces
3. Face too far / too close
4. Face position
5. Pose
6. Brightness
7. Sharpness
8. Occlusion
```

Hiển thị lỗi quan trọng nhất trước.

---

# 33. UI Layout

UI chính:

```text
┌──────────────────────────────────────────────┐
│                FACE CAPTURE                  │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│              CAMERA PREVIEW                 │
│                                              │
│             ┌──────────────┐                │
│            /                \               │
│           |       🙂         |               │
│            \                /               │
│             └──────────────┘                │
│                                              │
│              ✓ Giữ nguyên                   │
│                                              │
├──────────────────────────────────────────────┤
│                                              │
│          Quay mặt sang trái                 │
│                                              │
│          ████████████░░░░░                  │
│                                              │
├──────────────────────────────────────────────┤
│  ● Front      ○ Left      ○ Right            │
│  ○ Up        ○ Down                          │
└──────────────────────────────────────────────┘
```

---

# 34. Camera Overlay

Overlay phải hiển thị:

- Face frame
- Face bounding box
- Direction arrow
- Center guide
- Current pose
- Status

Không nhất thiết hiển thị raw landmarks cho end user.

Debug mode có thể bật landmarks.

---

# 35. Face Frame

Có thể dùng:

```text
Oval / Rounded rectangle
```

để hướng dẫn người dùng đặt mặt vào.

Ví dụ:

```text
       ╭─────────────╮
      /               \
     /                 \
    |        🙂         |
     \                 /
      \_______________/
```

Frame có trạng thái:

```text
SEARCHING
ADJUSTING
READY
CAPTURING
SUCCESS
ERROR
```

---

# 36. Progress

Workflow progress:

```text
Step 2 / 5
```

và:

```text
● ━ ● ━ ○ ━ ○ ━ ○
```

Không chỉ dựa vào màu sắc.

Phải có:

- icon
- text
- shape
- progress

để dễ hiểu.

---

# 37. Auto Capture UX

Khi đạt:

```text
✓ Đúng tư thế
```

sau đó:

```text
Giữ nguyên...

████████████░░░░
```

hoặc countdown:

```text
3
2
1
📸
```

Không nên chụp ngay lập tức khi điều kiện vừa đạt.

---

# 38. Success Transition

Sau khi capture:

```text
📸
✓ Đã chụp
```

sau khoảng thời gian ngắn:

```text
→ Step tiếp theo
```

Có animation nhẹ.

Không làm transition quá lâu vì workflow nhiều bước.

---

# 39. Error UI

## Không có mặt

```text
Không tìm thấy khuôn mặt

Hãy nhìn vào camera.
```

## Nhiều mặt

```text
Phát hiện nhiều khuôn mặt

Vui lòng chỉ để một người trong khung hình.
```

## Quá xa

```text
Hãy đưa mặt lại gần camera.
```

## Quá gần

```text
Hãy lùi ra một chút.
```

## Sai hướng

```text
Quay sang trái thêm một chút.
```

## Quá tối

```text
Hãy di chuyển đến nơi sáng hơn.
```

## Blur

```text
Hãy giữ đầu ổn định.
```

---

# 40. Camera Error Cases

Phải xử lý:

```text
Camera permission denied
Camera unavailable
Camera disconnected
Camera already in use
No camera found
Camera initialization failed
Invalid stream
Unsupported constraints
```

UI phải có recovery.

Ví dụ:

```text
Không thể truy cập camera.

[Thử lại]
[Chọn camera khác]
```

---

# 41. Camera Selection

Nếu có nhiều camera:

```text
Camera:
[ Logitech Brio       ▼ ]
```

Khi camera bị disconnect:

```text
Camera disconnected
```

và tự động tìm camera mới nếu có thể.

---

# 42. Resolution Strategy

Preview có thể:

```text
1920x1080
```

nhưng CV không nhất thiết chạy trên frame 1920x1080.

Pipeline:

```text
Camera 1920x1080
       │
       ├──────────────→ Preview
       │
       ↓
Resize
640x360 / 768x432
       │
       ↓
CV
```

Khi capture:

```text
Original Frame
       ↓
High Resolution Image
```

---

# 43. FPS Strategy

Camera:

```text
30 FPS
```

CV:

```text
10–15 FPS
```

UI:

```text
60 FPS hoặc browser rendering rate
```

Không chạy model nặng ở mọi frame nếu không cần.

---

# 44. Web Worker

CV nên được xem xét chạy trong:

```text
Web Worker
```

để không block React UI.

Architecture:

```text
Main Thread
│
├── React
├── Camera Preview
└── UI

Worker
│
├── Face Detection
├── Landmark
├── Pose
└── Quality
```

Communication:

```text
Main
 ↓
Frame
 ↓
Worker
 ↓
FaceState
 ↓
Main
```

---

# 45. Frame Processing Optimization

Không gửi toàn bộ frame nếu không cần.

Có thể:

```text
Video
 ↓
OffscreenCanvas
 ↓
Resize
 ↓
ImageBitmap
 ↓
Worker
```

Ưu tiên:

- ImageBitmap
- OffscreenCanvas
- Transferable objects
- Frame throttling
- Avoid unnecessary copies

---

# 46. Memory Management

Phải tránh:

```text
Frame 1
Frame 2
Frame 3
...
```

tích tụ trong memory.

Mỗi frame phải được release/close nếu API yêu cầu.

Đặc biệt chú ý:

```text
VideoFrame
ImageBitmap
Canvas
MediaStreamTrack
```

---

# 47. Capture Pipeline

Khi capture:

```text
Current Camera Frame
        ↓
Freeze / Capture
        ↓
Validate
        ↓
Crop / Process
        ↓
Encode
        ↓
Save
        ↓
Metadata
```

---

# 48. Capture Validation

Không nên tin rằng frame đạt chỉ vì realtime engine nói READY.

Sau khi capture có thể chạy validation lần cuối:

```text
Face detected
Face count
Pose
Quality
Sharpness
Brightness
Face size
```

Nếu fail:

```text
CAPTURE_REJECTED
```

và retry.

---

# 49. Capture Metadata

Mỗi ảnh nên có metadata:

```json
{
  "sessionId": "...",
  "workflowId": "face-enrollment",
  "workflowVersion": 1,
  "stepId": "left",

  "timestamp": 0,

  "pose": {
    "yaw": -29.8,
    "pitch": 1.1,
    "roll": -0.4
  },

  "quality": {
    "sharpness": 0.92,
    "brightness": 0.71,
    "faceSize": 0.43
  },

  "resolution": {
    "width": 1920,
    "height": 1080
  },

  "model": {
    "name": "MediaPipe Face Landmarker",
    "version": "..."
  }
}
```

Không nên bỏ metadata này vì cực kỳ hữu ích cho debugging và audit.

---

# 50. Session

Một lần thực hiện workflow là một:

```text
CaptureSession
```

Ví dụ:

```ts
interface CaptureSession {
  id: string;

  workflowId: string;
  workflowVersion: number;

  startedAt: number;
  completedAt?: number;

  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

  steps: CaptureStepResult[];
}
```

---

# 51. Step Result

```ts
interface CaptureStepResult {
  stepId: string;

  status: "PENDING" | "COMPLETED" | "FAILED" | "SKIPPED";

  attempts: number;

  capturedImagePath?: string;

  metrics?: {
    yaw: number;
    pitch: number;
    roll: number;
    sharpness: number;
    brightness: number;
  };

  timestamp?: number;
}
```

---

# 52. Storage

MVP có thể sử dụng:

```text
Filesystem
+
SQLite
```

Filesystem lưu ảnh:

```text
captures/
  session-id/
    front.jpg
    left.jpg
    right.jpg
```

SQLite lưu:

```text
sessions
steps
metadata
workflow config
```

Không lưu binary image lớn trực tiếp trong SQLite nếu không có lý do đặc biệt.

---

# 53. Offline Architecture

Không được phụ thuộc Internet cho:

```text
Camera
Face Detection
Face Landmark
Pose
Quality
Workflow
Capture
Storage
```

Internet nếu có chỉ dùng cho:

```text
Update
Telemetry (optional)
Remote configuration (optional)
License (optional)
```

---

# 54. Model Packaging

Model local nên được bundle:

```text
resources/
└── models/
    ├── face/
    ├── quality/
    └── liveness/
```

Electron build:

```text
electron-builder
```

Model path phải được resolve chính xác trong:

```text
development
production
packaged app
```

Không hard-code:

```text
./models/model.onnx
```

mà dùng Resource Resolver.

---

# 55. Model Resource Resolver

Ví dụ abstraction:

```ts
interface ModelResourceManager {
  getModelPath(name: string): string;
}
```

Có thể xử lý:

```text
dev
asar
extraResources
app resources
```

---

# 56. Security

Camera data là dữ liệu nhạy cảm.

Nguyên tắc:

```text
Camera frame
    ↓
Local processing
    ↓
Local result
```

Không upload mặc định.

Không log:

```text
raw image
raw frame
face image
```

Không ghi ảnh vào log.

Nếu cần debug:

```text
DEBUG_CAPTURE=true
```

và phải explicit.

---

# 57. Electron Security

Bắt buộc:

```text
contextIsolation: true
nodeIntegration: false
```

Renderer không được truy cập Node.js trực tiếp.

Dùng:

```text
preload
+
contextBridge
+
IPC
```

cho native operation.

---

# 58. Main / Renderer Responsibility

## Renderer

Phụ trách:

- Camera
- CV
- UI
- Workflow runtime
- Realtime guidance

## Main

Phụ trách:

- Filesystem
- Native APIs
- App lifecycle
- Window
- IPC
- Persistent storage nếu chọn main-process DB
- Resource management

---

# 59. TTS Integration

Có thể thêm sau.

Workflow:

```text
Workflow State
       ↓
Guidance Text
       ↓
TTS Engine
       ↓
Audio
```

Ví dụ:

```text
"Vui lòng quay mặt sang trái."
```

Không để TTS quyết định workflow.

TTS chỉ là presentation layer.

---

# 60. Liveness

Liveness là module độc lập.

Không được coi:

```text
Face Detection = Liveness
```

Liveness phải trả:

```ts
interface LivenessResult {
  status: "UNKNOWN" | "LIVE" | "SPOOF" | "FAILED";

  confidence: number;
}
```

Có thể hỗ trợ:

```text
Blink
Head movement
Smile
Challenge-response
Passive anti-spoof model
```

---

# 61. Liveness Challenge Workflow

Có thể định nghĩa:

```text
Step 1
Nhìn thẳng

Step 2
Quay trái

Step 3
Quay phải

Step 4
Chớp mắt
```

Nếu người dùng thực hiện đúng chuỗi động tác:

```text
Liveness confidence ↑
```

Tuy nhiên challenge-response không nên được coi là anti-spoofing hoàn chỉnh nếu chưa có model anti-spoof chuyên dụng.

---

# 62. Face Recognition

Không đưa Face Recognition vào core capture pipeline.

Nếu cần:

```text
Capture
 ↓
Face Embedding
 ↓
Verification / Recognition
```

đây là module phía sau.

Architecture:

```text
Capture Engine
      ↓
Captured Image
      ↓
Face Recognition Service
```

Không làm:

```text
Face Recognition
 ↓
Workflow
```

trừ khi business requirement thực sự cần.

---

# 63. Performance Target

MVP target:

```text
Camera preview:
30 FPS

CV:
10–15 FPS

Guidance latency:
< 200 ms nếu có thể

Capture:
< 1 second từ trigger đến hoàn tất save
```

Các con số này là target, không phải hard requirement trước khi benchmark trên hardware thực tế.

---

# 64. Hardware Variability

Phải test:

### Camera

- Laptop webcam
- USB webcam
- 720p
- 1080p
- 4K
- Low quality webcam

### CPU

- Low-end
- Mid-range
- High-end

### GPU

- Integrated
- Dedicated
- Không có GPU acceleration

### Lighting

- Bright
- Normal
- Dark
- Backlight
- Side light

---

# 65. Environmental Test Cases

Phải test:

```text
1. Normal light
2. Low light
3. Strong backlight
4. Face too close
5. Face too far
6. Face left
7. Face right
8. Face high
9. Face low
10. Head tilted
11. Fast movement
12. Slow movement
13. Multiple people
14. No face
15. Glasses
16. Hat
17. Mask
18. Hair covering face
19. Blur
20. Camera disconnect
```

---

# 66. Pose Edge Cases

Ví dụ target:

```text
yaw = 30°
```

Các case:

```text
25° → ACCEPT
30° → ACCEPT
35° → ACCEPT
36° → REJECT
```

Nhưng cần tránh việc user dao động:

```text
29°
36°
30°
35°
28°
```

Do đó stability phải dựa trên khoảng thời gian và/hoặc moving window.

---

# 67. Hysteresis

Nên có hysteresis để tránh UI nhấp nháy.

Ví dụ:

```text
READY threshold:
yaw 25–35

EXIT READY threshold:
yaw < 23 hoặc yaw > 37
```

Không dùng cùng một threshold cho enter/exit nếu UI bị rung.

---

# 68. Smoothing

Pose raw có thể:

```text
29
32
28
34
27
```

Nên có smoothing:

```text
raw pose
 ↓
moving average / EMA
 ↓
stable pose
```

Nhưng phải cân bằng:

```text
smooth quá nhiều → lag
smooth quá ít → jitter
```

---

# 69. Confidence

Mọi CV result nên có confidence nếu model hỗ trợ.

Ví dụ:

```ts
face.confidence;
landmark.confidence;
quality.confidence;
```

Không nên coi kết quả model là absolute truth.

---

# 70. State Machine

Có thể định nghĩa:

```text
INITIALIZING
    ↓
CAMERA_READY
    ↓
SEARCHING_FACE
    ↓
FACE_FOUND
    ↓
POSITIONING
    ↓
POSE_ADJUSTMENT
    ↓
QUALITY_CHECK
    ↓
STABILIZING
    ↓
READY
    ↓
COUNTDOWN
    ↓
CAPTURING
    ↓
VALIDATING
    ↓
SUCCESS
    ↓
NEXT_STEP
```

Error:

```text
CAMERA_ERROR
MODEL_ERROR
CAPTURE_ERROR
VALIDATION_ERROR
TIMEOUT
```

---

# 71. Timeout

Mỗi step nên có timeout.

Ví dụ:

```ts
timeoutMs: 15000;
```

Nếu người dùng không đạt sau 15 giây:

```text
Không thể hoàn thành bước này.

[Thử lại]
```

Không để workflow treo vô hạn.

---

# 72. Retry

Retry phải reset:

```text
stability
countdown
capture state
```

nhưng không nhất thiết reset toàn bộ session.

---

# 73. Manual Capture

MVP có thể hỗ trợ:

```text
AUTO
MANUAL
```

Mode:

```text
autoCapture: true
```

Nếu false:

```text
✓ Đã đúng tư thế

[Chụp ảnh]
```

Manual mode rất hữu ích cho debugging và operator workflow.

---

# 74. Debug Mode

Nên có developer/debug mode.

Hiển thị:

```text
FPS
CV FPS
Yaw
Pitch
Roll
Face confidence
Face size
Brightness
Sharpness
Current step
Condition status
Stability
Memory
```

Ví dụ:

```text
FPS: 30
CV: 12
Face: 0.98
Yaw: -29.4
Pitch: 1.1
Roll: -0.4
Sharpness: 0.89
Brightness: 0.72
Stable: 420ms
Step: LEFT
```

Debug mode cực kỳ quan trọng để tune threshold.

---

# 75. Threshold Configuration

Không hard-code tất cả threshold.

Tách thành configuration:

```ts
interface CVThresholdConfig {
  pose: {
    yawTolerance: number;
    pitchTolerance: number;
    rollTolerance: number;
  };

  face: {
    minSize: number;
    maxSize: number;
  };

  quality: {
    minBrightness: number;
    maxBrightness: number;
    minSharpness: number;
  };

  stability: {
    durationMs: number;
  };
}
```

---

# 76. Configuration Hierarchy

Có thể:

```text
Global Defaults
      ↓
Workflow Defaults
      ↓
Step Overrides
```

Ví dụ:

```text
Global:
yaw tolerance = 5

Workflow:
yaw tolerance = 8

Step:
yaw tolerance = 10
```

Step cuối cùng thắng.

---

# 77. Workflow Versioning

Workflow nên có:

```text
id
version
```

Ví dụ:

```text
face-enrollment v1
face-enrollment v2
```

Session phải lưu version.

Nếu workflow thay đổi, session cũ vẫn có thể truy xuất chính xác rule đã dùng.

---

# 78. Image File Naming

Không dùng tên:

```text
image1.jpg
image2.jpg
```

Nên:

```text
{sessionId}/{stepId}-{timestamp}.jpg
```

Ví dụ:

```text
abc123/
  front-1786430001.jpg
  left-1786430002.jpg
  right-1786430003.jpg
```

---

# 79. Directory Structure

Gợi ý:

```text
app-data/
├── sessions/
├── captures/
├── workflows/
├── models/
├── logs/
└── database/
```

---

# 80. Suggested Source Structure

```text
src/
├── main/
│   ├── index.ts
│   ├── ipc/
│   ├── filesystem/
│   ├── storage/
│   └── resources/
│
├── preload/
│   └── index.ts
│
├── renderer/
│   ├── app/
│   │
│   ├── camera/
│   │   ├── CameraService.ts
│   │   ├── CameraManager.ts
│   │   ├── CameraConstraints.ts
│   │   └── types.ts
│   │
│   ├── cv/
│   │   ├── CVEngine.ts
│   │   ├── FaceDetector.ts
│   │   ├── FaceLandmarker.ts
│   │   ├── PoseEstimator.ts
│   │   ├── QualityEngine.ts
│   │   └── adapters/
│   │
│   ├── workflow/
│   │   ├── WorkflowEngine.ts
│   │   ├── StepEvaluator.ts
│   │   ├── StabilityTracker.ts
│   │   ├── GuidanceEngine.ts
│   │   └── types.ts
│   │
│   ├── capture/
│   │   ├── CaptureController.ts
│   │   ├── CaptureValidator.ts
│   │   └── ImageProcessor.ts
│   │
│   ├── session/
│   │   ├── SessionManager.ts
│   │   └── types.ts
│   │
│   ├── ui/
│   │   ├── CameraView/
│   │   ├── FaceOverlay/
│   │   ├── Guidance/
│   │   ├── StepProgress/
│   │   ├── Countdown/
│   │   └── Result/
│   │
│   └── debug/
│
└── shared/
    ├── types/
    ├── schemas/
    └── constants/
```

---

# 81. Separation of Concerns

Không được để:

```text
React Component
   ↓
MediaPipe
   ↓
Camera
   ↓
Workflow
   ↓
Filesystem
```

trong cùng một component.

Ví dụ không nên có:

```tsx
<CameraPage />
```

chứa hàng nghìn dòng xử lý.

Phải tách:

```text
CameraService
CVEngine
WorkflowEngine
CaptureController
SessionManager
```

---

# 82. React UI Components

Có thể có:

```text
CameraScreen
├── CameraPreview
├── FaceGuideOverlay
├── PoseIndicator
├── GuidanceMessage
├── StabilityProgress
├── CaptureCountdown
├── StepProgress
├── CameraSelector
└── DebugPanel
```

---

# 83. CameraPreview

Chỉ chịu trách nhiệm:

- Render video
- Mirror
- Camera dimensions
- Canvas overlay

Không biết workflow.

---

# 84. FaceGuideOverlay

Nhận:

```ts
FaceState;
```

và render:

```text
bbox
face guide
pose direction
status
```

Không tự quyết định capture.

---

# 85. GuidanceMessage

Nhận:

```ts
GuidanceState;
```

và render:

```text
instruction
hint
status
```

---

# 86. StepProgress

Nhận workflow/session state.

Ví dụ:

```text
✓ Front
● Left
○ Right
○ Up
○ Down
```

---

# 87. CaptureController

Đây là module duy nhất có quyền:

```text
TRIGGER_CAPTURE
```

Không để UI tự chụp trong MVP.

Flow:

```text
WorkflowEngine
       ↓
CaptureController
       ↓
Camera Frame
       ↓
Validation
       ↓
Storage
```

---

# 88. Event Model

Có thể dùng event:

```text
CAMERA_READY
CAMERA_ERROR

FACE_DETECTED
FACE_LOST

POSE_CHANGED
QUALITY_CHANGED

STEP_READY
STEP_COMPLETED

CAPTURE_STARTED
CAPTURE_COMPLETED
CAPTURE_FAILED

WORKFLOW_COMPLETED
WORKFLOW_FAILED
```

Điều này giúp các module ít coupling.

---

# 89. Realtime Data Flow

```text
Camera
 ↓
Video Frame
 ↓
CV Worker
 ↓
FaceState
 ↓
StepEvaluator
 ↓
GuidanceState
 ↓
React
```

Nếu đạt:

```text
FaceState
 ↓
StepEvaluator
 ↓
READY
 ↓
StabilityTracker
 ↓
CaptureController
 ↓
Capture
```

---

# 90. Critical Rule

UI không được tự suy luận:

```text
yaw > 25
```

UI chỉ nhận:

```text
GuidanceState
```

Business rule nằm trong:

```text
Workflow / StepEvaluator
```

CV logic nằm trong:

```text
CV Engine
```

---

# 91. Test Strategy

## Unit Tests

Test:

```text
PoseEvaluator
QualityEvaluator
StabilityTracker
WorkflowEngine
StateMachine
Threshold calculations
```

Ví dụ:

```text
target = 30
tolerance = 5

25 => true
30 => true
35 => true
36 => false
```

---

# 92. Integration Tests

Test:

```text
Camera
+
CV
+
Workflow
+
Capture
```

---

# 93. Replay Testing

Đây là tính năng rất nên có.

Có thể record video/frame sequence:

```text
test-data/
  front/
  left/
  right/
  bad-light/
  multiple-face/
```

Sau đó chạy CV offline trên dữ liệu đã record.

Điều này giúp:

- Tune threshold
- So sánh model
- Regression testing
- Không cần người thật mỗi lần test

---

# 94. Golden Dataset

Tạo dataset nội bộ:

```text
front/
left/
right/
up/
down/
tilted/
blur/
dark/
multiple-face/
```

Mỗi sample có expected result.

Ví dụ:

```json
{
  "file": "left-30.jpg",
  "expected": {
    "yawRange": [-35, -25],
    "pitchRange": [-8, 8],
    "rollRange": [-8, 8]
  }
}
```

---

# 95. Model Benchmark

Nếu sau này có nhiều model:

```text
MediaPipe
Model A
Model B
```

phải có benchmark.

Metrics:

```text
Accuracy
FPS
CPU
RAM
Latency
Model size
Startup time
```

---

# 96. Performance Monitoring

Trong debug:

```text
Camera FPS
CV FPS
Inference latency
Queue size
CPU
Memory
Capture latency
```

Nếu CV chậm:

```text
camera 30 FPS
CV 5 FPS
```

không được để queue tăng vô hạn.

Chỉ nên xử lý frame mới nhất.

---

# 97. Frame Queue Strategy

Không nên:

```text
Frame 1
Frame 2
Frame 3
Frame 4
...
```

chờ xử lý tuần tự nếu model không theo kịp.

Nên:

```text
Latest Frame Wins
```

Nếu worker đang xử lý:

```text
Frame 10
```

và camera đã tới:

```text
Frame 15
```

thì có thể bỏ:

```text
11–14
```

và xử lý frame mới nhất.

---

# 98. Startup Flow

```text
Application Start
 ↓
Load configuration
 ↓
Load model
 ↓
Initialize CV
 ↓
Enumerate cameras
 ↓
Select camera
 ↓
Request permission
 ↓
Start stream
 ↓
Start CV
 ↓
Start workflow
```

---

# 99. Model Loading UX

Không nên để UI đứng im.

Hiển thị:

```text
Đang khởi tạo camera...

██████████░░░░
```

Nếu model lớn:

```text
Đang tải bộ nhận diện khuôn mặt...
```

Sau đó:

```text
✓ Camera ready
✓ Face model ready
```

---

# 100. Failure Recovery

Nếu model load fail:

```text
CV_MODEL_ERROR
```

UI:

```text
Không thể khởi tạo bộ nhận diện khuôn mặt.

[Thử lại]
```

Nếu camera fail:

```text
CAMERA_ERROR
```

Không crash app.

---

# 101. Graceful Shutdown

Khi đóng screen:

```text
stop CV
stop worker
stop camera tracks
release canvas
release ImageBitmap
release model resources
```

Khi đóng app:

```text
stop MediaStream
dispose CV
flush database
```

---

# 102. Privacy Requirements

Mặc định:

```text
NO CLOUD
NO UPLOAD
NO RAW FRAME LOGGING
NO REMOTE INFERENCE
```

Ảnh chỉ được lưu nếu workflow yêu cầu capture.

Không lưu toàn bộ camera stream.

---

# 103. Security Requirement

Nếu ảnh khuôn mặt là dữ liệu nhạy cảm:

- Giới hạn quyền truy cập
- Không log ảnh
- Không gửi ảnh lên analytics
- Không đưa ảnh vào crash reports
- Không đưa raw frame vào telemetry
- Có thể mã hóa storage nếu business requirement yêu cầu

---

# 104. Analytics

Nếu sau này có telemetry:

Chỉ gửi metrics dạng:

```text
workflow_completed
workflow_failed
step_timeout
camera_error
cv_latency
```

Không gửi:

```text
face image
camera frame
landmarks
biometric embedding
```

trừ khi có yêu cầu rõ ràng và cơ chế bảo mật phù hợp.

---

# 105. UX Principle

Ứng dụng phải trả lời được ngay:

> Tôi phải làm gì?

và:

> Tôi đã làm đúng chưa?

Ví dụ tốt:

```text
Quay sang trái thêm một chút
```

Không tốt:

```text
Yaw validation failed
```

Debug information chỉ dành cho developer/operator.

---

# 106. UX Feedback Hierarchy

Ưu tiên:

```text
1. Instruction
2. Immediate correction
3. Success confirmation
4. Progress
5. Technical details
```

---

# 107. Accessibility

Không phụ thuộc hoàn toàn vào màu.

Không dùng:

```text
red = fail
green = success
```

mà dùng:

```text
icon
text
shape
animation
```

Nếu có TTS:

```text
visual guidance
+
audio guidance
```

---

# 108. Mirror Mode

Camera selfie thường mirror preview.

Nhưng image capture có thể cần:

```text
preview mirrored
capture original
```

Phải tách rõ:

```text
PreviewTransform
CaptureTransform
```

Không được mặc định lưu ảnh mirror chỉ vì preview mirror.

---

# 109. Coordinate System

Đây là vấn đề dễ gây bug.

Camera:

```text
x/y
```

Canvas:

```text
x/y
```

Face landmark:

```text
normalized coordinates
```

UI:

```text
CSS pixels
```

Phải có một `CoordinateMapper`.

```ts
CoordinateMapper;
```

chịu trách nhiệm:

```text
CV coordinates
 ↓
Video coordinates
 ↓
Canvas coordinates
 ↓
UI coordinates
```

---

# 110. Aspect Ratio

Phải xử lý:

```text
16:9
4:3
1:1
```

Không assume camera luôn 16:9.

Face overlay phải khớp chính xác với video.

---

# 111. Crop Strategy

Nếu UI crop camera:

```text
object-fit: cover
```

thì CV coordinates và visual coordinates có thể khác.

Phải map:

```text
source frame
→ rendered video
→ cropped viewport
```

Đây là một trong những lỗi UI/CV phổ biến nhất.

---

# 112. Device Orientation

Desktop Electron chủ yếu landscape, nhưng vẫn nên abstraction orientation nếu sau này mở rộng.

---

# 113. Camera Constraints

Không hard-code một resolution duy nhất.

Ví dụ:

```ts
{
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  },
  audio: false
}
```

Sau đó đọc:

```text
MediaTrackSettings
```

để biết camera thực tế cung cấp gì.

---

# 114. Camera Permission

Flow:

```text
Open camera
 ↓
Permission granted?
 ├── YES → start
 └── NO
      ↓
Explain permission
      ↓
Retry
```

Nếu OS permission bị deny hoàn toàn:

```text
Open system settings
```

nếu platform API cho phép.

---

# 115. Windows / macOS

Phải test riêng:

```text
macOS
Windows
```

Đặc biệt:

- Camera permission
- Camera device enumeration
- Device hot plug
- File system
- App sandboxing
- Packaging
- Native permission behavior

---

# 116. Packaging

Sử dụng:

```text
electron-builder
```

Model local phải được đóng gói đúng.

Không nên nhét model lớn vào ASAR nếu runtime/model library yêu cầu filesystem path thực.

Có thể dùng:

```text
extraResources
```

để đưa model ra ngoài ASAR.

---

# 117. Model Loading Path

Production:

```text
process.resourcesPath
```

Development:

```text
project resources
```

Nên có:

```ts
resolveModelPath();
```

thay vì hard-code.

---

# 118. MVP Phase Plan

## Phase 0 — Architecture

Implement:

```text
Project structure
Types
Interfaces
State machine
Workflow schema
```

Chưa cần CV hoàn chỉnh.

---

## Phase 1 — Camera

Implement:

```text
CameraService
Camera selector
Preview
Permission
Capture
```

Acceptance:

```text
Open camera
Preview camera
Switch camera
Capture image
Close camera cleanly
```

---

## Phase 2 — Face Detection

Implement:

```text
Face detector
Bounding box
Multiple face
Face count
```

UI:

```text
face box
```

---

## Phase 3 — Landmark + Pose

Implement:

```text
Landmarks
Yaw
Pitch
Roll
```

Debug UI:

```text
Yaw
Pitch
Roll
FPS
Confidence
```

---

## Phase 4 — Rule Engine

Implement:

```text
Pose evaluator
Position evaluator
Face size evaluator
```

---

## Phase 5 — Quality

Implement:

```text
Brightness
Sharpness
Face size
Occlusion/basic visibility
```

---

## Phase 6 — Workflow

Implement:

```text
Workflow schema
Step engine
Step transitions
Timeout
Retry
```

---

## Phase 7 — Auto Capture

Implement:

```text
Stability
Countdown
Capture
Post-capture validation
```

---

## Phase 8 — Production UX

Implement:

```text
Guidance
Animations
Error messages
Progress
Success states
Camera settings
```

---

## Phase 9 — Persistence

Implement:

```text
Session
SQLite
Image storage
Metadata
```

---

## Phase 10 — Optimization

Implement:

```text
Web Worker
Frame throttling
Latest-frame strategy
Memory optimization
FPS optimization
```

---

## Phase 11 — Optional Advanced CV

Implement:

```text
ONNX Runtime
Face Quality model
Anti-spoof
Liveness
```

---

# 119. MVP Acceptance Criteria

MVP được coi là đạt khi:

### Camera

- Có thể chọn camera.
- Camera preview ổn định.
- Có thể xử lý camera disconnect.
- Không crash khi camera không tồn tại.

### Face

- Detect được một khuôn mặt.
- Phát hiện được nhiều khuôn mặt.
- Không face → không capture.
- Multiple face → không capture.

### Pose

Có thể phân biệt:

```text
Front
Left
Right
Up
Down
```

theo threshold cấu hình.

### Quality

Không capture khi:

```text
face quá nhỏ
face quá lớn
quá tối
quá blur
pose sai
face không nằm đúng vị trí
```

### Stability

Không capture ngay khi vừa đạt.

### Workflow

Có thể:

```text
Front
→ Left
→ Right
→ Complete
```

### Storage

Mỗi step tạo được:

```text
image
+
metadata
```

---

# 120. Definition of Done

Một feature chỉ được coi là Done khi:

```text
Implementation
+
Unit Test
+
Error Handling
+
UI State
+
Debug State
+
Performance Consideration
+
Cleanup
```

Không chỉ viết code "happy path".

---

# 121. AI Agent Instructions

AI Agent khi triển khai project phải tuân thủ:

## Rule 1

Không tự ý thay đổi architecture core.

Core architecture:

```text
Camera
→ CV
→ FaceState
→ Workflow
→ Capture
```

---

## Rule 2

Không để React component trực tiếp chứa CV/business logic.

---

## Rule 3

Không để Workflow phụ thuộc trực tiếp vào MediaPipe.

---

## Rule 4

Không thêm cloud AI nếu không được yêu cầu.

---

## Rule 5

Không thêm Python runtime vào MVP.

---

## Rule 6

Không upload camera frame.

---

## Rule 7

Không log raw face image.

---

## Rule 8

Không hard-code workflow step.

---

## Rule 9

Không hard-code threshold nếu threshold thuộc configuration.

---

## Rule 10

Không xử lý mọi camera frame một cách vô hạn nếu CV không đủ nhanh.

Ưu tiên:

```text
latest frame wins
```

---

# 122. AI Agent Implementation Order

AI Agent nên triển khai theo thứ tự:

```text
1. Domain types
2. Workflow schema
3. State machine
4. Camera abstraction
5. Camera UI
6. CV abstraction
7. MediaPipe adapter
8. FaceState
9. Pose evaluator
10. Quality evaluator
11. Stability tracker
12. Capture controller
13. Workflow engine
14. Guidance engine
15. UI
16. Storage
17. Debug tools
18. Tests
19. Performance optimization
```

Không bắt đầu bằng việc xây UI hoàn chỉnh trước khi domain contract rõ ràng.

---

# 123. Important Domain Interfaces

Các interface quan trọng cần tồn tại:

```text
CameraService
CVEngine
FaceState
PoseEstimator
QualityEngine
WorkflowEngine
StepEvaluator
StabilityTracker
CaptureController
CaptureValidator
SessionManager
StorageService
GuidanceEngine
```

---

# 124. Recommended Dependency Direction

```text
UI
 ↓
Application Services
 ↓
Domain
 ↓
Infrastructure
```

Ví dụ:

```text
React
 ↓
WorkflowController
 ↓
WorkflowEngine
 ↓
CVEngine interface
 ↓
MediaPipe / ONNX implementation
```

Không:

```text
React
 ↓
MediaPipe
 ↓
Filesystem
```

---

# 125. Domain vs Infrastructure

## Domain

```text
Workflow
Step
PoseTarget
QualityRequirement
FaceState
GuidanceState
Session
```

## Infrastructure

```text
MediaPipe
ONNX
Camera API
Filesystem
SQLite
Electron IPC
```

Điều này giúp test domain mà không cần camera thật.

---

# 126. Test Workflow Without Camera

Có thể mock:

```ts
const faceState = {
  detected: true,

  faceCount: 1,

  pose: {
    yaw: -30,
    pitch: 1,
    roll: 0,
  },
};
```

Sau đó test:

```text
WorkflowEngine
```

mà không cần camera.

---

# 127. Simulation Mode

Nên có:

```text
Simulation Mode
```

Cho phép:

```text
Front
Left
Right
Up
Down
```

giả lập bằng slider:

```text
Yaw:
[-90]──────●──────[90]
             30°
```

Pitch:

```text
[-90]──────●──────[90]
              0°
```

Điều này giúp phát triển UI/workflow mà không cần camera.

---

# 128. Debug Simulator

Ví dụ:

```text
Face detected: ✓

Yaw:
[-90 -------- 0 -------- 90]
                 ●  -30

Pitch:
[-90 -------- 0 -------- 90]
                  ●   0

Roll:
[-90 -------- 0 -------- 90]
                  ●   0
```

Khi kéo slider:

```text
WorkflowEngine
```

phải phản ứng như camera thật.

---

# 129. Why Simulation Is Important

Nó giúp AI Agent:

- Test deterministic
- Test workflow
- Test UI
- Test threshold
- Test state machine
- Test edge case

mà không cần camera.

---

# 130. Future Workflow Editor

Sau khi engine ổn định, có thể xây UI:

```text
Workflow Editor
```

Ví dụ:

```text
Steps

1. Front
   Target Yaw: 0
   Pitch: 0
   Roll: 0

2. Left
   Target Yaw: -30

3. Right
   Target Yaw: +30
```

Drag/drop:

```text
Front
↓
Left
↓
Right
↓
Up
↓
Down
```

---

# 131. Workflow Step Types

Architecture nên hỗ trợ nhiều loại step:

```text
POSE
BLINK
SMILE
MOUTH_OPEN
LOOK_DIRECTION
HOLD_STILL
WAIT
CAPTURE
CUSTOM
```

Ví dụ:

```text
{
  type: "POSE"
}
```

hoặc:

```text
{
  type: "BLINK"
}
```

---

# 132. Conditional Workflow

Future:

```text
if liveness == required
    → continue
else
    → retry
```

hoặc:

```text
if glassesDetected
    → special workflow
```

Nhưng không cần implement ngay.

---

# 133. Advanced Workflow Graph

Về lâu dài workflow không nhất thiết là linear list.

Có thể là:

```text
        Front
          ↓
       Liveness
       /      \
    PASS      FAIL
     ↓          ↓
   Left       Retry
     ↓
   Right
     ↓
  Complete
```

Do đó nên tránh thiết kế domain quá cứng chỉ cho array tuyến tính.

MVP vẫn có thể dùng array, nhưng engine nên đủ abstraction để sau này mở rộng thành graph.

---

# 134. Recommended First Architecture

Để tránh over-engineering, MVP chỉ cần:

```text
Linear Workflow
```

với:

```text
Step[]
```

Nhưng API nên được thiết kế:

```text
WorkflowEngine
```

thay vì:

```text
StepArrayProcessor
```

---

# 135. Core Concept Summary

Toàn bộ hệ thống có thể hiểu bằng 6 khối:

```text
1. CAMERA
   lấy hình

2. CV ENGINE
   hiểu khuôn mặt

3. FACE STATE
   chuẩn hóa kết quả

4. RULE ENGINE
   kiểm tra có đạt không

5. WORKFLOW ENGINE
   quyết định bước tiếp theo

6. CAPTURE ENGINE
   chụp và lưu ảnh
```

UI chỉ là lớp hiển thị trạng thái của 6 khối trên.

---

# 136. Final Architecture

```text
                         ┌────────────────────┐
                         │       Electron     │
                         └─────────┬──────────┘
                                   │
                         ┌─────────▼──────────┐
                         │      React UI      │
                         └─────────┬──────────┘
                                   │
                 ┌─────────────────┼─────────────────┐
                 │                 │                 │
                 ▼                 ▼                 ▼
            Camera UI        Guidance UI       Progress UI
                 │
                 ▼
          ┌──────────────┐
          │ CameraService│
          └──────┬───────┘
                 │
                 ▼
            Video Frames
                 │
                 ▼
          ┌──────────────┐
          │   CV Engine  │
          └──────┬───────┘
                 │
        ┌────────┼───────────┐
        │        │           │
        ▼        ▼           ▼
      Face    Landmarks   Quality
      Detect               Engine
        │        │           │
        └────────┼───────────┘
                 ▼
             Head Pose
                 │
                 ▼
            ┌──────────┐
            │ FaceState│
            └────┬─────┘
                 │
                 ▼
          ┌──────────────┐
          │Step Evaluator│
          └──────┬───────┘
                 │
                 ▼
          ┌──────────────┐
          │WorkflowEngine│
          └──────┬───────┘
                 │
        ┌────────┼────────┐
        │                 │
        ▼                 ▼
    Guidance          Stability
                          │
                          ▼
                   CaptureController
                          │
                          ▼
                    Post Validation
                          │
                          ▼
                    Image Processor
                          │
                          ▼
                 ┌─────────────────┐
                 │ Storage / SQLite│
                 └─────────────────┘
```

---

# 137. Technology Decision Summary

| Area             | Recommended                         |
| ---------------- | ----------------------------------- |
| Desktop          | Electron                            |
| Language         | TypeScript                          |
| UI               | React                               |
| Camera           | MediaDevices / getUserMedia         |
| Face Landmarks   | MediaPipe Face Landmarker           |
| CV abstraction   | Custom `CVEngine`                   |
| Future ML        | ONNX Runtime                        |
| Image processing | Canvas / OpenCV.js when necessary   |
| Background CV    | Web Worker                          |
| Workflow         | Custom deterministic engine         |
| Storage          | Filesystem + SQLite                 |
| Packaging        | electron-builder                    |
| Model packaging  | Electron resources / extraResources |
| Network          | Not required                        |
| Cloud AI         | Not required                        |
| Python           | Not required for MVP                |
| LLM              | Not required                        |
| TTS              | Optional future module              |
| Liveness         | Optional advanced module            |

---

# 138. Most Important Design Decisions

## Decision 1

**Offline-first.**

Camera data stays local.

## Decision 2

**CV and workflow are separate.**

CV tells the system:

```text
"What do I see?"
```

Workflow tells the system:

```text
"What should happen?"
```

## Decision 3

**FaceState is the contract.**

Everything phía sau CV chỉ cần hiểu `FaceState`.

## Decision 4

**Workflow is data-driven.**

Không hard-code từng bước.

## Decision 5

**Auto capture requires stability.**

Không chụp chỉ vì một frame đạt.

## Decision 6

**Quality is separate from pose.**

Đúng góc không có nghĩa ảnh tốt.

## Decision 7

**Capture phải validate lần cuối.**

Realtime READY không đồng nghĩa ảnh cuối chắc chắn hợp lệ.

## Decision 8

**UI không chứa business logic.**

UI chỉ hiển thị state.

## Decision 9

**Model phải replaceable.**

MediaPipe hôm nay có thể thay bằng ONNX model sau này.

## Decision 10

**Simulation mode phải tồn tại.**

Workflow phải test được mà không cần camera.

---

# 139. First Implementation Milestone

Milestone đầu tiên không cần làm toàn bộ hệ thống.

Chỉ cần đạt:

```text
Electron
 +
React
 +
Camera
 +
MediaPipe Face Landmarker
 +
Face bounding box
 +
Yaw/Pitch/Roll
 +
Debug panel
```

Kết quả mong muốn:

```text
Camera đang chạy

Face detected: YES

Yaw:     -29.4°
Pitch:     1.2°
Roll:     -0.8°

FPS:       30
CV FPS:    12
```

Sau khi phần này ổn định mới xây:

```text
Pose Rule
→ Workflow
→ Stability
→ Auto Capture
```

---

# 140. Final Product Vision

Sản phẩm cuối cùng không nên được coi đơn giản là:

> "Một app chụp ảnh bằng camera."

Mà nên được coi là:

> **A configurable offline Face Capture & Guided Verification Engine for Electron.**

Nó có 3 capability lớn:

```text
                 FACE CAPTURE ENGINE
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
     COMPUTER VISION   WORKFLOW      CAPTURE
          │              │              │
       Face/Pose      Guidance       Image
       Quality        Rules          Validation
       Liveness       Steps          Storage
```

Một khi 3 layer này được thiết kế độc lập, hệ thống có thể phát triển từ:

```text
Front
Left
Right
```

thành:

```text
Face Enrollment
Identity Verification
Liveness
Document + Face Verification
KYC Capture
Employee Enrollment
Access Control
Biometric Capture
```

mà không cần viết lại phần camera/UI/CV từ đầu.

---

# 141. AI Agent Starting Prompt

AI Agent có thể sử dụng phần dưới đây làm instruction khi bắt đầu triển khai:

> Build an Electron + React + TypeScript offline-first guided face capture application.
>
> The application connects to a webcam, displays a realtime camera preview, detects a face locally, estimates facial landmarks and head pose (yaw/pitch/roll), evaluates face position and image quality, and guides the user through a configurable capture workflow.
>
> The workflow consists of steps such as FRONT, LEFT, RIGHT, UP, DOWN. Each step defines target pose, tolerance, face-size requirements, quality requirements, stability duration, and capture behavior.
>
> The system must automatically capture an image only when all requirements are satisfied and the pose remains stable for the configured duration.
>
> The architecture must strictly separate:
>
> ```text
> Camera
> ↓
> CV Engine
> ↓
> FaceState
> ↓
> Rule / Step Evaluator
> ↓
> Workflow Engine
> ↓
> Guidance
> ↓
> Capture Controller
> ↓
> Validation
> ↓
> Storage
> ```
>
> Use MediaPipe Face Landmarker as the initial local CV implementation. The CV layer must be abstracted so it can later be replaced by ONNX Runtime/local models without changing the workflow or UI layers.
>
> Do not introduce Python, cloud inference, LLM inference, or remote camera processing in the MVP.
>
> Camera frames must remain local.
>
> React components must not directly contain CV or workflow business logic.
>
> Workflow steps must be data-driven rather than hard-coded.
>
> Implement proper state machines, stability detection, threshold configuration, error handling, camera disconnect handling, multiple-face handling, quality validation, post-capture validation, session tracking, image metadata, and cleanup.
>
> Provide a debug/simulation mode so pose and workflow behavior can be tested without a physical camera.
>
> Prioritize correctness, deterministic behavior, low latency, memory efficiency, and clean separation of concerns over premature feature expansion.
>
> Implement the system incrementally in the following order:
>
> 1. Domain types and interfaces
> 2. Workflow schema
> 3. State machine
> 4. Camera service
> 5. Camera UI
> 6. CV abstraction
> 7. MediaPipe adapter
> 8. FaceState
> 9. Pose evaluator
> 10. Quality evaluator
> 11. Stability tracker
> 12. Capture controller
> 13. Workflow engine
> 14. Guidance engine
> 15. UI/UX
> 16. Storage
> 17. Debug/simulation tools
> 18. Tests
> 19. Performance optimization
>
> Do not skip the domain abstractions and do not tightly couple the implementation to MediaPipe.

---

# 142. Immediate Next Task

AI Agent **không nên bắt đầu viết toàn bộ application ngay**.

Task đầu tiên nên là:

```text
Design and implement the domain contracts and architecture skeleton.

Deliver:
- project folder structure
- FaceState
- PoseTarget
- QualityRequirement
- CaptureStep
- CaptureWorkflow
- GuidanceState
- CaptureSession
- StepResult
- CameraService interface
- CVEngine interface
- WorkflowEngine interface
- CaptureController interface
- State machine definitions
- basic dependency direction
- simulation/mock CV implementation
```

Sau khi các contract này ổn định mới kết nối MediaPipe.

---

# 143. End Goal

Hệ thống cuối cùng phải đạt được trải nghiệm:

```text
                    START
                      │
                      ▼
              ┌──────────────┐
              │ Camera Ready │
              └───────┬──────┘
                      │
                      ▼
               Detect Face
                      │
                      ▼
             "Nhìn thẳng vào camera"
                      │
                      ▼
             Pose + Quality OK?
                │          │
               NO         YES
                │          │
                ▼          ▼
          Give Guidance   Stable
                              │
                              ▼
                           Capture
                              │
                              ▼
                         Validate
                         │       │
                       FAIL     PASS
                         │       │
                         ▼       ▼
                       Retry   Next Step
                                  │
                                  ▼
                           "Quay sang trái"
                                  │
                                  ▼
                              ...
                                  │
                                  ▼
                              COMPLETE
```

**Đây là flow cốt lõi của toàn bộ sản phẩm.**
