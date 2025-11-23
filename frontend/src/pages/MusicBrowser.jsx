import React, { useState, useEffect, useRef } from "react";

export default function MusicBrowser() {
  const API_BASE_URL = "VITE_API_URL";

  const [artists, setArtists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [songs, setSongs] = useState([]);
  const [playlist, setPlaylist] = useState([]);
  const [selectedArtist, setSelectedArtist] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState("");
  const [currentSong, setCurrentSong] = useState(null);
  const [recommendStatus, setRecommendStatus] = useState(
    "Select a song to start playing and get recommendations!"
  );
  const [currentSongIndex, setCurrentSongIndex] = useState(0);

  const audioRef = useRef(null);

  // -------------------- FETCH ARTISTS --------------------
  useEffect(() => {
    fetch(`${API_BASE_URL}/artists`)
      .then((r) => r.json())
      .then(setArtists)
      .catch((e) => console.error("Error fetching artists", e));
  }, []);

  // -------------------- SELECT ARTIST --------------------
  const selectArtist = async (artist) => {
    setSelectedArtist(artist);
    setSelectedAlbum("");
    setAlbums([]);
    setSongs([]);
    setPlaylist([]);

    const res = await fetch(
      `${API_BASE_URL}/albums/${encodeURIComponent(artist)}`
    );
    setAlbums(await res.json());
  };

  // -------------------- SELECT ALBUM --------------------
  const selectAlbum = async (album) => {
    setSelectedAlbum(album);

    const res = await fetch(
      `${API_BASE_URL}/songs/${encodeURIComponent(selectedArtist)}/${encodeURIComponent(
        album
      )}`
    );
    setSongs(await res.json());
  };

  // -------------------- PLAY SONG --------------------
  const playSong = async (song) => {
    if (!song?.id) return;

    const audioUrl = `${API_BASE_URL}/play/${song.id}`;

    setCurrentSong(song);

    if (audioRef.current) {
      audioRef.current.src = audioUrl;

      try {
        await audioRef.current.play();
      } catch (err) {
        console.warn("Autoplay blocked, retrying…");
        setTimeout(() => {
          audioRef.current.play().catch(() => {});
        }, 300);
      }
    }

    // Fetch recommendations
    setRecommendStatus("Generating recommendations...");

    const res = await fetch(`${API_BASE_URL}/autopath_recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: song.id }),
    });

    const data = await res.json();
    setPlaylist(data.playlist);
    setRecommendStatus(
      `Based on "${song.title}" (${data.tags_used?.join(", ") || "no tags"})`
    );
    setCurrentSongIndex(0);
  };

  // -------------------- AUTO PLAY NEXT --------------------
  useEffect(() => {
    if (!audioRef.current) return;

    const player = audioRef.current;

    const handleEnded = () => {
      if (playlist.length === 0) return;

      const nextIndex = (currentSongIndex + 1) % playlist.length;
      setCurrentSongIndex(nextIndex);

      playSong(playlist[nextIndex]);
    };

    player.addEventListener("ended", handleEnded);

    return () => {
      player.removeEventListener("ended", handleEnded);
    };
  }, [playlist, currentSongIndex]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-black to-purple-950 text-white p-6">
      <div className="max-w-7xl mx-auto bg-gray-900/80 p-8 rounded-3xl shadow-2xl">
        <h1 className="text-3xl font-bold text-purple-300 mb-6">
          🎵 Music Browser & Recommender
        </h1>

        {/* PLAYER */}
        <div className="mb-6 p-4 bg-gray-950 rounded-xl border border-purple-700">
          <h2 className="text-xl font-semibold mb-2">
            {currentSong ? currentSong.title : "No song playing"}
          </h2>
          <p className="text-gray-400 mb-2">
            {currentSong ? currentSong.artist_name : "Select a song to start"}
          </p>

          <audio ref={audioRef} controls className="w-full rounded-lg" preload="auto" />
        </div>

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ARTISTS / ALBUMS / SONGS */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Artists */}
            <div className="bg-gray-950/60 border border-purple-800 rounded-xl p-3 overflow-y-auto max-h-[500px]">
              <h2 className="text-lg font-semibold text-purple-300 mb-3">Artists</h2>
              {artists.map((a) => (
                <div
                  key={a}
                  className={`p-2 rounded-lg mb-1 cursor-pointer ${
                    a === selectedArtist
                      ? "bg-purple-700 text-white"
                      : "bg-gray-800 hover:bg-purple-800"
                  }`}
                  onClick={() => selectArtist(a)}
                >
                  {a}
                </div>
              ))}
            </div>

            {/* Albums */}
            <div className="bg-gray-950/60 border border-purple-800 rounded-xl p-3 overflow-y-auto max-h-[500px]">
              <h2 className="text-lg font-semibold text-purple-300 mb-3">Albums</h2>
              {albums.map((al) => (
                <div
                  key={al}
                  className={`p-2 rounded-lg mb-1 cursor-pointer ${
                    al === selectedAlbum
                      ? "bg-purple-700 text-white"
                      : "bg-gray-800 hover:bg-purple-800"
                  }`}
                  onClick={() => selectAlbum(al)}
                >
                  {al}
                </div>
              ))}
            </div>

            {/* Songs */}
            <div className="bg-gray-950/60 border border-purple-800 rounded-xl p-3 overflow-y-auto max-h-[500px]">
              <h2 className="text-lg font-semibold text-purple-300 mb-3">Songs</h2>
              {songs.map((s) => (
                <div
                  key={s.id}
                  className="p-2 rounded-lg mb-1 bg-gray-800 hover:bg-purple-800 cursor-pointer"
                  onClick={() =>
                    playSong({
                      id: s.id,
                      title: s.title,
                      artist_name: selectedArtist,
                    })
                  }
                >
                  {s.title}
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-gray-950/60 border border-purple-800 rounded-xl p-3 overflow-y-auto max-h-[500px]">
            <h2 className="text-lg font-semibold text-purple-300 mb-3">Up Next</h2>

            <p className="text-sm text-gray-400 mb-3">{recommendStatus}</p>

            {playlist.map((s, i) => (
              <div
                key={s.id}
                className={`p-2 rounded-lg mb-1 cursor-pointer ${
                  i === currentSongIndex
                    ? "bg-purple-700 text-white"
                    : "bg-gray-800 hover:bg-purple-800"
                }`}
                onClick={() => {
                  setCurrentSongIndex(i);
                  playSong(s);
                }}
              >
                <div className="font-semibold">{s.title}</div>
                <div className="text-sm text-gray-300">{s.artist_name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
