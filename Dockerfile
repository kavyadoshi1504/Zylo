# backend/Dockerfile (CPU-friendly)
FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# system deps for audio libraries, ffmpeg and soundfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libglib2.0-0 \
    libnss3 \
    libasound2 \
    build-essential \
    libffi-dev \
    git \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy app code
COPY backend /app

EXPOSE 8000

# Render uses $PORT env; keep CMD generic. Render will set PORT env automatically.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
