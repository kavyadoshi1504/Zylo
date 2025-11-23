import { useState } from "react";
import LandingPage from "./pages/LandingPage";
import SpacesPage from "./pages/SpacesPage";
import ChatWindow from "./pages/ChatWindow";
import Karaoke from "./pages/karaoke";
import MusicBrowser from "./pages/MusicBrowser";

function App() {
  const [page, setPage] = useState("landing");
  const [username, setUsername] = useState("");
  const [space, setSpace] = useState("");
  const [karaokeData, setKaraokeData] = useState(null);
  const [songName, setSongName] = useState("");
  const [error, setError] = useState("");

  if (page === "landing") {
    return <LandingPage setPage={setPage} setUsername={setUsername} />;
  }

  if (page === "spaces") {
    return (
      <SpacesPage setPage={setPage} username={username} setSpace={setSpace} />
    );
  }

  if (page === "music") {
    return <MusicBrowser />;
  }

  if (page === "chat") {
    return (
      <ChatWindow
        username={username}
        space={space}
        setPage={setPage}
        setKaraokeData={setKaraokeData}
      />
    );
  }


  if (page === "karaoke") {
    if (!karaokeData) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900">
          <div className="bg-gray-800 p-6 rounded-xl shadow-lg w-96 text-center">
            <h2 className="text-2xl font-bold text-purple-300 mb-4">
              Enter Song Name
            </h2>
            <input
              className="border border-purple-600 bg-black text-purple-200 p-2 rounded w-full mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Song name..."
              value={songName}
              onChange={(e) => setSongName(e.target.value)}
            />
            <button
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
              onClick={async () => {
                if (!songName.trim()) return;
                setError("");
                try {
                  const res = await fetch(
                    "http://localhost:8000/generate_karaoke",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ song_name: songName }),
                    }
                  );
                  if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.detail || "Backend error");
                  }
                  const data = await res.json();
                  setKaraokeData(data);
                } catch (err) {
                  console.error(err);
                  setError(
                    "Failed to start karaoke. Check backend or song name."
                  );
                }
              }}
            >
              Start Karaoke
            </button>

            {error && (
              <p className="text-red-500 mt-2 text-sm font-bold">{error}</p>
            )}

            <button
              className="mt-2 text-sm text-purple-300 underline"
              onClick={() => {
                setPage("landing");
                setSongName("");
                setError("");
              }}
            >
              ⬅ Back
            </button>
          </div>
        </div>
      );
    }

    return (
      <Karaoke
        audioUrl={karaokeData.audio_url}
        vocalsUrl={karaokeData.vocals_url}
        lyrics={karaokeData.lyrics}
        onBack={() => {
          setPage("landing");
          setKaraokeData(null);
          setSongName("");
          setError("");
        }}
      />
    );
  }

  return null;
}

export default App;
