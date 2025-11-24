# ---------------------
# 1. Base Image
# ---------------------
FROM python:3.10-slim

# disable bytecode
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ---------------------
# 2. Install system deps
# ---------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---------------------
# 3. Install ONLY lightweight Python deps
# ---------------------
COPY requirements_fast.txt /app/requirements_fast.txt
RUN pip install --no-cache-dir -r /app/requirements_fast.txt

# ---------------------
# 4. App Files
# ---------------------
WORKDIR /app
COPY . .

# ---------------------
# 5. Startup Script
# ---------------------
RUN chmod +x /app/start.sh

CMD ["/bin/bash", "/app/start.sh"]
