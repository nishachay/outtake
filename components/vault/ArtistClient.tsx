/** Artist stage rows — registers the artist list as the queue context. */
"use client";

import { useEffect, useMemo } from "react";
import { Heart } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";
import TrackRow from "./TrackRow";

interface ArtistClientProps {
  songs: DeckSong[];
  slug: string;
}

export default function ArtistClient({ songs, slug }: ArtistClientProps) {
  const player = usePlayer();
  const query = player.searchQuery.trim().toLowerCase();
  const key = `artist:${slug}`;

  useEffect(() => {
    if (player.queueKey !== key) player.loadList(songs, key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, slug]);

  const visible = useMemo(() => {
    if (!query) return songs;
    return songs.filter(
      (s) => s.title.toLowerCase().includes(query) || s.artistName.toLowerCase().includes(query),
    );
  }, [songs, query]);

  if (visible.length === 0) {
    return (
      <div className="vault-empty">
        <Heart size={24} strokeWidth={1.75} />
        No unreleased grails found matching your criteria.
      </div>
    );
  }

  return (
    <div className="playlists-list">
      {visible.map((s, i) => (
        <TrackRow key={s.songId} song={s} pos={i} queue={visible} queueKey={key} />
      ))}
    </div>
  );
}
