# Use Python base image
FROM python:3.10-slim

# Create app directory
WORKDIR /app

# Install OS packages needed for ffmpeg, whisperX, demucs
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy backend folder
COPY backend ./backend

# Copy start.sh from project root
COPY start.sh ./start.sh

# Install Python requirements
RUN pip install --upgrade pip
RUN pip install -r backend/requirements.txt

# Make start.sh executable
RUN chmod +x start.sh

# Expose port
EXPOSE 8000

# Start the app
CMD ["bash", "start.sh"]
