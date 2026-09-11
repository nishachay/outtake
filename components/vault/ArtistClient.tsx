/** Artist stage: play-all/shuffle-all actions, sort, and track rows.
 *  Registers the artist list as the queue context. */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Heart, Play, Shuffle } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";
import TrackRow from "./TrackRow";

type SortMode = "vault" | "az" | "longest" | "shortest";

const SORTS: Array<{ key: SortMode; label: string }> = [
  { key: "vault", label: "Archive order" },
  { key: "az", label: "A–Z" },
  { key: "longest", label: "Longest" },
  { key: "shortest", label: "Shortest" },
];

interface ArtistClientProps {
  songs: DeckSong[];
  slug: string;
}

export default function ArtistClient({ songs, slug }: ArtistClientProps) {
  const player = usePlayer();
  const query = player.searchQuery.trim().toLowerCase();
  const key = `artist:${slug}`;
  const [sort, setSort] = useState<SortMode>("vault");

  useEffect(() => {
    if (player.queueKey !== key) player.loadList(songs, key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, slug]);

  const visible = useMemo(() => {
    const list = query
      ? songs.filter(
          (s) => s.title.toLowerCase().includes(query) || s.artistName.toLowerCase().includes(query),
        )
      : [...songs];
    if (sort === "az") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "longest") list.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0));
    else if (sort === "shortest") list.sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0));
    return list;
  }, [songs, query, sort]);

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 20,
          marginBottom: 4,
        }}
      >
        <h2 className="section-pixel-title pixel-text">Artist Outtakes ({songs.length})</h2>
        {visible.length > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="hero-play-btn"
              style={{ height: 34, fontSize: 12 }}
              onClick={() => player.playQueue(visible, 0, key)}
              title="Play all outtakes"
            >
              <Play size={14} strokeWidth={1.75} fill="currentColor" />
              <span>Play all</span>
            </button>
            <button
              className="hero-ghost-btn"
              style={{ height: 34, fontSize: 12, borderColor: "var(--pill-border)", color: "var(--text-primary)" }}
              onClick={() =>
                player.playQueue(visible, Math.floor(Math.random() * visible.length), key)
              }
              title="Shuffle all outtakes"
              aria-label="Shuffle all outtakes"
            >
              <Shuffle size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>

      {songs.length > 1 && (
        <div className="deck-versions-row" aria-label="Sort outtakes" style={{ marginTop: 8 }}>
          <span className="deck-versions-label">Sort</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`version-chip${sort === s.key ? " active" : ""}`}
                onClick={() => setSort(s.key)}
              >
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="vault-empty">
          <Heart size={24} strokeWidth={1.75} />
          No unreleased outtakes found matching your criteria.
          <div style={{ marginTop: 12 }}>
            <Link href="/submit" className="back-to-home-btn" style={{ marginBottom: 0 }}>
              Found it elsewhere? Submit this outtake
            </Link>
          </div>
        </div>
      ) : (
        <div className="playlists-list">
          {visible.map((s, i) => (
            <TrackRow key={s.songId} song={s} pos={i} queue={visible} queueKey={key} />
          ))}
        </div>
      )}
    </>
  );
}
