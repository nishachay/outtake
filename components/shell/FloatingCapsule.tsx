/** Floating mini-player capsule — visible only while the deck is collapsed. */
"use client";

import { PanelRightOpen, Pause, Play } from "lucide-react";
import { usePlayer } from "./player-context";
import VaultCover from "@/components/vault/VaultCover";

export default function FloatingCapsule() {
  const player = usePlayer();
  const song = player.song;
  if (!song) return null;

  return (
    <div
      className={`floating-now-playing${player.sidebarOpen ? " drawer-open" : ""}`}
      title="Click to expand Now Playing panel"
      onClick={() => player.setSidebarOpen(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") player.setSidebarOpen(true);
      }}
    >
      <div className="fnp-thumb">
        <VaultCover
          id={song.songId}
          title={song.title}
          artist={song.artistName}
          durationSec={song.durationSec}
          variant="mini"
        />
      </div>
      <div className="fnp-info">
        <span className="fnp-title">{song.title}</span>
        <span className="fnp-artist">{song.artistName}</span>
      </div>
      <div className="fnp-controls">
        <button
          className="fnp-btn play"
          title="Play/Pause"
          aria-label={player.playing ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation();
            player.toggle();
          }}
        >
          {player.playing ? (
            <Pause size={15} strokeWidth={1.75} fill="currentColor" />
          ) : (
            <Play size={15} strokeWidth={1.75} fill="currentColor" style={{ marginLeft: 1 }} />
          )}
        </button>
        <button
          className="fnp-btn expand"
          title="Expand Now Playing Panel"
          aria-label="Expand now playing panel"
          onClick={(e) => {
            e.stopPropagation();
            player.setSidebarOpen(true);
          }}
        >
          <PanelRightOpen size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
