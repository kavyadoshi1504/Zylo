import { useState } from "react";

export default function LandingPage({ setPage, setUsername }) {
  const [name, setName] = useState("");

  const handleJoin = (page) => {
    if (name.trim()) {
      setUsername(name);
      setPage(page);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-purple-900 via-black to-purple-950">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-8 rounded-3xl shadow-2xl text-center w-96">
        <h1 className="text-4xl font-extrabold mb-6 text-purple-300 drop-shadow-lg">
          🎧 Music Party
        </h1>

        <input
          className="border border-purple-600 bg-black text-purple-200 p-3 rounded-xl w-full mb-6 focus:outline-none focus:ring-2 focus:ring-purple-500"
          placeholder="Enter your name..."
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="flex flex-col gap-4">
          <button
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg transition-all duration-300 hover:scale-105"
            onClick={() => handleJoin("karaoke")}
          >
            🎶 Start Solo Party
          </button>

          <button
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-3 rounded-xl font-bold shadow-lg transition-all duration-300 hover:scale-105"
            onClick={() => handleJoin("spaces")}
          >
            👫 Join Party
          </button>

          <button
            className="bg-gradient-to-r from-green-500 to-green-700 hover:from-green-600 hover:to-green-800 text-white px-4 py-3 rounded-xl font-bold shadow-lg transition-all duration-300 hover:scale-105"
            onClick={() => setPage("music")}
          >
            🎧 Listen Songs
          </button>

        </div>

        <p className="text-sm text-purple-300 mt-6 opacity-80">
          Create your own music space or join a friend’s party!
        </p>
      </div>
    </div>
  );
}
