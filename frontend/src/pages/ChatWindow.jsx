// ChatWindow.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { socket } from "./socket";

export default function ChatWindow({ username, space, setPage, setKaraokeData }) {
  // UI state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [users, setUsers] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingKaraoke, setLoadingKaraoke] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Audio + progress
  const audioRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const progressRef = useRef(null);
  const seekingRef = useRef(false);

  // ---------- Socket handlers (stable references) ----------
  const onChatMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const onLeaderboard = useCallback((data) => {
    setLeaderboard(data || []);
  }, []);

  const onUserList = useCallback((data) => {
    setUsers(data || []);
  }, []);

  const onAdminData = useCallback((data) => {
    setIsAdmin(Boolean(data?.isAdmin));
  }, []);

  const onSongNotFound = useCallback((data) => {
    // Backend should emit this when suggestion isn't in DB
    const reason = data?.reason || "Song not found in database";
    alert(`⚠️ ${reason}`);
  }, []);

  const onTopSongUpdate = useCallback((data) => {
    // optional: highlight top song / sync
    if (!data) return;
    const topSong = data.top_song;
    if (topSong && (!currentSong || topSong.id !== currentSong.id)) {
      setCurrentSong(topSong);
    }
  }, [currentSong]);

  const onUserKicked = useCallback((data) => {
    if (data.user === username) {
      alert("You have been removed from the space by the admin.");
      window.location.reload();
    }
  }, [username]);

  // song_playing: server tells clients which song to play (song object, audio_url)
  const onSongPlaying = useCallback((data) => {
    const song = data?.song;
    if (!song) return;
    setCurrentSong(song);
    setIsPlaying(true);

    // Set audio src and play if possible
    const audio = audioRef.current;
    if (!audio) return;

    if (song.audio_url) {
      // set src and try to play
      audio.src = song.audio_url;
      audio.currentTime = song.position || 0;
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          console.error("Audio play failed:", err);
          // still mark playing state as server said playing; user can manually start
        });
    }
  }, []);

  // song_paused: server tells clients to pause
  const onSongPaused = useCallback(() => {
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
  }, []);

  // song_status can be an alternate message, keep for backward compatibility
  const onSongStatus = useCallback((data) => {
    const { action, song } = data || {};
    if (action === "play") {
      onSongPlaying({ song });
    } else if (action === "pause") {
      onSongPaused();
    }
  }, [onSongPlaying, onSongPaused]);

  // song_finished: server notifies finished id (or full song object)
  const onSongFinished = useCallback((payload) => {
    // can be id or object
    const songId = typeof payload === "number" ? payload : payload?.id;
    if (songId == null) return;
    setLeaderboard((prev) => prev.filter((s) => s.id !== songId));
    // if the finished song was the current, pick next
    setCurrentSong((prev) => {
      if (!prev) return null;
      if (String(prev.id) === String(songId)) {
        // pick next
        const next = leaderboard && leaderboard.length > 0 ? leaderboard[0] : null;
        if (next) {
          // server should emit song_playing for next; but local fallback:
          socket.emit("start_playlist", { space, actor: username });
          return next;
        }
        setIsPlaying(false);
        return null;
      }
      return prev;
    });
  }, [leaderboard, space, username]);

  const onClearUserData = useCallback(({ user }) => {
    setMessages((prev) => prev.filter((m) => m.user !== user));
    setLeaderboard((prev) => prev.filter((s) => s.submitted_by !== user));
  }, []);

  // ---------- Register / deregister socket listeners ----------
  useEffect(() => {
    socket.on("chat_message", onChatMessage);
    socket.on("leaderboard", onLeaderboard);
    socket.on("user_list", onUserList);
    socket.on("admin_data", onAdminData);
    socket.on("song_playing", onSongPlaying);
    socket.on("song_paused", onSongPaused);
    socket.on("song_status", onSongStatus);
    socket.on("song_finished", onSongFinished);
    socket.on("user_kicked", onUserKicked);
    socket.on("clear_user_data", onClearUserData);
    socket.on("song_not_found", onSongNotFound);
    socket.on("top_song_update", onTopSongUpdate);

    // Request current space info when component mounts
    if (space) socket.emit("join_space", { space, user: username });

    return () => {
      socket.off("chat_message", onChatMessage);
      socket.off("leaderboard", onLeaderboard);
      socket.off("user_list", onUserList);
      socket.off("admin_data", onAdminData);
      socket.off("song_playing", onSongPlaying);
      socket.off("song_paused", onSongPaused);
      socket.off("song_status", onSongStatus);
      socket.off("song_finished", onSongFinished);
      socket.off("user_kicked", onUserKicked);
      socket.off("clear_user_data", onClearUserData);
      socket.off("song_not_found", onSongNotFound);
      socket.off("top_song_update", onTopSongUpdate);
    };
  }, [
    onChatMessage,
    onLeaderboard,
    onUserList,
    onAdminData,
    onSongPlaying,
    onSongPaused,
    onSongStatus,
    onSongFinished,
    onUserKicked,
    onClearUserData,
    onSongNotFound,
    onTopSongUpdate,
    space,
    username,
  ]);

  // ---------- Audio element event handlers ----------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      setPosition(audio.currentTime || 0);
    };

    const onTimeUpdate = () => {
      if (!seekingRef.current) {
        setPosition(audio.currentTime || 0);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      // Tell server that song ended
      if (currentSong) {
        socket.emit("song_finished", { space, song: currentSong });
      }
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [currentSong, space]);

  // ---------- Keep UI in sync when leaderboard changes (if current removed) ----------
  useEffect(() => {
    if (!currentSong) return;

    const stillExists = leaderboard.some((s) => String(s.id) === String(currentSong.id));
    if (!stillExists) {
      // If current song was removed by admin, auto-advance to next in leaderboard
      if (leaderboard.length > 0) {
        const next = leaderboard[0];
        setCurrentSong(next);
        // request server to play new top (server should broadcast)
        socket.emit("start_playlist", { space, actor: username });
      } else {
        // no songs left
        setCurrentSong(null);
        setIsPlaying(false);
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.src = ""; // clear src
        }
      }
    }
  }, [leaderboard, currentSong, space, username]);

  // ---------- Actions (emitters) ----------
  const sendMessage = () => {
    if (!input) return;
    socket.emit("send_message", { user: username, msg: input, space });
    setInput("");
  };

  const suggestSong = () => {
    const song = prompt("Enter song name or link:");
    if (song) {
      socket.emit("suggest_song", { user: username, song, space });
    }
  };

  const upvote = (id) => {
    socket.emit("upvote_song", { space, songId: id, user: username });
  };

  const deleteSong = (id) => {
    if (!window.confirm("Are you sure you want to delete this song?")) return;
    // optimistically remove from UI
    setLeaderboard((prev) => prev.filter((s) => s.id !== id));
    socket.emit("delete_song", { space, songId: id, user: username });
  };

  const kickUser = (userToKick) => {
    if (!window.confirm(`Remove ${userToKick} from this party?`)) return;
    socket.emit("kick_user", { space, user: userToKick, actor: username });
  };

  // Admin play/pause controls (UI)
  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (isPlaying) {
      socket.emit("pause_song", { space, actor: username });
      if (audio && !audio.paused) audio.pause();
      setIsPlaying(false);
    } else {
      socket.emit("play_song", { space, actor: username });
      if (audio && currentSong?.audio_url) {
        audio.src = currentSong.audio_url;
        audio
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.error("Play failed:", err);
            // keep server state as reference
          });
      }
      setIsPlaying(true);
    }
  };

  // Seek handling (admin-only). UI updates position immediately while seeking.
  const handleSeekStart = () => {
    seekingRef.current = true;
  };

  const handleSeekEnd = (newPosition) => {
    seekingRef.current = false;
    setPosition(newPosition);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = newPosition;
    }
    // notify server so others can sync
    socket.emit("seek_song", { space, actor: username, position: newPosition });
  };

  const onProgressClick = (e) => {
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newPos = (duration || 0) * ratio;
    if (!isAdmin) {
      // Optionally allow non-admin to jump locally only:
      const audio = audioRef.current;
      if (audio) audio.currentTime = newPos;
      setPosition(newPos);
      return;
    }
    handleSeekEnd(newPos);
  };

  // Karaoke generator (unchanged endpoint)
  const playKaraoke = async (songName) => {
    try {
      setLoadingKaraoke(true);
      const res = await fetch("http://localhost:8000/generate_karaoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song_name: songName }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Karaoke generation failed");
      }

      const data = await res.json();
      setKaraokeData({
        audioUrl: data.audio_url,
        vocalsUrl: data.vocals_url,
        lyrics: data.lyrics,
      });
      setPage("karaoke");
    } catch (err) {
      alert("Error generating karaoke: " + (err?.message || err));
    } finally {
      setLoadingKaraoke(false);
    }
  };

  // Utilities for formatting time
  const formatTime = (secs = 0) => {
    if (!isFinite(secs)) return "0:00";
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  // ---------- Render ----------
  return (
    <div className="flex h-screen bg-gradient-to-r from-purple-950 via-purple-900 to-black text-white">
      {/* LEFT: USERS LIST */}
      <div className="w-1/5 p-4 border-r border-purple-800">
        <h2 className="font-bold mb-2 text-purple-300 text-lg">Users</h2>
        <ul>
          {users.map((u) => (
            <li key={u} className="flex justify-between items-center py-1">
              <span className="text-gray-200">{u}</span>
              {isAdmin && u !== username && (
                <button
                  className="ml-2 text-xs px-3 py-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-xl shadow-md transform transition duration-200 hover:scale-105"
                  onClick={() => kickUser(u)}
                >
                  Kick
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* MIDDLE: CHAT */}
      <div className="w-3/5 p-4 flex flex-col">
        <h2 className="font-bold text-lg mb-2 text-purple-300">Chat in {space}</h2>

        <div className="flex-1 overflow-y-auto border border-purple-700 p-3 bg-gradient-to-b from-black to-purple-950 rounded space-y-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`mb-1 p-2 rounded ${
                m.user === "SYSTEM" ? "bg-purple-800 text-yellow-300 italic" : "bg-gray-900 text-white"
              }`}
            >
              <strong>{m.user}:</strong> {m.msg}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          <input
            className="border border-purple-700 bg-gray-950 text-white flex-1 p-2 rounded focus:outline-none focus:ring focus:ring-purple-600"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
          />
          <button
            className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white px-4 py-2 rounded-2xl shadow-lg transform transition duration-200 hover:scale-105"
            onClick={sendMessage}
          >
            Send
          </button>
          <button
            className="bg-gradient-to-r from-green-500 to-green-700 hover:from-green-600 hover:to-green-800 text-white px-4 py-2 rounded-2xl shadow-lg transform transition duration-200 hover:scale-105"
            onClick={suggestSong}
          >
            🎵 Suggest
          </button>
        </div>
      </div>

      {/* RIGHT: NOW PLAYING + LEADERBOARD */}
      <div className="w-1/5 p-4 border-l border-purple-800 bg-gradient-to-b from-black to-purple-950">
        <h2 className="font-bold mb-2 text-purple-300">Now Playing</h2>

        {/* Compact display: show short text when no song */}
        <div className="mb-4 bg-gray-900 p-2 rounded shadow-inner">
          <p className="font-semibold break-words">
            {currentSong ? currentSong.name : "No song"}
          </p>
          <p className="text-sm text-gray-400">
            {currentSong ? `by ${currentSong.submitted_by || "unknown"}` : ""}
          </p>

          {/* Progress / seek bar */}
          <div className="mt-2">
            <div
              ref={progressRef}
              className="relative h-3 bg-gray-800 rounded cursor-pointer"
              onClick={onProgressClick}
              style={{ userSelect: "none" }}
            >
              <div
                style={{
                  width: duration > 0 ? `${(position / duration) * 100}%` : "0%",
                }}
                className="absolute left-0 top-0 bottom-0 bg-purple-600 rounded"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-300 mt-1">
              <span>{formatTime(position)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="mt-2 flex gap-2">
              {/* Karaoke button */}
              <button
                className="flex-1 bg-yellow-400 text-black py-1 rounded-xl shadow-md"
                onClick={() => currentSong && playKaraoke(currentSong.name)}
                disabled={!currentSong || loadingKaraoke}
              >
                {loadingKaraoke ? "Generating..." : "🎤 Karaoke"}
              </button>

              {/* Play/Pause (admin only) */}
              {isAdmin && (
                <button
                  onClick={togglePlayPause}
                  className={`py-1 px-3 rounded-xl shadow-md ${
                    isPlaying ? "bg-red-600 text-white" : "bg-green-600 text-white"
                  }`}
                >
                  {isPlaying ? "⏸" : "▶️"}
                </button>
              )}
            </div>

            {/* Seek controls for admins (small step seek) */}
            {isAdmin && (
              <div className="mt-2 flex gap-2 text-xs">
                <button
                  className="px-2 py-1 bg-gray-800 rounded"
                  onClick={() => {
                    const newPos = Math.max(0, (position || 0) - 5);
                    handleSeekEnd(newPos);
                  }}
                >
                  -5s
                </button>
                <button
                  className="px-2 py-1 bg-gray-800 rounded"
                  onClick={() => {
                    const newPos = Math.min(duration || 0, (position || 0) + 5);
                    handleSeekEnd(newPos);
                  }}
                >
                  +5s
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Leaderboard */}
        <h2 className="font-bold mb-2 text-purple-300 mt-4">Leaderboard</h2>
        <ul>
          {leaderboard.map((s, i) => (
            <li
              key={s.id}
              className={`flex justify-between items-center mb-1 px-2 py-1 rounded shadow-md ${
                currentSong && s.id === currentSong.id ? "bg-purple-700 text-white" : "bg-gray-900"
              }`}
            >
              <div>
                <div className="font-medium">
                  {i + 1}. {s.name}
                </div>
                <div className="text-xs text-gray-300">by {s.submitted_by}</div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm">{s.votes}</span>
                <button
                  className="text-xs px-2 py-1 bg-yellow-400 rounded"
                  onClick={() => upvote(s.id)}
                >
                  👍
                </button>
                {isAdmin && (
                  <button
                    className="text-xs px-2 py-1 bg-red-600 text-white rounded"
                    onClick={() => deleteSong(s.id)}
                  >
                    ✖
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Hidden global audio element used for party playback */}
      <audio
        id="partyAudio"
        ref={audioRef}
        controls
        style={{ visibility: "hidden", width: 0, height: 0 }}
        preload="auto"
      />
    </div>
  );
}
