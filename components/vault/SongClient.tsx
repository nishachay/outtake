/** Song detail actions — play in the deck + version rows + share, vault-styled. */
"use client";

import { useState } from "react";
import { Check, Link2, Play } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";
import VersionRows from "./VersionRows";

interface SongClientProps {
  song: DeckSong;
  artistSongs: DeckSong[];
  queueKey: string;
}

export default function SongClient({ song, artistSongs, queueKey }: SongClientProps) {
  const player = usePlayer();
  const [copied, setCopied] = useState(false);
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

  const share = async () => {
    const url = `${window.location.origin}/song/${song.songId}`;
    const title = `${song.title} — ${song.artistName}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* dismissed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
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
        <button className="back-to-home-btn" style={{ marginBottom: 0 }} onClick={share}>
          {copied ? (
            <Check size={14} strokeWidth={1.75} />
          ) : (
            <Link2 size={14} strokeWidth={1.75} />
          )}
          <span>{copied ? "Link copied" : "Share"}</span>
        </button>
      </div>
      <VersionRows
        sources={song.sources}
        activeKey={activeKey}
        onSelect={playVersion}
        live={showing && player.playing}
      />
    </>
  );
}
