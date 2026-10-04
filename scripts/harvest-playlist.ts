/**
 * Harvest candidate videos from YouTube playlists into the `candidates` table.
 *
 * Run it in dry-run mode first. It never touches `songs` — that only happens in
 * scripts/promote-candidates.ts, and only after a human has listened.
 *
 *   npx tsx --env-file=.env scripts/harvest-playlist.ts PLxxxx [--artist "Kanye West"] [--apply]
 *
 * Enumeration uses playlistItems.list, not scraping. Scraping playlists is
 * prohibited by the YouTube consumer Terms §3 and Developer Policies
 * III.E.6/III.D.7/III.I.14, and the continuation endpoint a scraper would need is
 * Disallowed in robots.txt. The API costs 1 unit per 50 videos against a 10,000
 * unit daily allowance, so the whole 88-artist roster is a few hundred units.
 *
 * Repeated runs are cheap: candidates carry a unique constraint on
 * (source, youtubeId), so a video already seen from the same playlist is skipped
 * before it is probed and costs nothing.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";

import * as schema from "../lib/schema";
import { candidates, artists } from "../lib/schema";
import { slugify } from "../lib/utils";

const API = "https://www.googleapis.com/youtube/v3";

// Enough that a large playlist does not fall out of the quota in one page, but
// still one request per 50 items so the cost is predictable.
const PAGE = 50;

interface Args {
  playlists: string[];
  artist: string | null;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const playlists: string[] = [];
  let artist: string | null = null;
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--artist") artist = argv[++i] ?? null;
    else if (a === "--apply") apply = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else playlists.push(a);
  }

  if (!playlists.length) {
    throw new Error(
      "usage: harvest-playlist.ts <playlistId...> [--artist \"Name\"] [--apply]",
    );
  }
  return { playlists, artist, apply };
}

/** Accepts a bare id, a full watch URL with a list=, or a playlist URL. */
export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/)?.[1];
  if (fromUrl) return fromUrl;
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

interface PlaylistItem {
  videoId: string;
  title: string | null;
  author: string | null;
  position: number;
  /** The playlist slot exists but the video is removed or private. */
  gone: boolean;
}

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      "YOUTUBE_API_KEY is not set. Playlist enumeration has no compliant\n" +
        "alternative — scraping is prohibited by the YouTube Terms. Create a key at\n" +
        "console.cloud.google.com -> APIs & Services -> Credentials.",
    );
  }
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`);
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(`YouTube API 403: ${body.error?.message ?? "quota or access"}`);
  }
  if (!res.ok) throw new Error(`YouTube API ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/** Walk a playlist with playlistItems.list, following page tokens. */
async function fetchPlaylist(playlistId: string): Promise<PlaylistItem[]> {
  const out: PlaylistItem[] = [];
  let pageToken = "";

  do {
    const page = await yt<{
      items?: Array<{
        snippet?: {
          resourceId?: { videoId?: string };
          title?: string;
          videoOwnerChannelTitle?: string;
        };
        contentDetails?: { videoId?: string };
      }>;
      nextPageToken?: string;
    }>("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: String(PAGE),
      ...(pageToken ? { pageToken } : {}),
    });

    for (const item of page.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      // A removed or private entry still carries an id but is titled
      // "Deleted video" or "Private video", and the playlist keeps its slot.
      // Staging those is harmless — prefilter rejects them — but reporting them
      // separately makes the yield number mean something.
      if (!videoId) continue;
      const title = item.snippet?.title ?? null;
      const gone = title === "Deleted video" || title === "Private video";
      out.push({
        videoId,
        title: gone ? null : title,
        author: gone ? null : (item.snippet?.videoOwnerChannelTitle ?? null),
        position: out.length,
        gone,
      });
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);

  return out;
}

type DB = ReturnType<typeof makeDb>;

/** Resolve --artist to an artists.id, creating the row if it is new. */
async function resolveArtist(db: DB, name: string, apply: boolean): Promise<string | null> {
  const slug = slugify(name);
  const existing = await db.query.artists.findFirst({
    where: (a, { eq: e }) => e(a.slug, slug),
  });
  if (existing) return existing.id;

  if (!apply) return null;

  const created = await db
    .insert(artists)
    .values({ id: slug, slug, name, initials: initialsOf(name) })
    .returning({ id: artists.id });
  return created[0]?.id ?? null;
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

function makeDb(url: string) {
  return drizzle(neon(url), { schema });
}

async function main() {
  const { playlists, artist, apply } = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }
  const db = makeDb(url);

  const ids = playlists.map(extractPlaylistId);
  const bad = ids.filter((x): x is null => x === null);
  if (bad.length) {
    throw new Error(`could not read a playlist id from: ${bad.join(", ")}`);
  }

  const artistId = artist
    ? await resolveArtist(db, artist, apply)
    : null;
  if (artist && !apply && !artistId) {
    console.log(
      `artist "${artist}" does not exist yet — it would be created with slug "${slugify(artist)}"`,
    );
  }

  let totalNew = 0;
  let totalSeen = 0;

  for (const playlistId of ids as string[]) {
    process.stdout.write(`\n${playlistId}\n`);
    let items: PlaylistItem[];
    try {
      items = await fetchPlaylist(playlistId);
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const gone = items.filter((i) => i.gone).length;
    console.log(
      `  ${items.length} entries — ${items.length - gone} playable-looking, ${gone} removed/private`,
    );

    // One batched existence check rather than a query per video. At 500 videos
    // that is 1 query instead of 500.
    const videoIds = items.map((i) => i.videoId);
    const existing = await db
      .select({ youtubeId: candidates.youtubeId })
      .from(candidates)
      .where(
        and(
          eq(candidates.source, playlistId),
          inArray(candidates.youtubeId, videoIds),
        ),
      );
    const already = new Set(existing.map((r) => r.youtubeId));

    // Removed and private slots are not worth a probe — they are already known
    // dead, and staging them just adds rows for prefilter to reject.
    const fresh = items.filter((i) => !i.gone && !already.has(i.videoId));
    const skippedGone = items.filter((i) => i.gone).length;
    totalSeen += items.length;
    totalNew += fresh.length;

    console.log(
      `  ${already.size} already staged, ${skippedGone} skipped as removed, ${fresh.length} to stage`,
    );

    if (!fresh.length) continue;

    if (!apply) {
      for (const i of fresh.slice(0, 8)) {
        console.log(`    would stage ${i.videoId}  ${(i.title ?? "").slice(0, 58)}`);
      }
      if (fresh.length > 8) console.log(`    ... and ${fresh.length - 8} more`);
      continue;
    }

    await db
      .insert(candidates)
      .values(
        fresh.map((i) => ({
          id: `${playlistId}:${i.videoId}`,
          artistId,
          youtubeId: i.videoId,
          title: i.title,
          author: i.author,
          source: playlistId,
          sourceUrl: `https://www.youtube.com/watch?v=${i.videoId}`,
          status: "new" as const,
        })),
      )
      .onConflictDoNothing();

    console.log(`  staged ${fresh.length} candidates`);
  }

  console.log(
    `\ntotal: ${totalSeen} entries across ${ids.length} playlist(s), ${totalNew} to stage`,
  );
  if (!apply) {
    console.log("\nnothing was written. re-run with --apply to stage them.");
  } else {
    console.log(
      `\nstaged. next: npx tsx --env-file=.env scripts/promote-candidates.ts${artist ? ` --artist ${slugify(artist)}` : ""}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
