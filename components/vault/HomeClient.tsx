/** Home discovery canvas: outtake of the day, artists, alternate takes,
 *  deep archive. Also hosts search-results and favorites views from the rail. */
"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Heart, Pause, Play, Shuffle } from "lucide-react";
import { usePlayer } from "@/components/shell/player-context";
import type { DeckSong } from "@/lib/vault";
import { vaultCatno, vaultInitial, vaultSide } from "@/lib/vault";
import VaultCover from "./VaultCover";
import TrackRow from "./TrackRow";
import ArtistAvatar from "./ArtistAvatar";
import { prefetchCatalog, useCatalog } from "./useCatalog";

export interface HomeArtist {
  slug: string;
  name: string;
  initials: string;
  tag: string | null;
  avatarUrl: string | null;
  count: number;
}

interface HomeClientProps {
  /** Only what renders. The full catalog arrives via /api/manifest on first play. */
  songs: DeckSong[];
  artists: HomeArtist[];
  hero: DeckSong | null;
  heroIndex: number;
  altTakes: DeckSong[];
  deepCuts: DeckSong[];
  totalTracks: number;
}

/**
 * A rail queues *itself*, not the whole catalog. It previously passed the full
 * `songs` array, so clicking one card in a six-track rail silently queued all 288
 * tracks — which reads exactly like random playback. Each rail also gets its own
 * queueKey so two rails never both highlight the active row.
 */
function RailCards({ title, note, tracks, railKey }: {
  title: string;
  note: string;
  tracks: DeckSong[];
  railKey: string;
}) {
  const player = usePlayer();
  if (!tracks.length) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 className="section-pixel-title pixel-text">{title}</h2>
        <span className="view-all-link">{note}</span>
      </div>
      <div className="cards-grid">
        {tracks.map((s, i) => {
          const isActive = player.queueKey === railKey && player.song?.songId === s.songId;
          return (
            <button
              key={s.songId}
              className="card-item-featured"
              aria-current={isActive ? "true" : undefined}
              onClick={() => {
                if (isActive) player.toggle();
                else player.playQueue(tracks, i, railKey);
              }}
            >
              <div className="card-cover-wrap">
                <VaultCover id={s.songId} title={s.title} artistSlug={s.artistSlug} artistName={s.artistName} />
              </div>
              <div className="card-footer-row">
                <div className="card-meta">
                  <div className="card-title" title={s.title}>
                    {s.title}
                  </div>
                  <div className="card-artist">{s.artistName}</div>
                </div>
                <div className="card-controls-cluster">
                  <span className="card-ctrl-btn play" title={isActive ? "Pause" : "Play Track"}>
                    {isActive && player.playing ? (
                      <Pause size={14} strokeWidth={1.75} fill="currentColor" />
                    ) : (
                      <Play size={14} strokeWidth={1.75} fill="currentColor" style={{ marginLeft: 1 }} />
                    )}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HomeClient({
  songs,
  artists,
  hero,
  heroIndex,
  altTakes,
  deepCuts,
  totalTracks,
}: HomeClientProps) {
  const player = usePlayer();
  const query = player.searchQuery.trim().toLowerCase();

  /**
   * The full catalog, fetched once on first need. Three features need it — the
   * play queue, search results, and favorites — and none of them can work from the
   * screenful the server rendered.
   *
   * `active` is true when one of those is actually in use, so a visitor who never
   * presses play and never searches never downloads it.
   */
  const needsCatalog = Boolean(query) || player.favoritesOnly;
  const { songs: catalog } = useCatalog(needsCatalog);

  // The queue is whatever the visitor last engaged with: the rendered rails, or
  // the full catalog once it has loaded.
  const queueSource = catalog ?? songs;

  useEffect(() => {
    if (player.queueKey !== "home") player.loadList(queueSource, "home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSource]);

  // Before the manifest lands, search and favorites can only cover what rendered.
  const searchable = catalog ?? songs;

  const results = useMemo(() => {
    if (!query) return null;
    return searchable.filter(
      (s) => s.title.toLowerCase().includes(query) || s.artistName.toLowerCase().includes(query),
    );
  }, [searchable, query]);

  const favorites = useMemo(
    () => searchable.filter((s) => player.isLiked(s.songId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchable, player.likedCount],
  );

  if (player.favoritesOnly) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="section-pixel-title pixel-text">Favorites</h2>
          <span className="view-all-link">
            {favorites.length} Liked Outtake{favorites.length === 1 ? "" : "s"}
          </span>
        </div>
        {favorites.length === 0 && catalog === null ? (
          <div className="vault-empty">Loading the archive to find your likes…</div>
        ) : null}
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
            {catalog === null
              ? `Searching ${totalTracks} outtakes…`
              : `${results.length} of ${totalTracks} outtakes`}
          </span>
        </div>
        {results.length === 0 ? (
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
            {results.map((s, i) => (
              <TrackRow key={s.songId} song={s} pos={i} queue={results} queueKey="results" />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {hero && (
        <div className="spotify-hero-banner">
          <span className="hero-ghost" aria-hidden="true">
            {vaultInitial(hero.title)}
          </span>
          <div className="hero-content">
            <div className="hero-tag">Outtake of the day</div>
            <h1 className="hero-title pixel-text" title={hero.title}>
              {hero.title}
            </h1>
            <p className="hero-artist">
              {hero.artistName} · Unreleased Studio Session
            </p>
            <div className="hero-actions">
              <button
                className="hero-play-btn"
                onClick={() => {
                  // Pressing play is the moment the full catalog is genuinely
                  // needed, so this is where it is fetched if it is not already.
                  if (!catalog) void prefetchCatalog();
                  const list = queueSource;
                  const at = list.findIndex((s) => s.songId === hero.songId);
                  player.playQueue(list, at >= 0 ? at : 0, "home");
                }}
              >
                <Play size={16} strokeWidth={1.75} fill="currentColor" />
                <span>Listen Outtake</span>
              </button>
              <button
                className="hero-ghost-btn"
                title="Play a random outtake from the archive"
                onClick={() =>
                  player.shuffleQueue(queueSource, "home")
                }
              >
                <Shuffle size={15} strokeWidth={1.75} />
                <span>Shuffle an outtake</span>
              </button>
            </div>
          </div>
          <span className="hero-catno" aria-hidden="true">
            {vaultCatno({ id: hero.songId, title: hero.title })} · SIDE{" "}
            {vaultSide({ id: hero.songId, title: hero.title })}
          </span>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 className="section-pixel-title pixel-text">Featured Archive Artists</h2>
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

      <RailCards title="Alternate Takes" note="Songs with V2s" tracks={altTakes} railKey="home:alttakes" />
      <RailCards title="Deep Archive" note="Rotates weekly" tracks={deepCuts} railKey="home:deeparchive" />
    </>
  );
}
