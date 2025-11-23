import os
import re
import json
import shutil
import logging
import argparse
from pathlib import Path
from datetime import datetime

import mysql.connector
import torch
import torchaudio

from demucs import pretrained
from demucs.apply import apply_model

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
import io

import whisperx
# ============================================
# FASTAPI WRAPPER FOR MAIN.PY
# ============================================
from pydantic import BaseModel

# ============================================
# CONFIGURATION
# ============================================
SERVICE_ACCOUNT_FILE = "service_account.json"

# Drive folder IDs
DRIVE_ACCOMP_FOLDER = "1W849B5Sfbx9i1kbPPjokXzCOmndheYv3"
DRIVE_LYRICS_FOLDER = "1HBNEdOFo5pgTuq_6A8KJ3jwQfhFWbch8"
DRIVE_VOCALS_FOLDER = "1Sn6vUFkmmYCEx2Qk3ZALU9rOBbIm6GsZ"

# Railway DB config
DB_HOST = "shortline.proxy.rlwy.net"
DB_PORT = 36509
DB_USER = "root"
DB_PASS = "IkhVcxwZGDffmOyXscESAdoSqSDepypx"
DB_NAME = "railway"

# Temporary working directory
TMP = Path("temp_karaoke")
TMP.mkdir(exist_ok=True)

# For testing without changing DB or Drive
DRY_RUN = False


# ============================================
# LOGGING
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("karaoke")


# ============================================
# GOOGLE DRIVE
# ============================================
def drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/drive"]
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


gdrive = drive_service()


def download_from_drive(file_id, out_path):
    """Downloads a Drive file to a local path safely."""
    log.info("Downloading from Drive: %s", file_id)
    request = gdrive.files().get_media(fileId=file_id)
    fh = io.FileIO(out_path, "wb")
    downloader = MediaIoBaseDownload(fh, request)

    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            log.info("Download %d%%", int(status.progress() * 100))


def upload_to_drive(local_path, filename, folder_id, mime):
    """Uploads a file to Drive & returns (file_id, preview_url)."""
    if DRY_RUN:
        return f"DRY-{filename}", f"https://drive.google.com/file/d/DRY-{filename}/preview"

    metadata = {"name": filename, "parents": [folder_id]}
    media = MediaFileUpload(local_path, mimetype=mime)

    file = gdrive.files().create(
        body=metadata, media_body=media, fields="id"
    ).execute()

    file_id = file["id"]

    # Make public
    gdrive.permissions().create(
        fileId=file_id,
        body={"role": "reader", "type": "anyone"}
    ).execute()

    return file_id, f"https://drive.google.com/file/d/{file_id}/preview"


# ============================================
# DATABASE
# ============================================
def db_conn():
    return mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME
    )


# ============================================
# GPU DEMUCS SEPARATION (MDX23)
# ============================================
def demucs_separate(audio_path, device):
    """
    Returns: (vocals_path, accompaniment_path)
    """
    log.info("Loading MDX23 Demucs model…")
    model = pretrained.get_model("mdx_extra")
    model.to(device)

    wav, sr = torchaudio.load(audio_path)

    # Convert mono → stereo if needed
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)

    wav = wav.to(device)

    log.info("Running Demucs separation on GPU…")
    sources = apply_model(model, wav.unsqueeze(0), device=device)[0]

    vocals = sources[0].cpu()
    accomp = (sources[1] + sources[2] + sources[3]).cpu()

    vocals_path = str(TMP / "vocals.wav")
    accomp_path = str(TMP / "accompaniment.wav")

    torchaudio.save(vocals_path, vocals, sr)
    torchaudio.save(accomp_path, accomp, sr)

    return vocals_path, accomp_path


# ============================================
# WHISPERX ALIGNMENT (GPU)
# ============================================
def align_lyrics_whisperx(vocals_path, device):
    """
    Returns: (lyrics_json_path, lines)
    """
    log.info("Loading WhisperX model on GPU (%s)…", device)
    model = whisperx.load_model("base", device=device)

    log.info("Transcribing vocals…")
    result = model.transcribe(vocals_path)
    segments = result["segments"]

    log.info("Loading alignment model…")
    align_model, metadata = whisperx.load_align_model(
        language_code="en",
        device=device
    )

    log.info("Performing forced alignment…")
    alignment = whisperx.align(
        segments,
        align_model,
        metadata,
        vocals_path,
        device=device
    )

    words = alignment["word_segments"]

    # Group words into lyric lines
    lines = []
    curr = []

    for w in words:
        word = w["text"]
        start = round(float(w["start"]), 3)
        end = round(float(w["end"]), 3)

        curr.append({"text": word, "start": start, "end": end})

        # Break line on punctuation
        if re.search(r"[.,!?;:]$", word):
            lines.append(curr)
            curr = []

    if curr:
        lines.append(curr)

    lyrics_path = TMP / "lyrics.json"
    with open(lyrics_path, "w", encoding="utf-8") as f:
        json.dump({"lines": lines}, f, indent=2)

    return str(lyrics_path), lines


# ============================================
# FULL PROCESSING PIPELINE
# ============================================
def process_song(song_name, device):
    """
    Full pipeline:
      1. Fetch song from DB
      2. Resolve audio path (local or Drive)
      3. Demucs separation on GPU
      4. WhisperX alignment on GPU
      5. Upload accompaniment/vocals/lyrics to Drive
      6. Save metadata in DB
    """

    conn = db_conn()
    cur = conn.cursor(dictionary=True)

    cur.execute("""
        SELECT id, title, audio_url
        FROM songs
        WHERE LOWER(title) LIKE %s
        LIMIT 1
    """, (f"%{song_name.lower()}%",))

    song = cur.fetchone()
    if not song:
        raise Exception(f"Song '{song_name}' not found in DB.")

    song_id = song["id"]
    title = song["title"]
    audio_url = song["audio_url"]

    log.info("Song found: %s (%s)", title, song_id)

    # ------------------------------------
    # GET LOCAL AUDIO INPUT
    # ------------------------------------
    local_input_path = TMP / "input.mp3"

    if "drive.google.com" in audio_url:
        file_id = audio_url.split("/d/")[1].split("/")[0]
        download_from_drive(file_id, local_input_path)
    else:
        shutil.copy(audio_url, local_input_path)

    # ------------------------------------
    # 1) Demucs (GPU)
    # ------------------------------------
    vocals_path, accomp_path = demucs_separate(str(local_input_path), device)

    # ------------------------------------
    # 2) WhisperX Alignment (GPU)
    # ------------------------------------
    lyrics_json_path, lines = align_lyrics_whisperx(vocals_path, device)

    # ------------------------------------
    # 3) Upload to Drive
    # ------------------------------------
    clean_title = re.sub(r"[^\w]+", "_", title)

    vocals_url = upload_to_drive(
        vocals_path, f"{clean_title}_vocals.wav",
        DRIVE_VOCALS_FOLDER, "audio/wav"
    )[1]

    accomp_url = upload_to_drive(
        accomp_path, f"{clean_title}_accompaniment.wav",
        DRIVE_ACCOMP_FOLDER, "audio/wav"
    )[1]

    lyrics_url = upload_to_drive(
        lyrics_json_path, f"{clean_title}_lyrics.json",
        DRIVE_LYRICS_FOLDER, "application/json"
    )[1]

    # ------------------------------------
    # 4) Save to Karaoke DB Table
    # ------------------------------------
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    sql = """
        INSERT INTO karaoke_assets
        (song_id, vocals_url, accompaniment_url, lyrics_url, processed, created_at, updated_at)
        VALUES (%s, %s, %s, %s, 1, %s, %s)
        ON DUPLICATE KEY UPDATE
            vocals_url = VALUES(vocals_url),
            accompaniment_url = VALUES(accompaniment_url),
            lyrics_url = VALUES(lyrics_url),
            updated_at = VALUES(updated_at)
    """

    if not DRY_RUN:
        cur.execute(sql, (song_id, vocals_url, accomp_url, lyrics_url, now, now))
        conn.commit()

    cur.close()
    conn.close()

    return {
        "song_id": song_id,
        "title": title,
        "vocals_url": vocals_url,
        "accompaniment_url": accomp_url,
        "lyrics_url": lyrics_url,
        "sample_lyrics": lines[:1]
    }

class SongRequest(BaseModel):
    song_name: str


def ensure_karaoke(song_name: str):
    """
    FastAPI wrapper used by main.py
    - case-insensitive match
    - returns accompaniment, vocals, lyrics
    """

    if not song_name:
        raise ValueError("Song name is empty")

    # GPU if available
    device = "cuda" if torch.cuda.is_available() else "cpu"

    # Use the full pipeline
    result = process_song(song_name.lower(), device)

    return {
        "song_id": result["song_id"],
        "title": result["title"],
        "vocals_url": result["vocals_url"],
        "accompaniment_url": result["accompaniment_url"],
        "lyrics_url": result["lyrics_url"],
        "sample_lyrics": result["sample_lyrics"],
    }
