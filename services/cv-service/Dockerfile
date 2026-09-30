# cv-service（06 §6）：低權限、無對外網路需求；Tesseract 供尺寸標註 OCR（缺席時尺度走校正）
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 cv
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
USER cv
EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "2", "--timeout-keep-alive", "5"]
