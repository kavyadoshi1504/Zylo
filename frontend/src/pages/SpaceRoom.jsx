import { useEffect, useState } from "react";
import { socket } from "./socket";

export default function SpaceRoom({ room, username }) {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [songs, setSongs] = useState([]);
  const [msgInput, setMsgInput] = useState("");
  const [songInput, setSongInput] = useState("");

  useEffect(() => {
    const handleUserList = (data) => setUsers(data);
    const handleNewMessage = (msg) => setMessages((prev) => [...prev, msg]);
    const handleSongsUpdate = (data) => setSongs([...data]);

    socket.on("user_list", handleUserList);
    socket.on("new_message", handleNewMessage);
    socket.on("update_songs", handleSongsUpdate);

    socket.emit("join_space", { space: room, user: username });

    return () => {
      socket.off("user_list", handleUserList);
      socket.off("new_message", handleNewMessage);
      socket.off("update_songs", handleSongsUpdate);
    };
  }, [room, username]);

  const sendMsg = () => {
    if (!msgInput) return;
    socket.emit("send_message", { space: room, user: username, msg: msgInput });
    setMsgInput("");
  };

  const addSong = () => {
    if (!songInput) return;
    socket.emit("suggest_song", { space: room, user: username, song: songInput });
    setSongInput("");
  };

  const upvote = (songId) => {
    socket.emit("upvote_song", { space: room, songId, user: username });
  };

  return (
    <div className="p-6 grid grid-cols-3 gap-6">
      {/* Users */}
      <div className="border rounded p-4 bg-gray-50">
        <h2 className="text-xl font-bold mb-2">👥 Users</h2>
        <ul>
          {users.map((u, i) => (
            <li key={i} className="mb-1">{u}</li>
          ))}
        </ul>
      </div>

      {/* Chat */}
      <div className="border rounded p-4 bg-gray-50 col-span-2 flex flex-col">
        <h2 className="text-xl font-bold mb-2">💬 Chat</h2>
        <div className="flex-1 overflow-y-auto bg-white p-2 rounded mb-2">
          {messages.map((m, i) => (
            <div key={i} className="mb-1">
              <b>{m.user}:</b> {m.msg}
            </div>
          ))}
        </div>
        <div className="flex">
          <input
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            placeholder="Type a message..."
            className="border flex-1 px-2 py-1 rounded-l"
          />
          <button
            onClick={sendMsg}
            className="bg-blue-500 text-white px-4 rounded-r"
          >
            Send
          </button>
        </div>
      </div>

      {/* Songs */}
      <div className="col-span-3 border rounded p-4 bg-gray-50 mt-4">
        <h2 className="text-xl font-bold mb-2">🎵 Songs Leaderboard</h2>
        <div className="mb-2 flex">
          <input
            value={songInput}
            onChange={(e) => setSongInput(e.target.value)}
            placeholder="Enter song name"
            className="border flex-1 px-2 py-1 rounded-l"
          />
          <button
            onClick={addSong}
            className="bg-green-500 text-white px-4 rounded-r"
          >
            Add
          </button>
        </div>

        <ul>
          {songs.map((s, i) => (
            <li
              key={s.id}
              className="flex justify-between bg-white p-2 rounded mb-1"
            >
              <span>{s.name} (submitted by {s.submitted_by})</span>
              <span>
                {s.votes}{" "}
                <button
                  onClick={() => upvote(s.id)}
                  className="bg-yellow-400 px-2 rounded"
                >
                  👍
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
