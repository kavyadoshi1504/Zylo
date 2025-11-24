# Use Python base image
FROM python:3.10-slim

# Create app directory
WORKDIR /app

# Install OS packages needed for ffmpeg (whisperX/demucs removed)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy backend folder EXACTLY
COPY backend/ /app/backend/

# Copy start.sh from root
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Make backend importable
ENV PYTHONPATH="/app/backend:${PYTHONPATH}"

# Install requirements
RUN pip install --upgrade pip
RUN pip install -r /app/backend/requirements.txt

EXPOSE 8000

CMD ["bash", "/app/start.sh"]
