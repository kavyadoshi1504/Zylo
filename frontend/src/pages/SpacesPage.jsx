import { useEffect, useState } from "react";
import { socket } from "./socket";

export default function SpacesPage({ setPage, username, setSpace }) {
  const [spaces, setSpaces] = useState([]);
  const [newSpace, setNewSpace] = useState("");

  useEffect(() => {
    if (!username || !username.trim()) return;

    const handleSpacesList = (data) => {
      setSpaces(data);
    };

    socket.on("spaces_list", handleSpacesList);
    socket.emit("get_spaces");

    return () => {
      socket.off("spaces_list", handleSpacesList);
    };
  }, [username]);

  const createSpace = () => {
    if (!newSpace.trim()) return;

    socket.emit("create_space", { space: newSpace, user: username });
    setSpace(newSpace);

    // Give the event loop one tick so join happens correctly
    setTimeout(() => {
      setPage("chat");
    }, 50);
  };

  const joinSpace = (space) => {
    if (!username.trim()) {
      alert("Enter username first");
      return;
    }

    socket.emit("join_space", { space, user: username });
    setSpace(space);

    setTimeout(() => {
      setPage("chat");
    }, 50);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-purple-900 via-black to-purple-950">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-8 rounded-3xl shadow-2xl w-[90%] max-w-lg">
        <h1 className="text-3xl font-extrabold mb-6 text-center text-purple-300 drop-shadow-lg">
          👋 Hello {username}
        </h1>

        {/* Create Space */}
        <div className="mb-6">
          <input
            className="border border-purple-600 bg-black text-purple-200 p-3 rounded-xl w-full mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Create a new space..."
            value={newSpace}
            onChange={(e) => setNewSpace(e.target.value)}
          />
          <button
            className="bg-purple-600 hover:bg-purple-700 w-full text-white px-4 py-3 rounded-xl font-bold shadow-lg transition-all duration-300 hover:scale-105"
            onClick={createSpace}
          >
            🎶 Create Space
          </button>
        </div>

        {/* Available Spaces */}
        <h2 className="text-xl text-purple-300 mb-3 font-semibold">
          🔑 Available Spaces
        </h2>

        {spaces.length === 0 ? (
          <p className="text-purple-400 text-center opacity-75">
            No spaces available. Create one to get started!
          </p>
        ) : (
          <ul className="space-y-3">
            {spaces.map((s) => (
              <li key={s}>
                <button
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-3 rounded-xl font-bold w-full shadow-md transition-all duration-300 hover:scale-105"
                  onClick={() => joinSpace(s)}
                >
                  🚀 Join {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
