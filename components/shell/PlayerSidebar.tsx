/** Now-playing deck: turntable, title/like, versions, scrubber, controls. */
"use client";

import { useRef } from "react";
import {
  Disc3,
  Heart,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { usePlayer } from "./player-context";
import { fmtTime, vaultAccent } from "@/lib/vault";
import VersionRows from "@/components/vault/VersionRows";
import Turntable from "./Turntable";

const S = 18;
const STROKE = 1.75;

export default function PlayerSidebar() {
  const player = usePlayer();
  const wrapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const song = player.song;
  const liked = song ? player.isLiked(song.songId) : false;
  const pct = player.tot > 0 ? Math.max(0, Math.min(1, player.cur / player.tot)) : 0;

  const scrubTo = (clientX: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    player.seek(p);
  };

  return (
    <aside className={`now-playing-sidebar${player.sidebarOpen ? " open" : " collapsed"}`}>
      <div className="now-playing-card-container">
        <div className="card-box-header">
          <div className="card-box-title">
            <Disc3 size={S} strokeWidth={STROKE} />
            NOW PLAYING
          </div>
          <button
            className="card-box-close-btn"
            title="Collapse Panel"
            onClick={() => player.setSidebarOpen(false)}
            aria-label="Collapse now playing panel"
          >
            <X size={14} strokeWidth={STROKE} />
          </button>
        </div>

        <div
          className={`turntable-chassis${player.playing ? " playing" : ""}`}
          title="Click to Play / Pause"
          onClick={player.toggle}
          role="button"
          aria-label={player.playing ? "Pause" : "Play"}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              player.toggle();
            }
          }}
        >
          <Turntable core={song ? vaultAccent({ id: song.songId, title: song.title }) : "#10181c"} />
        </div>

        <div className="deck-info-box">
          {song ? (
            <>
              <div className="deck-header-row">
                <div className="deck-title-block">
                  <h1 className="deck-title-text pixel-text" title={song.title}>
                    {song.title}
                  </h1>
                  <div className="deck-artist-sub">{song.artistName}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    className={`deck-like-counter${liked ? " liked" : ""}`}
                    title="Like / Favorite Track"
                    onClick={() => song && player.toggleLike(song.songId)}
                    aria-label={liked ? "Unlike this track" : "Like this track"}
                    aria-pressed={liked}
                  >
                    <Heart
                      size={14}
                      strokeWidth={STROKE}
                      fill={liked ? "#f87171" : "none"}
                      stroke={liked ? "#f87171" : "currentColor"}
                    />
                    <span>{liked ? "Liked" : "Like"}</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="deck-title-block">
                <h1 className="deck-title-text pixel-text">The deck is quiet</h1>
                <div className="deck-artist-sub">Pick an outtake to start</div>
              </div>
              {player.lastSong && (
                <div style={{ marginTop: 12 }}>
                  <button
                    className="back-to-home-btn"
                    style={{ marginBottom: 0, maxWidth: "100%" }}
                    onClick={player.resumeLast}
                    title={`Resume ${player.lastSong.title}`}
                  >
                    <Play size={14} strokeWidth={STROKE} fill="currentColor" />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Resume — {player.lastSong.title}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {song && (
          <VersionRows
            sources={song.sources}
            activeKey={player.srcKey}
            onSelect={(key) => player.selectVersion(key)}
            live={player.playing}
          />
        )}

        <div className="progress-bar-box">
          <span className="progress-timestamp">{fmtTime(player.cur)}</span>
          <div
            className="progress-track-wrap"
            ref={wrapRef}
            onClick={(e) => scrubTo(e.clientX)}
            onMouseDown={(e) => {
              draggingRef.current = true;
              player.setScrubbing(true);
              scrubTo(e.clientX);
            }}
            onMouseMove={(e) => {
              if (draggingRef.current) scrubTo(e.clientX);
            }}
            onMouseUp={() => {
              draggingRef.current = false;
              player.setScrubbing(false);
            }}
            onMouseLeave={() => {
              if (draggingRef.current) {
                draggingRef.current = false;
                player.setScrubbing(false);
              }
            }}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(player.tot)}
            aria-valuenow={Math.round(player.cur)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                // Handled here — keep the global track shortcuts out of it.
                e.stopPropagation();
              }
              if (e.key === "ArrowRight") player.seek(Math.min(1, pct + 0.02));
              if (e.key === "ArrowLeft") player.seek(Math.max(0, pct - 0.02));
            }}
          >
            <div className="progress-track-bg">
              <div className="progress-track-fill" style={{ width: `${pct * 100}%` }}>
                <div className="progress-track-thumb" />
              </div>
            </div>
          </div>
          <span className="progress-timestamp" style={{ textAlign: "right" }}>
            {fmtTime(player.tot > 0 ? player.tot : (song?.durationSec ?? 0))}
          </span>
        </div>

        <div className="player-controls-row">
          <button
            className="ctrl-icn-btn"
            title="Repeat Mode"
            style={{ opacity: player.repeat ? 1 : 0.5 }}
            onClick={player.toggleRepeat}
            aria-label="Toggle repeat"
            aria-pressed={player.repeat}
          >
            <Repeat size={S} strokeWidth={STROKE} />
          </button>
          <button className="ctrl-icn-btn" title="Previous Track" onClick={player.prev} aria-label="Previous track">
            <SkipBack size={S} strokeWidth={STROKE} fill="currentColor" />
          </button>
          <button className="ctrl-main-play-btn" title="Play / Pause" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}>
            {player.playing ? (
              <Pause size={22} strokeWidth={STROKE} fill="currentColor" />
            ) : (
              <Play size={22} strokeWidth={STROKE} fill="currentColor" style={{ marginLeft: 2 }} />
            )}
          </button>
          <button className="ctrl-icn-btn" title="Next Track" onClick={player.next} aria-label="Next track">
            <SkipForward size={S} strokeWidth={STROKE} fill="currentColor" />
          </button>
          <button
            className="ctrl-icn-btn"
            title="Shuffle Playback"
            style={{ opacity: player.shuffle ? 1 : 0.5 }}
            onClick={player.toggleShuffle}
            aria-label="Toggle shuffle"
            aria-pressed={player.shuffle}
          >
            <Shuffle size={S} strokeWidth={STROKE} />
          </button>
        </div>
      </div>
    </aside>
  );
}
