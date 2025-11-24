#!/bin/bash

echo "🔥 Starting ZYLO Backend..."

cd backend

# Start Uvicorn normally (no preload)
uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
