FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=2
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# 构建时检查 OCR 模型与依赖，避免上线后才发现运行库缺失。
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)"
COPY index.html product-size.js browser-ocr.js server.py cloud_app.py ./
COPY vendor/onnx ./vendor/onnx
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 10000
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 2 --timeout 120 --access-logfile - cloud_app:application"]
