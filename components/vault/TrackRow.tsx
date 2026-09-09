/** Dense vault track row: #NN · mini cover · title/artist · play circle. */
"use client";

import { Pause, Play } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";
import { fmtTime } from "@/lib/vault";
import VaultCover from "./VaultCover";

interface TrackRowProps {
  song: DeckSong;
  pos: number;
  queue: DeckSong[];
  queueKey: string;
}

export default function TrackRow({ song, pos, queue, queueKey }: TrackRowProps) {
  const player = usePlayer();
  const isActive = player.queueKey === queueKey && player.index === pos;
  const numStr = String(pos + 1).padStart(2, "0");

  const handleClick = () => {
    if (isActive) player.toggle();
    else player.playQueue(queue, pos, queueKey);
  };

  return (
    <div
      className={`playlist-row-item${isActive ? " active" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <span
        style={{
          fontFamily: "var(--display-font)",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text-muted)",
          width: 24,
          flexShrink: 0,
        }}
      >
        #{numStr}
      </span>
      <div className="row-left-info" style={{ flex: 1, minWidth: 0 }}>
        <div className="row-thumb">
          <VaultCover id={song.songId} title={song.title} artistSlug={song.artistSlug} artistName={song.artistName} />
        </div>
        <div className="row-details">
          <div className="row-title" title={song.title}>
            {song.title}
          </div>
          <div className="row-sub">
            {song.artistName} · {fmtTime(song.durationSec)}
          </div>
        </div>
      </div>
      <button
        className="row-play-circle"
        title={isActive && player.playing ? "Pause" : "Play Track"}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        aria-label={isActive && player.playing ? `Pause ${song.title}` : `Play ${song.title}`}
      >
        {isActive && player.playing ? (
          <Pause size={14} strokeWidth={1.75} fill="currentColor" />
        ) : (
          <Play size={14} strokeWidth={1.75} fill="currentColor" />
        )}
      </button>
    </div>
  );
}
