#!/bin/bash

echo "🔥 Starting ZYLO Backend..."

# Preload WhisperX (first run only)
echo "📥 Preloading WhisperX..."
python3 - << 'EOF'
import whisperx
whisperx.load_model("base", device="cpu")
EOF

# Preload Demucs (first run only)
echo "📥 Preloading Demucs..."
python3 - << 'EOF'
from demucs import pretrained
pretrained.get_model("mdx_extra")
EOF

echo "🚀 Launching Uvicorn..."
uvicorn backend.main:app --host 0.0.0.0 --port 8000
