echo "🔥 Starting ZYLO..."

echo "📦 Installing WhisperX & Demucs at runtime (cached)..."
pip install whisperx==3.7.4 demucs==4.0.0 --no-cache-dir

echo "📥 Preloading WhisperX models..."
python - << 'EOF'
import whisperx
model = whisperx.load_model("base", device="cpu")
EOF

echo "📥 Preloading Demucs..."
from demucs import pretrained
pretrained.get_model("mdx_extra")
EOF

echo "🚀 Running backend..."
uvicorn main:app --host 0.0.0.0 --port 8000
