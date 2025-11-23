import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:8000"); // adjust backend URL

export default function PartyRoom({ roomName, username, setPage, setKaraokeData }) {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [queue, setQueue] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [messageInput, setMessageInput] = useState("");
  const [loadingKaraoke, setLoadingKaraoke] = useState(false);

  useEffect(() => {
    socket.emit("join_space", { space: roomName, user: username });

    socket.on("user_list", setUsers);
    socket.on("chat_message", (msg) => setMessages((prev) => [...prev, msg]));
    socket.on("leaderboard", setQueue);
    socket.on("current_song", setCurrentSong);

    return () => {
      socket.off("user_list");
      socket.off("chat_message");
      socket.off("leaderboard");
      socket.off("current_song");
    };
  }, [roomName, username]);

  const sendMessage = () => {
    if (!messageInput.trim()) return;
    socket.emit("send_message", { space: roomName, user: username, msg: messageInput });
    setMessageInput("");
  };

  // Suggest song
  const suggestSong = () => {
    const song = prompt("Enter song name or link:");
    if (song) {
      socket.emit("suggest_song", { space: roomName, user: username, song });
    }
  };

  // Upvote / downvote
  const voteSong = (songId) => {
    socket.emit("upvote_song", { space: roomName, songId, user: username });
  };

  // Play karaoke
  const playKaraoke = async (songName) => {
    try {
      setLoadingKaraoke(true);
      const res = await fetch("http://localhost:8000/generate_karaoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song_name: songName }),
      });
      if (!res.ok) throw new Error("Karaoke generation failed");
      const data = await res.json();
      setKaraokeData({
        audioUrl: data.audio_url,
        vocalsUrl: data.vocals_url,
        lyrics: data.lyrics,
      });
      setPage("karaoke");
    } catch (err) {
      alert("Error generating karaoke: " + err.message);
    } finally {
      setLoadingKaraoke(false);
    }
  };

  return (
    <div className="flex h-screen text-white bg-gradient-to-r from-purple-950 via-purple-900 to-black">
      {/* Left: Users */}
      <div className="w-1/5 p-4 border-r border-purple-800">
        <h2 className="text-lg font-bold text-purple-300 mb-2">Users</h2>
        <ul>
          {users.map((u) => (
            <li key={u} className="mb-1">{u}</li>
          ))}
        </ul>
      </div>

      {/* Middle: Chat + song input */}
      <div className="w-3/5 p-4 flex flex-col">
        <h2 className="text-lg font-bold text-purple-300 mb-2">Chat in {roomName}</h2>
        <div className="flex-1 overflow-y-auto border border-purple-700 p-3 bg-gradient-to-b from-black to-purple-950 rounded space-y-2">
          {messages.map((m, i) => (
            <div key={i} className="mb-1 p-2 rounded bg-gray-900">
              <strong>{m.user}:</strong> {m.msg}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            className="border border-purple-700 bg-gray-950 text-white flex-1 p-2 rounded focus:outline-none focus:ring focus:ring-purple-600"
            placeholder="Type your message..."
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          />
          <button
            className="bg-gradient-to-r from-purple-600 to-purple-800 px-4 py-2 rounded-2xl hover:scale-105 transform transition"
            onClick={sendMessage}
          >
            Send
          </button>
          <button
            className="bg-gradient-to-r from-green-500 to-green-700 px-4 py-2 rounded-2xl hover:scale-105 transform transition"
            onClick={suggestSong}
          >
            🎵 Suggest
          </button>
        </div>
      </div>

      {/* Right: Song queue + current song */}
      <div className="w-1/5 p-4 border-l border-purple-800 bg-gradient-to-b from-black to-purple-950">
        <h2 className="text-lg font-bold text-purple-300 mb-2">Now Playing</h2>
        {currentSong ? (
          <div className="mb-4 bg-gray-900 p-2 rounded shadow-inner">
            <p className="font-semibold">{currentSong.name}</p>
            <p className="text-sm text-gray-400">by {currentSong.submitted_by}</p>
            <button
              className="mt-2 w-full bg-gradient-to-r from-yellow-400 to-yellow-500 py-2 rounded-xl text-black hover:scale-105 transform transition disabled:opacity-50"
              onClick={() => playKaraoke(currentSong.name)}
              disabled={loadingKaraoke}
            >
              {loadingKaraoke ? "Generating..." : "🎤 Play Karaoke"}
            </button>
          </div>
        ) : (
          <p className="text-gray-500">No song playing</p>
        )}

        <h2 className="text-lg font-bold text-purple-300 mb-2">Song Queue</h2>
        <ul>
          {queue.map((song) => (
            <li key={song.id} className="flex justify-between items-center mb-1 bg-gray-900 px-2 py-1 rounded shadow-md">
              <span>{song.name} ({song.votes})</span>
              <div>
                <button onClick={() => voteSong(song.id)}>👍</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
