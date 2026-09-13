/**
 * Export shipped DB rows back into the static bundle.
 *
 *   npm run db:export          (DATABASE_URL from .env)
 *
 * Reads artists + active songs + active versions from Neon and merges them
 * into scripts/catalog.json — the file the public site is built from.
 * Merge, never mirror:
 *  - only `active` songs/versions are exported (dead/private stay out —
 *    the bundle must contain playable videos only);
 *  - catalog-only fields (artist initials/tag, song/version notes) are
 *    preserved; DB wins for title/youtubeId/duration;
 *  - rows absent from the DB are NEVER deleted (a partial DB must not
 *    wipe the bundle) — they are reported instead;
 *  - new artists get generated initials and a null tag (the UI falls
 *    back to "verified vault artist"); add real tags/portraits afterwards.
 *
 * Review the git diff, commit, redeploy. Run after review sessions.
 */
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../lib/db";
import { initials } from "../lib/utils";

import catalog from "../scripts/catalog.json";

const CATALOG_PATH = path.join(__dirname, "catalog.json");

interface CatalogArtist {
  slug: string;
  name: string;
  initials?: string | null;
  tag?: string | null;
  avatarUrl?: string | null;
}

interface CatalogVersion {
  label?: string | null;
  youtubeId: string;
  notes?: string | null;
}

interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  duration?: number | null;
  notes?: string | null;
  versions?: CatalogVersion[];
}

const RAW = catalog as { artists?: CatalogArtist[]; songs?: CatalogSong[] };

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
    process.exit(1);
  }

  const dbArtists = await db.query.artists.findMany({
    orderBy: (a, { asc: o }) => o(a.name),
  });
  const dbSongs = await db.query.songs.findMany({
    with: { artist: true, versions: true },
  });

  const prevArtists = new Map((RAW.artists ?? []).map((a) => [a.slug, a]));
  const prevSongs = new Map((RAW.songs ?? []).map((s) => [s.id, s]));
  const prevVersionNotes = new Map<string, string>();
  for (const s of RAW.songs ?? []) {
    for (const v of s.versions ?? []) {
      if (v.youtubeId && v.notes) prevVersionNotes.set(`${s.id}:${v.youtubeId}`, v.notes);
    }
  }

  // --- artists: keep file order, append new ones by name ---
  const artists: CatalogArtist[] = [];
  for (const a of RAW.artists ?? []) {
    const row = dbArtists.find((d) => d.slug === a.slug);
    artists.push({
      slug: a.slug,
      name: row?.name ?? a.name,
      initials: a.initials ?? initials(a.name),
      tag: a.tag ?? null,
      avatarUrl: row?.avatarUrl || a.avatarUrl || null,
    });
  }
  for (const d of dbArtists) {
    if (prevArtists.has(d.slug)) continue;
    artists.push({
      slug: d.slug,
      name: d.name,
      initials: initials(d.name),
      tag: null,
      avatarUrl: d.avatarUrl ?? null,
    });
    console.log(`+ artist: ${d.name}`);
  }

  // --- songs: active only, keep file order, append new ones ---
  const songs: CatalogSong[] = [];
  let skippedInactive = 0;
  let skippedVersions = 0;
  const seenDbIds = new Set<string>();

  const activeSongs = dbSongs
    .filter((s) => {
      if (s.status !== "active") {
        skippedInactive++;
        return false;
      }
      return true;
    })
    .sort((a, b) =>
      a.artist.name.localeCompare(b.artist.name) || a.title.localeCompare(b.title),
    );

  const toCatalogSong = (s: (typeof activeSongs)[number]): CatalogSong => {
    const prev = prevSongs.get(s.id);
    const versions: CatalogVersion[] = [...s.versions]
      .filter((v) => {
        if (v.status !== "active") {
          skippedVersions++;
          return false;
        }
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({
        label: v.label ?? null,
        youtubeId: v.youtubeId,
        notes: prevVersionNotes.get(`${s.id}:${v.youtubeId}`) ?? null,
      }));
    const out: CatalogSong = {
      id: s.id,
      title: s.title,
      artist: s.artist.name,
      youtubeId: s.youtubeId,
      duration: s.durationSec ?? prev?.duration ?? null,
      notes: s.notes ?? prev?.notes ?? null,
    };
    if (versions.length) out.versions = versions;
    return out;
  };

  for (const s of RAW.songs ?? []) {
    const row = activeSongs.find((d) => d.id === s.id);
    if (!row) continue; // absent from DB export set — never delete here (reported below)
    seenDbIds.add(row.id);
    songs.push(toCatalogSong(row));
  }
  for (const s of activeSongs) {
    if (seenDbIds.has(s.id)) continue;
    seenDbIds.add(s.id);
    songs.push(toCatalogSong(s));
    console.log(`+ song: ${s.artist.name} — ${s.title}`);
  }

  // Safety report: catalog rows the DB did not return (kept untouched).
  for (const s of RAW.songs ?? []) {
    if (!seenDbIds.has(s.id)) {
      console.log(`! kept (absent from DB): ${s.artist} — ${s.title} [${s.id}]`);
    }
  }

  fs.writeFileSync(CATALOG_PATH, JSON.stringify({ artists, songs }, null, 2) + "\n");
  console.log(
    `\nwrote ${CATALOG_PATH}: ${artists.length} artists, ${songs.length} songs ` +
      `(skipped ${skippedInactive} inactive songs, ${skippedVersions} inactive versions)`,
  );
  console.log("Review the diff, then commit + redeploy.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
