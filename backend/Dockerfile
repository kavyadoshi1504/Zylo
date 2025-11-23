FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,video

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv python3-dev \
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

# Use python3 as python and pip
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3 1 \
 && update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1

WORKDIR /app

# Copy requirements and install PyTorch (GPU) first
COPY backend/requirements.txt /app/requirements.txt

RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir torch==2.5.1+cu121 torchvision==0.20.1+cu121 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121

# Install remaining Python packages
RUN pip install --no-cache-dir -r /app/requirements.txt

# Install demucs (ensures GPU-capable demucs and its extras)
RUN pip install --no-cache-dir demucs

# Copy app code (docker-compose in dev will mount ./backend over /app so this is mainly for image builds)
COPY backend /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
