# Implementation Plan — Phase 9: Python AI Service & Heavy Models

Xây dựng dịch vụ Python FastAPI Sidecar (`services/python-ai`) phục vụ trích xuất vector đặc trưng ArcFace / MobileFaceNet 512 chiều và kiểm tra liveness nâng cao (Deep Liveness), giao tiếp qua REST API độc lập giúp ứng dụng dễ dàng nâng cấp mô hình AI nặng.

## User Review Required

> [!IMPORTANT]
> - **Independent Python Sidecar**: Dịch vụ AI được đóng gói thành một service Python riêng biệt (`services/python-ai`) chạy trên môi trường virtualenv/uv, tiếp nhận request tại `http://localhost:8321`.
> - **API Contracts**:
>   - `GET /api/v1/health`: Kiểm tra trạng thái hoạt động và mô hình đã load.
>   - `POST /api/v1/embed`: Trích xuất vector embedding 512 chiều từ ảnh base64/buffer.
>   - `POST /api/v1/liveness`: Đánh giá độ tin cậy ảnh thật vs ảnh giả (Spoofing detection).

## Open Questions

Không có câu hỏi mở cho Phase 9.

## Proposed Changes

### Subsystem: `services/python-ai`

#### [NEW] [services/python-ai/pyproject.toml](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/pyproject.toml)
#### [NEW] [services/python-ai/requirements.txt](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/requirements.txt)
#### [NEW] [services/python-ai/src/models/extractor.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/models/extractor.py)
- Model Inference Worker giả lập/ONNX Runtime trích xuất 512-d embeddings và tính điểm Liveness.
#### [NEW] [services/python-ai/src/api/routes/health.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/routes/health.py)
#### [NEW] [services/python-ai/src/api/routes/embedding.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/routes/embedding.py)
#### [NEW] [services/python-ai/src/api/routes/liveness.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/routes/liveness.py)
#### [NEW] [services/python-ai/src/api/app.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/app.py)
- Khởi tạo server FastAPI app, tích hợp CORS và mount các API routes.
#### [NEW] [services/python-ai/src/tests/test_api.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/tests/test_api.py)
- Pytest suite kiểm tra các endpoints `/api/v1/health`, `/api/v1/embed`, và `/api/v1/liveness`.

---

## Verification Plan

### Automated Tests
- Chạy unit tests cho Python service:
  ```bash
  cd services/python-ai && python3 -m unittest discover -s src/tests
  ```

### Manual Verification
- Kiểm tra FastAPI endpoint `GET /api/v1/health` trả về `{"status": "ok"}`.
