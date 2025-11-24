# Use Python 3.10
FROM python:3.10-slim

# Create working directory
WORKDIR /app

# Install system dependencies (ffmpeg required for audio)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy backend folder (contains main.py, karaoke/, requirements.txt, etc.)
COPY backend ./backend

# Copy the start.sh from project root
COPY start.sh ./start.sh

# Ensure Python sees backend as a module
ENV PYTHONPATH="/app/backend:${PYTHONPATH}"

# Upgrade pip
RUN pip install --upgrade pip

# Install Python dependencies
RUN pip install -r backend/requirements.txt

# Make start.sh executable
RUN chmod +x start.sh

# Expose backend port
EXPOSE 8000

# Start FastAPI server
CMD ["bash", "start.sh"]
