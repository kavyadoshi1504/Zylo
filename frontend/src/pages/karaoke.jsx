import React, { useState, useRef, useEffect } from "react";

export default function Karaoke({ audioUrl, lyrics = [], onBack }) {
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);

  const audioRef = useRef(null);
  const rafRef = useRef(null);

  // Prevent unnecessary re-renders at 60 FPS
  const lastLineIndexRef = useRef(-1);
  const lastWordIndexRef = useRef(-1);

  const handlePlay = () => {
    setIsPlaying(true);
    setIsEnded(false);
  };

  const handlePause = () => {
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setIsEnded(true);
    cancelAnimationFrame(rafRef.current);

    // Reset highlight
    setCurrentLineIndex(-1);
    setCurrentWordIndex(-1);

    lastLineIndexRef.current = -1;
    lastWordIndexRef.current = -1;
  };

  useEffect(() => {
    if (!isPlaying || !audioRef.current || lyrics.length === 0) return;

    const update = () => {
      const audio = audioRef.current;
      if (!audio) return;

      const elapsed = audio.currentTime;
      let foundLine = -1;
      let foundWord = -1;

      // Find which word is active
      for (let i = 0; i < lyrics.length; i++) {
        const line = lyrics[i];

        for (let j = 0; j < line.length; j++) {
          const { start, end } = line[j];

          if (
            start != null &&
            end != null &&
            elapsed >= start &&
            elapsed <= end
          ) {
            foundLine = i;
            foundWord = j;
            break;
          }
        }

        if (foundLine !== -1) break;
      }

      // Update state only on change (prevents 60fps re-render)
      if (foundLine !== lastLineIndexRef.current) {
        lastLineIndexRef.current = foundLine;
        setCurrentLineIndex(foundLine);
      }

      if (foundWord !== lastWordIndexRef.current) {
        lastWordIndexRef.current = foundWord;
        setCurrentWordIndex(foundWord);
      }

      if (!audio.paused) {
        rafRef.current = requestAnimationFrame(update);
      }
    };

    rafRef.current = requestAnimationFrame(update);

    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, lyrics]);

  return (
    <div className="karaoke-container">
      {/* INLINE CSS — unchanged */}
      <style>{`
        .karaoke-container {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background: #ffffff;
          border-radius: 10px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          text-align: center;
          font-size: 1.2rem;
          color: #333;
        }
        .karaoke-container h2 {
          margin-bottom: 15px;
          font-weight: bold;
          color: #222;
        }
        audio {
          width: 100%;
          margin-bottom: 20px;
        }
        .lyrics-display {
          font-size: 20px;
          line-height: 1.7;
          color: #555;
          padding: 20px;
          border-radius: 10px;
          background-color: #f8f8f8;
          min-height: 150px;
          max-height: 400px;
          overflow-y: auto;
          box-shadow: inset 0 0 5px rgba(0,0,0,0.1);
        }
        .lyrics-line {
          margin-bottom: 8px;
          min-height: 1.5em;
        }
        .highlighted {
          color: #fff;
          background-color: #2563eb;
          border-radius: 4px;
          padding: 2px 6px;
          font-weight: bold;
          box-shadow: 0 0 8px rgba(37, 99, 235, 0.5);
          display: inline-block;
          transition: background-color 0.1s ease;
        }
        @media (max-width: 600px) {
          .lyrics-display { font-size: 16px; padding: 10px; }
          .karaoke-container { padding: 10px; }
        }
      `}</style>

      <h2>Karaoke Player</h2>

      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        preload="auto"
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
      />

      <div className="lyrics-display">
        {lyrics.map((line, i) => (
          <div key={i} className="lyrics-line">
            {line.map((word, j) => (
              <span
                key={j}
                className={
                  i === currentLineIndex && j === currentWordIndex
                    ? "highlighted"
                    : ""
                }
              >
                {word.text + " "}
              </span>
            ))}
          </div>
        ))}
      </div>

      {isEnded && (
        <div className="mt-6">
          <button
            onClick={onBack}
            className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600 transition duration-200"
          >
            🔁 Try Another Song
          </button>
        </div>
      )}
    </div>
  );
}
