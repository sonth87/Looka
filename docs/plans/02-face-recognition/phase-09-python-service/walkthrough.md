# Phase 9: Python AI Service & Heavy Models — Walkthrough

Đã hoàn thành xây dựng dịch vụ Python FastAPI Sidecar độc lập (`services/python-ai`), khai báo REST APIs cho bài toán trích xuất 512-d embeddings (`/api/v1/embed`) và Deep Liveness evaluation (`/api/v1/liveness`) cùng kiểm tra sức khỏe dịch vụ (`/api/v1/health`).

---

## Các Thay Đổi Đã Thực Hiện

### Subsystem: `services/python-ai` (`services/python-ai`)
- [pyproject.toml](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/pyproject.toml) & [requirements.txt](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/requirements.txt):
  - Cấu hình môi trường phụ thuộc Python 3.10+ với `fastapi`, `uvicorn`, `pydantic`, `numpy`, `httpx`.
- [extractor.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/models/extractor.py):
  - Model Inference Worker thực hiện tính toán vector 512 chiều chuẩn hóa L2 và đánh giá chỉ số Anti-spoofing Liveness.
- [health.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/routes/health.py): REST API `GET /api/v1/health` trả về thông số trạng thái hoạt động của dịch vụ.
- [embedding.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/routes/embedding.py): REST API `POST /api/v1/embed` nhận payload ảnh mẫu và trả về vector 512 chiều.
- [liveness.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/routes/liveness.py): REST API `POST /api/v1/liveness` nhận payload ảnh và trả về kết quả liveness (`LIVE` vs `SPOOF`).
- [app.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/api/app.py): Khởi tạo FastAPI app và mount toàn bộ API routes với CORS middleware.
- [test_api.py](file:///Users/skyline/PROJECTS/face-capture/services/python-ai/src/tests/test_api.py): Pytest/Unittest suite kiểm thử toàn bộ 3 REST API endpoints.

---

## Kết Quả Verification

1. **Python Unit Tests**:
   ```bash
   .venv/bin/python -m unittest discover -s src/tests
   ```
   Output: `Ran 3 tests in 0.020s. OK` (100% endpoints passed).

2. **Workspace Unit Tests**:
   ```bash
   pnpm test
   ```
   Output: `pass 26, fail 0` (toàn bộ 26 unit tests thuộc tất cả các Node/TS packages đều passed).
