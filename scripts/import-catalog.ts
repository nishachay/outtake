/**
 * One-time / repeatable idempotent import of the curated catalog into Neon.
 *
 *   npm run db:import          (DATABASE_URL from .env)
 *
 * Reads scripts/catalog.json (the machine-verified 288-track slate), upserts
 * artists, canonical songs, and versions. Never deletes anything. Idempotent —
 * safe to run before the daily refresh job.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { artists, songs, songVersions, versionIdOf } from "../lib/schema";
import { slugify } from "../lib/utils";

import catalog from "../scripts/catalog.json";

const RAW = catalog as {
  artists?: Array<{ slug?: string; name: string; avatarUrl?: string | null; bio?: string | null }>;
  songs?: Array<{
    id: string;
    title: string;
    artist: string;
    youtubeId: string;
    duration?: number | null;
    notes?: string | null;
    status?: "active" | "dead" | "private";
    versions?: Array<{ label?: string; youtubeId: string; notes?: string | null }>;
  }>;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
    process.exit(1);
  }

  const sql = neon(url);
  const db = drizzle(sql);

  const artistSlugs = new Map<string, string>(); // name(lower) -> slug
  const artistIds = new Map<string, string>(); // slug -> id

  console.log("Importing artists…");
  for (const a of RAW.artists ?? []) {
    const slug = a.slug ?? slugify(a.name);
    artistSlugs.set(a.name.toLowerCase(), slug);
    artistIds.set(slug, slug);

    await db
      .insert(artists)
      .values({
        id: slug,
        slug,
        name: a.name,
        avatarUrl: a.avatarUrl ?? null,
        bio: a.bio ?? null,
      })
      .onConflictDoUpdate({
        target: artists.id,
        set: {
          slug,
          name: a.name,
          avatarUrl: a.avatarUrl ?? null,
          bio: a.bio ?? null,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`  ${artistIds.size} artists`);

  console.log("Importing songs…");
  let songCount = 0;
  let versionCount = 0;

  for (const s of RAW.songs ?? []) {
    const artistSlug = artistSlugs.get(s.artist.toLowerCase());
    if (!artistSlug) {
      console.warn(`  WARN: no artist for "${s.artist}" (song "${s.title}")`);
      continue;
    }

    await db
      .insert(songs)
      .values({
        id: s.id,
        artistId: artistSlug,
        title: s.title,
        slug: slugify(s.title),
        youtubeId: s.youtubeId,
        durationSec: s.duration ?? null,
        status: s.status ?? "active",
        lastCheckedAt: new Date(),
        notes: s.notes ?? null,
      })
      .onConflictDoUpdate({
        target: songs.id,
        set: {
          artistId: artistSlug,
          title: s.title,
          slug: slugify(s.title),
          youtubeId: s.youtubeId,
          durationSec: s.duration ?? null,
          status: s.status ?? "active",
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    songCount++;

    for (const [i, v] of (s.versions ?? []).entries()) {
      await db
        .insert(songVersions)
        .values({
          id: versionIdOf(s.id, i + 1),
          songId: s.id,
          label: v.label ?? `Version ${i + 1}`,
          youtubeId: v.youtubeId,
          status: "active",
          lastCheckedAt: new Date(),
          sortOrder: i + 1,
        })
        .onConflictDoUpdate({
          target: songVersions.id,
          set: { youtubeId: v.youtubeId, status: "active", lastCheckedAt: new Date() },
        });
      versionCount++;
    }
  }
  console.log(`  ${songCount} songs, ${versionCount} versions`);

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});