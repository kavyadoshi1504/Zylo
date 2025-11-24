# backend/main.py
import os
import io
import uvicorn
import socketio
import random
import mysql.connector
import mimetypes
from urllib.parse import quote_plus
from fastapi import FastAPI, Body, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import asyncio

# Google API / Auth
from google.oauth2 import service_account
from google.auth.transport.requests import Request as GoogleAuthRequest
import requests

# Local karaoke helper (ensure ensure_karaoke returns Drive preview URLs)
from karaoke.karaoke import ensure_karaoke, SongRequest

# ----------------------------
# CONFIG
# ----------------------------
# Railway DB (override via env if needed)
DB_HOST = os.getenv("RAILWAY_HOST", "shortline.proxy.rlwy.net")
DB_PORT = int(os.getenv("RAILWAY_PORT", 36509))
DB_USER = os.getenv("RAILWAY_USER", "root")
DB_PASS = os.getenv("RAILWAY_PASS", "IkhVcxwZGDffmOyXscESAdoSqSDepypx")
DB_NAME = os.getenv("RAILWAY_DB", "railway")

# Service account JSON (must be mounted into the container)
SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service_account.json")

# Temporary directory for any local caching (not required for Drive streaming)
TEMP_DIR = os.path.join(os.getcwd(), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

# Developer-uploaded local path (return as 'url' so your tool will transform it)
UPLOADED_SAMPLE_LOCAL_PATH = "/mnt/data/18766534-f1a8-48ce-8f2d-af442bd121af.png"

# ----------------------------
# APP + CORS + SOCKET.IO
# ----------------------------
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://zylo-y1ys.onrender.com",
        "*",
    ],
)
fastapi_app = FastAPI()

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # allow deployed frontend + local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = None  # assigned at bottom as ASGI app

# ----------------------------
# GLOBAL STATE (spaces)
# ----------------------------
spaces = {}
song_counter = 0

# ----------------------------
# DB HELPERS (Railway only)
# ----------------------------
def get_db_connection():
    """Connect to Railway MySQL. Throws on error so callers can handle."""
    return mysql.connector.connect(
        host=os.getenv("RAILWAY_HOST", DB_HOST),
        port=int(os.getenv("RAILWAY_PORT", DB_PORT)),
        user=os.getenv("RAILWAY_USER", DB_USER),
        password=os.getenv("RAILWAY_PASS", DB_PASS),
        database=os.getenv("RAILWAY_DB", DB_NAME),
        connection_timeout=10,
    )

def execute_read_query(query, params=None):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute(query, params or ())
        rows = cur.fetchall()
        return rows
    except mysql.connector.Error as e:
        print("SQL error:", e)
        return []
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

# ----------------------------
# GOOGLE DRIVE AUTH UTILS
# ----------------------------
def get_drive_access_token():
    """
    Uses the service account JSON to produce a short-lived bearer token for Drive API.
    """
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise FileNotFoundError(f"Service account file not found at '{SERVICE_ACCOUNT_FILE}'")
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=["https://www.googleapis.com/auth/drive"]
    )
    request = GoogleAuthRequest()
    creds.refresh(request)  # obtains access token
    if not creds.token:
        raise RuntimeError("Failed to obtain Drive access token from service account.")
    return creds.token

# ----------------------------
# DRIVE STREAMING PROXY
# ----------------------------
def extract_drive_file_id(drive_url: str):
    """
    Extract Drive file ID from URLs like:
      https://drive.google.com/file/d/<ID>/preview
      https://drive.google.com/file/d/<ID>/view
      https://drive.google.com/open?id=<ID>
      https://drive.google.com/uc?export=download&id=<ID>
    """
    if not drive_url:
        return None

    # Case 1: /d/<id>/
    if "/d/" in drive_url:
        try:
            return drive_url.split("/d/")[1].split("/")[0]
        except:
            pass

    # Case 2: ?id=<id>
    if "id=" in drive_url:
        try:
            return drive_url.split("id=")[1].split("&")[0]
        except:
            pass

    return None

async def stream_drive_file(file_id: str, range_header: str = None):
    """
    Stream bytes from Google Drive using HTTP 'alt=media' endpoint while forwarding Range header.
    Returns a FastAPI StreamingResponse prepared with proper headers/status.
    """
    token = get_drive_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    if range_header:
        # Forward range header to Drive (Google supports Range on media endpoint)
        headers["Range"] = range_header

    # Drive direct media URL
    url = f"https://www.googleapis.com/drive/v3/files/{quote_plus(file_id)}?alt=media"

    # Stream request to Drive
    session = requests.Session()
    resp = session.get(url, headers=headers, stream=True, timeout=30)

    if resp.status_code in (401, 403):
        # Permission or auth issue
        raise HTTPException(status_code=resp.status_code, detail=f"Drive API error: {resp.status_code}")
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Drive file not found")

    # Determine response status & headers to set for client
    status_code = 206 if resp.status_code == 206 or ("Range" in headers and resp.status_code == 206) else 200

    content_range = resp.headers.get("Content-Range")  # present for partial responses
    content_length = resp.headers.get("Content-Length")
    # For MP3:
    mime_type = "audio/mpeg"

    # Prepare streaming generator to yield chunks as they arrive from Drive
    def iter_chunks(response, chunk_size=256 * 1024):
        try:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if not chunk:
                    continue
                yield chunk
        finally:
            try:
                response.close()
                session.close()
            except Exception:
                pass

    headers_out = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
    }
    if content_length:
        headers_out["Content-Length"] = content_length
    if content_range:
        headers_out["Content-Range"] = content_range

    return StreamingResponse(iter_chunks(resp), status_code=status_code, headers=headers_out, media_type=mime_type)

async def progress_sync_task():
    while True:
        try:
            for space, info in spaces.items():
                song = info.get("current_song")
                if info.get("is_playing") and song:
                    song.setdefault("position", 0)
                    song["position"] += 1  # +1 sec

                    await sio.emit(
                        "progress",
                        {"time": song["position"]},
                        room=space
                    )
        except:
            pass

        await asyncio.sleep(1)  # ping every second

# ----------------------------
# /play/<song_id> endpoint (streaming)
# ----------------------------
@fastapi_app.get("/play/{song_id}")
async def play_song(song_id: int, request: Request):
    """
    Streams MP3 stored on Google Drive. No redirect.
    Connects browser -> backend -> Google Drive.
    Supports Range.
    """
    # 1) Lookup audio_url in DB
    rows = execute_read_query(
        "SELECT audio_url FROM songs WHERE id = %s",
        (song_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Song not found")

    audio_url = rows[0].get("audio_url")
    if not audio_url:
        raise HTTPException(status_code=404, detail="No audio_url stored")

    # 2) Extract file id
    file_id = extract_drive_file_id(audio_url)
    if not file_id:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Drive preview URL: {audio_url}"
        )

    # 3) Handle Range header
    range_header = request.headers.get("range")

    # 4) Stream from Drive through backend proxy
    return await stream_drive_file(file_id, range_header)

# ----------------------------
# /generate_karaoke endpoint (unchanged)
# ----------------------------
@fastapi_app.post("/generate_karaoke")
async def generate_karaoke_endpoint(req: SongRequest = Body(...)):
    try:
        raw_name = req.song_name or ""
        normalized = raw_name.strip().lower()

        if not normalized:
            raise HTTPException(status_code=400, detail="Song name cannot be empty")

        # internally use normalized version to avoid duplicates
        karaoke_info = ensure_karaoke(normalized)

        # but frontend gets original display name
        karaoke_info["display_name"] = raw_name.strip()

        return karaoke_info

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ----------------------------
# /uploaded_sample endpoint (developer instruction)
# returns the local path as 'url' so your tool will transform it to a URL
# ----------------------------
@fastapi_app.get("/uploaded_sample")
async def uploaded_sample():
    return {"url": UPLOADED_SAMPLE_LOCAL_PATH}

# ----------------------------
# Browse / search endpoints (unchanged, use Railway)
# ----------------------------
@fastapi_app.get("/artists")
async def get_artists():
    rows = execute_read_query("""
        SELECT DISTINCT TRIM(artist_name) AS artist_name
        FROM songs 
        WHERE artist_name IS NOT NULL AND artist_name <> ''
        ORDER BY artist_name ASC
    """)
    return [r["artist_name"] for r in rows]

@fastapi_app.get("/albums/{artist_name}")
async def get_albums(artist_name: str):
    rows = execute_read_query("""
        SELECT DISTINCT TRIM(album_name) AS album_name
        FROM songs
        WHERE LOWER(TRIM(artist_name)) = LOWER(%s)
        ORDER BY album_name ASC
    """, (artist_name.strip(),))
    
    return [r["album_name"] for r in rows]

@fastapi_app.get("/songs/{artist_name}/{album_name}")
async def get_songs(artist_name: str, album_name: str):
    rows = execute_read_query("""
        SELECT id, title
        FROM songs
        WHERE LOWER(TRIM(artist_name)) = LOWER(%s)
        AND LOWER(TRIM(album_name)) = LOWER(%s)
        ORDER BY title ASC
    """, (artist_name.strip(), album_name.strip()))
    
    return rows

# ----------------------------
# Socket.IO + spaces logic (kept as-is per request)
# ----------------------------
@sio.event
async def connect(sid, environ):
    print(f"[socket] connect: {sid}")

@sio.event
async def disconnect(sid):
    print(f"[socket] disconnect: {sid}")
    # best-effort cleanup
    for space_name, data in list(spaces.items()):
        users = data.get("users", [])
        if sid in users:
            users.remove(sid)
            await sio.emit("user_list", users, room=space_name)

def _ensure_space_entry(space_name, creator=None):
    if space_name not in spaces:
        spaces[space_name] = {
            "users": [],
            "leaderboard": [],
            "current_song": None,
            "admins": [creator] if creator else [],
            "votes": {},
            "is_playing": False,
        }

@sio.on("get_spaces")
async def get_spaces(sid):
    await sio.emit("spaces_list", list(spaces.keys()), room=sid)

@sio.on("create_space")
async def create_space(sid, data):
    space_name = data.get("space")
    user = data.get("user")
    if not space_name or not user:
        await sio.emit("error", {"msg": "create_space missing params"}, room=sid)
        return
    if space_name not in spaces:
        spaces[space_name] = {"users": [], "leaderboard": [], "current_song": None, "admins": [user], "votes": {}, "is_playing": False}
    if user not in spaces[space_name]["users"]:
        spaces[space_name]["users"].append(user)
    await sio.enter_room(sid, space_name)
    await sio.emit("spaces_list", list(spaces.keys()))
    await sio.emit("user_list", spaces[space_name]["users"], room=space_name)
    await sio.emit("leaderboard", spaces[space_name]["leaderboard"], room=space_name)
    await sio.emit("current_song", spaces[space_name]["current_song"], room=sid)
    await sio.emit("admin_data", {"isAdmin": True}, room=sid)

@sio.on("join_space")
async def join_space(sid, data):
    space = data.get("space")
    user = data.get("user")
    if not space or not user:
        await sio.emit("error", {"msg": "join_space missing space/user"}, room=sid)
        return
    if space not in spaces:
        await sio.emit("error", {"msg": f"Space {space} does not exist"}, room=sid)
        return
    if user not in spaces[space]["users"]:
        spaces[space]["users"].append(user)
    await sio.enter_room(sid, space)
    await sio.emit("user_list", spaces[space]["users"], room=space)
    await sio.emit("leaderboard", spaces[space]["leaderboard"], room=space)
    await sio.emit("current_song", spaces[space]["current_song"], room=sid)
    is_admin = user in spaces[space].get("admins", [])
    await sio.emit("admin_data", {"isAdmin": is_admin}, room=sid)

@sio.on("send_message")
async def send_message(sid, data):
    space = data.get("space")
    user = data.get("user")
    msg_text = data.get("msg")
    if not space or not user or msg_text is None:
        return
    msg = {"user": user, "msg": msg_text}
    await sio.emit("chat_message", msg, room=space)

@sio.on("suggest_song")
async def suggest_song(sid, data):
    global song_counter

    space = data.get("space")
    song_raw = data.get("song")
    user = data.get("user")

    if not space or not song_raw or not user:
        return

    song_name = song_raw.strip().lower()

    # ---- (1) Check DB for exact song match, case-insensitive ----
    try:
        rows = execute_read_query(
            "SELECT id, title, artist_name FROM songs WHERE LOWER(title) = %s LIMIT 1",
            (song_name,)
        )
    except Exception as e:
        print("DB lookup error:", e)
        await sio.emit("chat_message",
                       {"user": "SYSTEM", "msg": f"❌ DB error while searching for '{song_raw}'."},
                       room=space)
        return

    if not rows:
        # ---- (2) Song not found → send error ----
        await sio.emit("song_not_found",
                       {"reason": f"Song '{song_raw}' not found in database."},
                       to=sid)
        return

    # ---- (3) Song found ----
    db_song = rows[0]
    proper_title = db_song["title"]
    proper_artist = db_song["artist_name"]

    space_entry = spaces.setdefault(space, {
        "users": [],
        "leaderboard": [],
        "current_song": None,
        "admins": [],
        "votes": {},
        "is_playing": False,
    })

    # 1️⃣ This is the FIX — use song_name, not undefined "song"
    rows = execute_read_query(
        "SELECT id FROM songs WHERE LOWER(title) = %s LIMIT 1",
        (song_name,)
    )

    if not rows:
        await sio.emit("song_not_found",
                       {"reason": f"'{song_raw}' is not in the database"},
                       to=sid)
        return

    song_counter += 1

    song_obj = {
        "id": song_counter,
        "name": proper_title,
        "artist": proper_artist,
        "votes": 0,
        "submitted_by": user,
        "db_song_id": db_song["id"],
    }

    # ---- (4) Add to leaderboard ----
    space_entry["leaderboard"].append(song_obj)
    space_entry["votes"][str(song_obj["id"])] = set()

    # sort by votes
    space_entry["leaderboard"].sort(key=lambda s: -s["votes"])

    # ---- (5) Send updates ----
    await sio.emit("leaderboard", space_entry["leaderboard"], room=space)
    await sio.emit("chat_message",
                   {"user": user, "msg": f"🎶 Suggested: {proper_title}"},
                   room=space)

    # ---- (6) Update top song UI ----
    top_song = space_entry["leaderboard"][0] if space_entry["leaderboard"] else None
    await sio.emit("top_song_update", {"top_song": top_song}, room=space)

@sio.on("upvote_song")
async def upvote_song(sid, data):
    space = data.get("space")
    song_id = data.get("songId")
    user = data.get("user")
    if not space or song_id is None or not user:
        return
    if space not in spaces:
        return
    song_id_str = str(song_id)
    spaces[space].setdefault("votes", {})
    spaces[space]["votes"].setdefault(song_id_str, set())
    if user in spaces[space]["votes"][song_id_str]:
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"⚠️ {user}, you already upvoted this song."}, room=space)
        return
    song_name = None
    for s in spaces[space]["leaderboard"]:
        if str(s["id"]) == song_id_str:
            s["votes"] += 1
            song_name = s["name"]
            break
    if not song_name:
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"❌ Song ID {song_id} not found in leaderboard."}, room=space)
        return
    spaces[space]["votes"][song_id_str].add(user)
    spaces[space]["leaderboard"].sort(key=lambda x: -x["votes"])
    await sio.emit("leaderboard", spaces[space]["leaderboard"], room=space)
    await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"👍 {user} upvoted '{song_name}'"}, room=space)
    if spaces[space].get("is_playing"):
        top_song = spaces[space]["leaderboard"][0] if spaces[space]["leaderboard"] else None
        current_song = spaces[space]["current_song"]
        if top_song and current_song and top_song["id"] != current_song["id"]:
            spaces[space]["current_song"] = top_song
            await sio.emit("current_song", top_song, room=space)
            await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"🔥 '{top_song['name']}' took the lead and is now playing!"}, room=space)

@sio.on("start_playlist")
async def start_playlist(sid, data):
    space = data.get("space"); actor = data.get("actor")
    if not space or not actor: return
    if space not in spaces: return
    if actor not in spaces[space].get("admins", []):
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"❌ {actor} is not an admin and cannot start the playlist."}, room=space)
        return
    leaderboard = spaces[space].get("leaderboard", [])
    if not leaderboard:
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": "⚠️ No songs to start playing!"}, room=space)
        return
    top_song = leaderboard[0]
    spaces[space]["current_song"] = top_song
    spaces[space]["is_playing"] = True
    await sio.emit("current_song", top_song, room=space)
    await sio.emit("song_playing", {"song": top_song}, room=space)
    await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"▶️ '{top_song['name']}' is now playing!"}, room=space)

@sio.on("delete_song")
async def delete_song(sid, data):
    space = data.get("space")
    song_id = data.get("songId")
    actor = data.get("actor")

    if not space or song_id is None:
        return

    # admin check
    if actor not in spaces.get(space, {}).get("admins", []):
        await sio.emit(
            "chat_message",
            {"user": "SYSTEM", "msg": f"⛔ {actor} is not authorized to delete songs."},
            room=space
        )
        return

    # Get current playlist & playing song
    leaderboard = spaces[space].get("leaderboard", [])
    current_song = spaces[space].get("current_song")

    # 1 — Remove song
    spaces[space]["leaderboard"] = [
        s for s in leaderboard if str(s["id"]) != str(song_id)
    ]
    # 2️⃣ If deleted song == current song → choose next or stop
    cur = spaces[space].get("current_song")

    if cur and str(cur["id"]) == str(song_id):
        lb = spaces[space]["leaderboard"]

        if lb:
            # Set new current and broadcast
            next_song = lb[0]
            spaces[space]["current_song"] = next_song
            spaces[space]["is_playing"] = True

            await sio.emit("current_song", next_song, room=space)
            await sio.emit("song_playing", {"song": next_song}, room=space)
            await sio.emit("chat_message",
                        {"user": "SYSTEM",
                            "msg": f"⏭️ '{next_song['name']}' is now playing"},
                        room=space)
        else:
            # No songs left
            spaces[space]["current_song"] = None
            spaces[space]["is_playing"] = False

            await sio.emit("current_song", None, room=space)
            await sio.emit("chat_message",
                        {"user": "SYSTEM",
                            "msg": "Playlist ended"},
                        room=space)

    spaces[space]["votes"].pop(str(song_id), None)

    # 2 — Was this the currently playing song?
    deleted_current = (
        current_song is not None and str(current_song["id"]) == str(song_id)
    )

    # 3 — If currently playing song was removed → auto-play next
    if deleted_current:
        new_list = spaces[space]["leaderboard"]

        if new_list:
            # Pick next in queue
            next_song = new_list[0]
            spaces[space]["current_song"] = next_song
            spaces[space]["is_playing"] = True

            # Must attach correct audio url
            db_song_id = next_song.get("db_song_id")
            next_song["audio_url"] = f"/play/{db_song_id}" if db_song_id else None

            await sio.emit("current_song", next_song, room=space)
            await sio.emit("song_playing", {"song": next_song}, room=space)
            await sio.emit(
                "chat_message",
                {"user": "SYSTEM", "msg": f"⏭️ Next track: {next_song['name']}"},
                room=space,
            )
        else:
            # Queue empty — stop everything
            spaces[space]["current_song"] = None
            spaces[space]["is_playing"] = False

            await sio.emit("current_song", None, room=space)
            await sio.emit("song_playing", {"song": None}, room=space)
            await sio.emit(
                "chat_message",
                {"user": "SYSTEM", "msg": "🛑 Queue empty — nothing to play."},
                room=space,
            )

    # 4 — Refresh playlist UI
    await sio.emit("leaderboard", spaces[space]["leaderboard"], room=space)

    # 5 — Show delete message
    await sio.emit(
        "chat_message",
        {"user": "SYSTEM", "msg": f"🗑️ {actor} removed a song."},
        room=space,
    )

@sio.on("kick_user")
async def kick_user(sid, data):
    space = data.get("space"); user_to_kick = data.get("user"); actor = data.get("actor")
    if not space or not user_to_kick: return
    if actor not in spaces.get(space, {}).get("admins", []):
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"⛔ {actor} is not authorized to remove users."}, room=space)
        return
    if user_to_kick in spaces[space]["users"]:
        spaces[space]["users"].remove(user_to_kick)
        await sio.emit("user_kicked", {"user": user_to_kick}, room=space)
        await sio.emit("user_list", spaces[space]["users"], room=space)
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"🔨 {user_to_kick} was removed by {actor}"}, room=space)

@sio.on("play_song")
async def play_song_event(sid, data):
    """
    Admin triggers playback.
    Now uses db_song_id directly (no LIKE search).
    Ensures proper Now Playing updates & empty-state handling.
    """
    space = data.get("space")
    actor = data.get("actor")

    if not space or not actor:
        return

    if space not in spaces:
        return

    # admin check
    if actor not in spaces[space].get("admins", []):
        await sio.emit("chat_message",
                       {"user": "SYSTEM",
                        "msg": f"❌ {actor} is not an admin and cannot start songs."},
                       room=space)
        return

    leaderboard = spaces[space].get("leaderboard", [])
    if not leaderboard:
        # No songs at all
        spaces[space]["current_song"] = None
        spaces[space]["is_playing"] = False

        await sio.emit("current_song", None, room=space)
        await sio.emit("song_playing", {"song": None}, room=space)
        await sio.emit("chat_message",
                       {"user": "SYSTEM", "msg": "🚫 No songs available to play."},
                       room=space)
        return

    # choose the top song unless one already chosen
    if not spaces[space].get("current_song"):
        spaces[space]["current_song"] = leaderboard[0]

    spaces[space]["is_playing"] = True
    current_song = spaces[space]["current_song"]

    # This is the DB song id we stored earlier
    db_song_id = current_song.get("db_song_id")
    song_name = current_song["name"]

    if not db_song_id:
        await sio.emit("chat_message",
                       {"user": "SYSTEM",
                        "msg": f"❌ Cannot play '{song_name}', missing DB ID."},
                       room=space)
        return

    # Generate streaming URL
    # front-end audio tag will use http://server/play/<id>
    audio_url = f"/play/{db_song_id}"

    # attach the correct URL for clients
    current_song["audio_url"] = audio_url

    # Broadcast updated "Now Playing"
    await sio.emit("song_playing", {"song": current_song}, room=space)
    await sio.emit("current_song", current_song, room=space)

    await sio.emit("chat_message",
                   {"user": "SYSTEM", "msg": f"▶️ Now playing '{song_name}'"},
                   room=space)

@sio.on("pause_song")
async def pause_song_event(sid, data):
    space = data.get("space"); actor = data.get("actor")
    if not space or not actor: return
    if actor not in spaces.get(space, {}).get("admins", []):
        await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"⛔ {actor} not authorized to pause."}, room=space)
        return
    spaces[space]["is_playing"] = False
    await sio.emit("song_paused", {"actor": actor}, room=space)
    await sio.emit("chat_message", {"user": "SYSTEM", "msg": f"⏸️ Playback paused by {actor}"}, room=space)

@sio.on("song_finished")
async def song_finished(sid, data):
    space = data.get("space")
    finished_song = data.get("song")
    if not space or not finished_song:
        return

    # Remove from leaderboard
    spaces[space]["leaderboard"] = [
        s for s in spaces[space]["leaderboard"]
        if s["id"] != finished_song["id"]
    ]

    lb = spaces[space]["leaderboard"]

    # If songs remain → play next
    if lb:
        next_song = lb[0]
        spaces[space]["current_song"] = next_song
        spaces[space]["is_playing"] = True

        await sio.emit("current_song", next_song, room=space)
        await sio.emit("song_playing", {"song": next_song}, room=space)
    else:
        # No songs left
        spaces[space]["current_song"] = None
        spaces[space]["is_playing"] = False
        await sio.emit("current_song", None, room=space)

@sio.on("seek")
async def seek_event(sid, data):
    """
    User wants to jump to a new timestamp.
    Only admins can control seeking.
    """
    space = data.get("space")
    actor = data.get("actor")
    new_time = data.get("time")  # in seconds (float)

    if not space or new_time is None:
        return

    # admin check
    if actor not in spaces.get(space, {}).get("admins", []):
        await sio.emit(
            "chat_message",
            {"user": "SYSTEM", "msg": "⛔ Only admins can seek."},
            room=sid
        )
        return

    current_song = spaces[space].get("current_song")
    if not current_song:
        return

    # store in backend so new users get synced
    current_song["position"] = float(new_time)

    # broadcast seek update
    await sio.emit(
        "seek_update",
        {"time": float(new_time)},
        room=space
    )

    await sio.emit(
        "chat_message",
        {"user": "SYSTEM", "msg": f"⏩ Skipped to {int(new_time)}s"},
        room=space
    )

@sio.on("get_current_song_position")
async def get_current_song_position(sid, data):
    space = data.get("space")

    song = spaces.get(space, {}).get("current_song")
    if not song:
        await sio.emit("seek_update", {"time": 0}, room=sid)
        return

    await sio.emit("seek_update", {"time": song.get("position", 0)}, room=sid)

# ----------------------------
# AUTOPATH / RECOMMENDER (unchanged)
# ----------------------------
@fastapi_app.post("/autopath_recommend")
async def autopath_recommend(data: dict):
    song_id = data.get("song_id")
    if not song_id:
        raise HTTPException(status_code=400, detail="Missing song_id")
    tag_q = """
        SELECT t.tag_name
        FROM song_tags st
        JOIN tags t ON st.tag_id = t.tag_id
        WHERE st.song_id = %s
    """
    tags = [r["tag_name"] for r in execute_read_query(tag_q, (song_id,))]
    if not tags:
        raise HTTPException(status_code=404, detail="No tags found")
    placeholders = ", ".join(["%s"] * len(tags))
    sql = f"""
        SELECT s.id, s.title, s.artist_name, COUNT(st.tag_id) AS match_count
        FROM songs s
        JOIN song_tags st ON s.id = st.song_id
        JOIN tags t ON st.tag_id = t.tag_id
        WHERE t.tag_name IN ({placeholders}) AND s.id != %s AND s.audio_url IS NOT NULL
        GROUP BY s.id, s.title, s.artist_name
        ORDER BY match_count DESC, RAND()
        LIMIT 10
    """
    args = tags + [song_id]
    recs = execute_read_query(sql, tuple(args))
    next_up = random.choice(recs) if recs else {}
    return JSONResponse({"tags_used": tags, "next_up": next_up, "playlist": recs})

# ----------------------------
# FINAL ASGI APP
# ----------------------------
app = socketio.ASGIApp(sio, fastapi_app)

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(progress_sync_task())
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
