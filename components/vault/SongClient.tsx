/** Song detail actions — play in the deck + version chips, vault-styled. */
"use client";

import { Play } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";

interface SongClientProps {
  song: DeckSong;
  artistSongs: DeckSong[];
  queueKey: string;
}

export default function SongClient({ song, artistSongs, queueKey }: SongClientProps) {
  const player = usePlayer();
  const pos = Math.max(
    0,
    artistSongs.findIndex((s) => s.songId === song.songId),
  );
  const deckSong = player.song;
  const showing = deckSong?.songId === song.songId;
  const activeKey = showing ? player.srcKey : null;

  const playVersion = (key: string) => {
    if (showing) {
      player.selectVersion(key);
      return;
    }
    // playQueue persists the forced key as this song's preference.
    player.playQueue(artistSongs, pos, queueKey, key);
  };

  return (
    <>
      <div className="detail-actions">
        <button
          className="hero-play-btn"
          onClick={() => player.playQueue(artistSongs, pos, queueKey)}
        >
          <Play size={16} strokeWidth={1.75} fill="currentColor" />
          <span>Play Outtake</span>
        </button>
      </div>
      {song.sources.length > 1 && (
        <div className="deck-versions-row" aria-label="Choose a version" style={{ marginTop: 14 }}>
          <span className="deck-versions-label">Versions</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            {song.sources.map((src) => (
              <button
                key={src.key}
                className={`version-chip${src.key === activeKey ? " active" : ""}`}
                title={`Play ${src.name}`}
                onClick={() => playVersion(src.key)}
              >
                <span className="vc-num">{src.num}</span>
                <span>{src.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
