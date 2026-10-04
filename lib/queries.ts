/**
 * The read path. Postgres is the only source of truth.
 *
 * Why this file exists: `getCatalog()` in lib/dataloader.ts rebuilt every array on
 * every call with no memoization, and pages called it two or three times each. At
 * 288 tracks that was tolerable. At 3,000 it is ~10 full catalog rebuilds per ISR
 * regeneration, and the home page serialized the whole catalog into client props —
 * 132 KB of HTML today, ~1.3 MB raw at 3,000 tracks.
 *
 * Every function here is a targeted, indexed query. Nothing loads the full catalog
 * unless the caller genuinely needs every row (the queue manifest and the sitemap
 * do; a song page does not).
 *
 * Paging shape: canonical songs carry the track, versions are attached as
 * `sources`. That matches lib/vault.ts `DeckSong`, which is what the player
 * consumes, so nothing has to be reshaped on the way to the client.
 */
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, type DB } from "./db";
import { artists, songs, songVersions } from "./schema";
import type { DeckSong, VersionSource } from "./vault";
import { slugify } from "./utils";

/**
 * Postgres is required. There is deliberately no bundle fallback here: the archive
 * is only trustworthy if every read comes from the verified catalog of record, and
 * a silent fallback would let the site serve rows that were confirmed dead.
 */
function db(): DB {
  const d = getDb();
  if (!d) {
    throw new Error(
      "DATABASE_URL is required. Neon is the source of truth for the archive — " +
        "see .env.example. (npm run db:push && npm run db:import to populate it.)",
    );
  }
  return d;
}

// ── Row → DeckSong ──────────────────────────────────────────────────────────

interface SongRow {
  id: string;
  title: string;
  youtubeId: string;
  durationSec: number | null;
  sourceCount: number;
  surfacedAt: Date;
  artistName: string;
  artistSlug: string;
}

interface VersionRow {
  songId: string;
  label: string | null;
  youtubeId: string;
  sortOrder: number;
}

const songCols = {
  id: songs.id,
  title: songs.title,
  youtubeId: songs.youtubeId,
  durationSec: songs.durationSec,
  sourceCount: songs.sourceCount,
  surfacedAt: songs.surfacedAt,
  artistName: artists.name,
  artistSlug: artists.slug,
};

/** Group active versions under their canonical, numbered V2..Vn by sortOrder. */
function attachVersions(songRows: SongRow[], versionRows: VersionRow[]): DeckSong[] {
  const bySong = new Map<string, VersionSource[]>();
  for (const v of versionRows) {
    const list = bySong.get(v.songId);
    if (list) list.push({ key: `v${v.sortOrder}`, num: `V${v.sortOrder + 1}`, name: v.label ?? `Version ${v.sortOrder + 1}`, vid: v.youtubeId });
    else bySong.set(v.songId, [{ key: `v${v.sortOrder}`, num: `V${v.sortOrder + 1}`, name: v.label ?? `Version ${v.sortOrder + 1}`, vid: v.youtubeId }]);
  }
  return songRows.map((s) => ({
    id: s.id,
    songId: s.id,
    title: s.title,
    artistName: s.artistName,
    artistSlug: s.artistSlug,
    youtubeId: s.youtubeId,
    durationSec: s.durationSec,
    sources: [
      { key: "canonical", num: "V1", name: "Original", vid: s.youtubeId },
      ...(bySong.get(s.id) ?? []),
    ],
  }));
}

// ── Artists ─────────────────────────────────────────────────────────────────

export interface ArtistView {
  slug: string;
  name: string;
  initials: string;
  tag: string | null;
  avatarUrl: string | null;
  bio: string | null;
  trackCount: number;
  activeCount: number;
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

/** Every artist with its active-track count. 88 rows — cheap and used by the grid. */
export async function getArtists(): Promise<ArtistView[]> {
  const rows = await db()
    .select({
      slug: artists.slug,
      name: artists.name,
      initials: artists.initials,
      tag: artists.tag,
      avatarUrl: artists.avatarUrl,
      bio: artists.bio,
      // Counted in the query rather than by hydrating every song row.
      trackCount: sql<number>`count(${songs.id})::int`,
      activeCount: sql<number>`count(${songs.id}) filter (where ${songs.status} = 'active')::int`,
    })
    .from(artists)
    .leftJoin(songs, eq(songs.artistId, artists.id))
    .groupBy(artists.id)
    .orderBy(asc(artists.name));

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    initials: r.initials ?? initialsOf(r.name),
    tag: r.tag ?? null,
    avatarUrl: r.avatarUrl ?? null,
    bio: r.bio ?? null,
    trackCount: r.trackCount,
    activeCount: r.activeCount,
  }));
}

export async function getArtistBySlug(slug: string): Promise<ArtistView | null> {
  const all = await getArtists();
  return all.find((a) => a.slug === slug) ?? null;
}

export async function getArtistSlugs(): Promise<string[]> {
  const rows = await db().select({ slug: artists.slug }).from(artists).orderBy(asc(artists.name));
  return rows.map((r) => r.slug);
}

// ── Songs ───────────────────────────────────────────────────────────────────

/**
 * Every active canonical with its active versions. This is the one function that
 * genuinely needs the whole catalog — the player's queue and the sitemap both want
 * all of it. It is served from ISR cache and from the CDN after that, so it runs
 * about once per revalidation window rather than per request.
 */
export async function getActiveSongs(): Promise<DeckSong[]> {
  const d = db();
  const [songRows, versionRows] = await Promise.all([
    d
      .select(songCols)
      .from(songs)
      .innerJoin(artists, eq(songs.artistId, artists.id))
      .where(eq(songs.status, "active"))
      .orderBy(asc(artists.name), asc(songs.title)),
    d
      .select({
        songId: songVersions.songId,
        label: songVersions.label,
        youtubeId: songVersions.youtubeId,
        sortOrder: songVersions.sortOrder,
      })
      .from(songVersions)
      .innerJoin(songs, eq(songVersions.songId, songs.id))
      .where(and(eq(songVersions.status, "active"), eq(songs.status, "active")))
      .orderBy(asc(songVersions.sortOrder)),
  ]);
  return attachVersions(songRows as SongRow[], versionRows as VersionRow[]);
}

/**
 * One artist's active tracks. Paged because an artist can hold 300+ rows and the
 * page only needs one screenful at a time.
 */
export async function getSongsForArtist(
  slug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DeckSong[]> {
  const d = db();
  const limit = Math.min(opts.limit ?? 500, 1000);
  const songRows = (await d
    .select(songCols)
    .from(songs)
    .innerJoin(artists, eq(songs.artistId, artists.id))
    .where(and(eq(artists.slug, slug), eq(songs.status, "active")))
    .orderBy(asc(songs.title))
    .limit(limit)
    .offset(opts.offset ?? 0)) as SongRow[];

  if (!songRows.length) return [];
  const ids = songRows.map((s) => s.id);
  const versionRows = (await d
    .select({
      songId: songVersions.songId,
      label: songVersions.label,
      youtubeId: songVersions.youtubeId,
      sortOrder: songVersions.sortOrder,
    })
    .from(songVersions)
    .where(and(eq(songVersions.status, "active"), inArray(songVersions.songId, ids)))
    .orderBy(asc(songVersions.sortOrder))) as VersionRow[];

  return attachVersions(songRows, versionRows);
}

/** A single song with its versions, or null. Keyed on songs.id (the source id). */
export async function getSongById(id: string): Promise<DeckSong | null> {
  const canonicalId = id.split("__v")[0] ?? id;
  const rows = await getSongsForArtistById(canonicalId);
  if (!rows.length) return null;
  const song = rows[0]!;

  // A version id resolves to that take when it is still playable.
  if (id !== canonicalId) {
    const n = Number(id.split("__v")[1]);
    const src = Number.isFinite(n) ? song.sources[n - 1] : undefined;
    if (src) {
      return { ...song, id, youtubeId: src.vid, sources: song.sources };
    }
  }
  return song;
}

async function getSongsForArtistById(id: string): Promise<DeckSong[]> {
  const d = db();
  const songRows = (await d
    .select(songCols)
    .from(songs)
    .innerJoin(artists, eq(songs.artistId, artists.id))
    .where(and(eq(songs.id, id), eq(songs.status, "active")))
    .limit(1)) as SongRow[];
  if (!songRows.length) return [];

  const versionRows = (await d
    .select({
      songId: songVersions.songId,
      label: songVersions.label,
      youtubeId: songVersions.youtubeId,
      sortOrder: songVersions.sortOrder,
    })
    .from(songVersions)
    .where(and(eq(songVersions.songId, id), eq(songVersions.status, "active")))
    .orderBy(asc(songVersions.sortOrder))) as VersionRow[];

  return attachVersions(songRows, versionRows);
}

/** Recently surfaced — the "new in the archive" rail and /today. */
export async function getRecentlySurfaced(limit = 20): Promise<DeckSong[]> {
  const d = db();
  const songRows = (await d
    .select(songCols)
    .from(songs)
    .innerJoin(artists, eq(songs.artistId, artists.id))
    .where(eq(songs.status, "active"))
    .orderBy(desc(songs.surfacedAt), asc(songs.title))
    .limit(limit)) as SongRow[];
  if (!songRows.length) return [];
  const ids = songRows.map((s) => s.id);
  const versionRows = (await d
    .select({
      songId: songVersions.songId,
      label: songVersions.label,
      youtubeId: songVersions.youtubeId,
      sortOrder: songVersions.sortOrder,
    })
    .from(songVersions)
    .where(and(eq(songVersions.status, "active"), inArray(songVersions.songId, ids)))
    .orderBy(asc(songVersions.sortOrder))) as VersionRow[];
  return attachVersions(songRows, versionRows);
}

// ── Counts ──────────────────────────────────────────────────────────────────

export interface CatalogCounts {
  artists: number;
  tracks: number;
  versions: number;
  pending: number;
}

export async function getCounts(): Promise<CatalogCounts> {
  const d = db();
  const [a, s, v] = await Promise.all([
    d.select({ n: count() }).from(artists),
    d.select({ n: count() }).from(songs).where(eq(songs.status, "active")),
    d.select({ n: count() }).from(songVersions).where(eq(songVersions.status, "active")),
  ]);
  return {
    artists: Number(a[0]?.n ?? 0),
    tracks: Number(s[0]?.n ?? 0),
    versions: Number(v[0]?.n ?? 0),
    pending: 0,
  };
}

/**
 * Compact queue manifest.
 *
 * Home and artist pages render a screenful of tracks, but the player needs the
 * whole queue when someone presses play. Shipping all of it as client props is
 * what makes the current home page 132 KB of HTML. This is columnar rather than
 * an array of objects because repeated key names are pure overhead once the data
 * is compressed — measured at 3,000 tracks: 33.8 KB brotli as objects vs 21.3 KB
 * columnar.
 *
 * Returned from an API route and fetched on first play, never inlined in HTML.
 */
export interface QueueManifest {
  /** schema version — the client throws away a manifest it does not understand */
  v: 1;
  /** [songId, title, artistSlug, artistName, youtubeId, durationSec, versionCount][] */
  rows: Array<[string, string, string, string, string, number | null, number]>;
  /** Per-artist track counts, so the client can filter a queue without re-parsing. */
  artistCounts: Record<string, number>;
}

export async function getQueueManifest(): Promise<QueueManifest> {
  const songsOut = await getActiveSongs();
  const artistCounts: Record<string, number> = {};
  for (const s of songsOut) artistCounts[s.artistSlug] = (artistCounts[s.artistSlug] ?? 0) + 1;
  return {
    v: 1,
    rows: songsOut.map((s) => [
      s.songId,
      s.title,
      s.artistSlug,
      s.artistName,
      s.youtubeId,
      s.durationSec,
      s.sources.length,
    ]),
    artistCounts,
  };
}

/** Slug for an arbitrary display name — kept here so callers never import utils directly. */
export { slugify };

/** Oldest-verified-first slice for the freshness sweep. Exported for scripts. */
export async function getStaleSongs(olderThan: Date, limit: number) {
  return db()
    .select({
      id: songs.id,
      youtubeId: songs.youtubeId,
      durationSec: songs.durationSec,
      status: songs.status,
      deadStreak: songs.deadStreak,
    })
    .from(songs)
    .where(or(isNull(songs.lastCheckedAt), sql`${songs.lastCheckedAt} < ${olderThan}`))
    .orderBy(sql`${songs.lastCheckedAt} asc nulls first`)
    .limit(limit);
}
