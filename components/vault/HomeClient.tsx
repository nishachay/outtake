/** Home discovery canvas: hero spotlight, quick picks, artists, trending grails.
 *  Also hosts search-results and favorites views driven by the rail. */
"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Heart, Play, Shuffle } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";
import { vaultCatno, vaultInitial, vaultSide } from "@/lib/vault";
import VaultCover from "./VaultCover";
import TrackRow from "./TrackRow";
import ArtistAvatar from "./ArtistAvatar";

export interface HomeArtist {
  slug: string;
  name: string;
  initials: string;
  tag: string | null;
  avatarUrl: string | null;
  count: number;
}

interface HomeClientProps {
  songs: DeckSong[];
  artists: HomeArtist[];
}

export default function HomeClient({ songs, artists }: HomeClientProps) {
  const player = usePlayer();
  const query = player.searchQuery.trim().toLowerCase();

  useEffect(() => {
    if (player.queueKey !== "home") player.loadList(songs, "home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs]);

  const results = useMemo(() => {
    if (!query) return null;
    return songs.filter(
      (s) => s.title.toLowerCase().includes(query) || s.artistName.toLowerCase().includes(query),
    );
  }, [songs, query]);

  const favorites = useMemo(
    () => songs.filter((s) => player.isLiked(s.songId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [songs, player.likedCount],
  );

  if (player.favoritesOnly) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="section-pixel-title pixel-text">Favorites</h2>
          <span className="view-all-link">
            {favorites.length} Liked Grail{favorites.length === 1 ? "" : "s"}
          </span>
        </div>
        {favorites.length === 0 ? (
          <div className="vault-empty">
            <Heart size={24} strokeWidth={1.75} />
            No favorites yet — tap Like on any track and it lands here.
          </div>
        ) : (
          <div className="playlists-list">
            {favorites.map((s, i) => (
              <TrackRow key={s.songId} song={s} pos={i} queue={favorites} queueKey="favorites" />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (results) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="section-pixel-title pixel-text">Results</h2>
          <span className="view-all-link">
            {results.length} Grail{results.length === 1 ? "" : "s"}
          </span>
        </div>
        {results.length === 0 ? (
          <div className="vault-empty">
            <Heart size={24} strokeWidth={1.75} />
            No unreleased grails found matching your criteria.
            <div style={{ marginTop: 12 }}>
              <Link href="/submit" className="back-to-home-btn" style={{ marginBottom: 0 }}>
                Found it elsewhere? Submit this grail
              </Link>
            </div>
          </div>
        ) : (
          <div className="playlists-list">
            {results.map((s, i) => (
              <TrackRow key={s.songId} song={s} pos={i} queue={results} queueKey="results" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const hero = songs[0];
  const picks = songs.slice(0, 6);
  const trending = [songs[1], songs[2], songs[3]].filter(Boolean);

  return (
    <>
      {hero && (
        <div className="spotify-hero-banner">
          <span className="hero-ghost" aria-hidden="true">
            {vaultInitial(hero.title)}
          </span>
          <div className="hero-content">
            <div className="hero-tag">Featured Vault Outtake</div>
            <h1 className="hero-title pixel-text" title={hero.title}>
              {hero.title}
            </h1>
            <p className="hero-artist">
              {hero.artistName} · Unreleased Studio Session
            </p>
            <div className="hero-actions">
              <button className="hero-play-btn" onClick={() => player.playQueue(songs, 0, "home")}>
                <Play size={16} strokeWidth={1.75} fill="currentColor" />
                <span>Listen Outtake</span>
              </button>
              <button
                className="hero-ghost-btn"
                title="Play a random grail from the vault"
                onClick={() =>
                  player.playQueue(songs, Math.floor(Math.random() * songs.length), "home")
                }
              >
                <Shuffle size={15} strokeWidth={1.75} />
                <span>Shuffle a grail</span>
              </button>
            </div>
          </div>
          <span className="hero-catno" aria-hidden="true">
            {vaultCatno({ id: hero.songId, title: hero.title })} · SIDE{" "}
            {vaultSide({ id: hero.songId, title: hero.title })}
          </span>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h2 className="section-pixel-title pixel-text" style={{ marginBottom: 12 }}>
          Quick Picks
        </h2>
        <div className="quick-picks-grid">
          {picks.map((s, idx) => (
            <button key={s.songId} className="quick-pick-card" onClick={() => player.playQueue(songs, idx, "home")}>
              <div className="quick-pick-thumb">
                <VaultCover id={s.songId} title={s.title} artist={s.artistName} durationSec={s.durationSec} variant="mini" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="quick-pick-title" title={s.title}>
                  {s.title}
                </div>
                <div className="quick-pick-artist">{s.artistName}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 className="section-pixel-title pixel-text">Featured Vault Artists</h2>
          <span className="view-all-link">
            {artists.length} Artist{artists.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="artist-grid-container">
          {artists.map((a) => (
            <Link key={a.slug} href={`/artist/${a.slug}`} className="artist-card-item">
              <div className="artist-card-avatar">
                <ArtistAvatar src={a.avatarUrl} name={a.name} initials={a.initials} variant="card" />
              </div>
              <div style={{ width: "100%" }}>
                <div className="artist-card-name">{a.name}</div>
                <div className="artist-card-sub">{a.count} Outtakes</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="section-pixel-title pixel-text">Trending Grails</h2>
          <span className="view-all-link">Top Unreleased Outtakes</span>
        </div>
        <div className="cards-grid">
          {trending.map((s, i) => (
            <button key={s.songId} className="card-item-featured" onClick={() => player.playQueue(songs, i + 1, "home")}>
              <div className="card-cover-wrap">
                <VaultCover id={s.songId} title={s.title} artist={s.artistName} durationSec={s.durationSec} variant="label" />
              </div>
              <div className="card-footer-row">
                <div className="card-meta">
                  <div className="card-title" title={s.title}>
                    {s.title}
                  </div>
                  <div className="card-artist">{s.artistName}</div>
                </div>
                <div className="card-controls-cluster">
                  <span className="card-ctrl-btn play" title="Play Track">
                    <Play size={14} strokeWidth={1.75} fill="currentColor" style={{ marginLeft: 1 }} />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
