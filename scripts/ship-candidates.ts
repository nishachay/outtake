/**
 * Promote verified candidates into `songs`, then revalidate the affected pages.
 *
 *   npx tsx --env-file=.env scripts/ship-candidates.ts --artist kanye-west [--apply]
 *
 * Runs after promote-candidates.ts. Only candidates marked `keep` are eligible,
 * which means each one has passed a live oEmbed probe. Nothing else writes
 * `active` except this and the admin approval flow.
 *
 * Videos already held by another artist become alternate takes rather than new
 * canonicals, and genuinely new videos get a canonical row. That distinction
 * matters for collab cuts, which belong to two artists' pages.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";

import * as schema from "../lib/schema";
import { artists, candidates, songs, songVersions, versionIdOf } from "../lib/schema";
import { slugify } from "../lib/utils";

type DB = ReturnType<typeof makeDb>;
function makeDb(url: string) {
  return drizzle(neon(url), { schema });
}

interface Args {
  artist: string | null;
  apply: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  let artist: string | null = null;
  let apply = false;
  let limit = 200;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--artist") artist = argv[++i] ?? null;
    else if (a === "--apply") apply = true;
    else if (a === "--limit") limit = Number(argv[++i]) || 200;
    else throw new Error(`unknown flag: ${a}`);
  }
  return { artist, apply, limit };
}

async function main() {
  const { artist, apply, limit } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const db = makeDb(url);

  let artistId: string | null = null;
  if (artist) {
    const a = await db.query.artists.findFirst({
      where: (t, { eq: e }) => e(t.slug, artist),
    });
    if (!a) throw new Error(`no artist with slug "${artist}"`);
    artistId = a.id;
  }

  const batch = await db
    .select({
      id: candidates.id,
      artistId: candidates.artistId,
      youtubeId: candidates.youtubeId,
      title: candidates.title,
      probeResult: candidates.probeResult,
    })
    .from(candidates)
    .where(
      and(
        eq(candidates.status, "keep"),
        artistId ? eq(candidates.artistId, artistId) : undefined,
      ),
    )
    .limit(limit);

  console.log(`${batch.length} verified candidate(s) ready to ship\n`);
  if (!batch.length) {
    console.log("nothing to ship.");
    return;
  }

  let canonicals = 0;
  let versions = 0;

  // A candidate staged without --artist, or promoted before its artist was
  // created, has no artistId. Narrow once so the rest of the loop is non-null.
  const pending = batch.filter((c): c is typeof c & { artistId: string } =>
    Boolean(c.artistId ?? artistId),
  );
  const orphans = batch.length - pending.length;
  if (orphans) console.warn(`  skipping ${orphans} candidate(s) with no artist assigned
`);

  for (const c of pending) {
    const probe = (c.probeResult ?? null) as { title?: string; durationSec?: number } | null;
    const title = probe?.title || c.title || `Untitled (${c.youtubeId})`;

    // Does this artist already have a canonical row for the video?
    const own = await db.query.songs.findFirst({
      where: (s, { and: a, eq: e }) =>
        a(e(s.artistId, c.artistId), e(s.youtubeId, c.youtubeId)),
    });

    if (own) {
      // Same artist, already a canonical. Nothing to add.
      continue;
    }

    // Does another artist already hold this video? Then it belongs on this
    // artist's page as an alternate take.
    const otherArtist = await db.query.songs.findFirst({
      where: (s, { eq: e }) => e(s.youtubeId, c.youtubeId),
    });

    if (otherArtist && otherArtist.artistId !== c.artistId) {
      const existingVersions = await db.query.songVersions.findMany({
        where: (v, { eq: e }) => e(v.songId, otherArtist.id),
      });
      const alreadyThere = existingVersions.some(
        (v) => v.youtubeId === c.youtubeId,
      );
      if (alreadyThere) continue;

      const n = existingVersions.length + 1;
      if (!apply) {
        console.log(
          `  would add alternate take ${n} to "${otherArtist.title}" (${c.youtubeId})`,
        );
      } else {
        await db.insert(songVersions).values({
          id: versionIdOf(otherArtist.id, n),
          songId: otherArtist.id,
          label: title,
          youtubeId: c.youtubeId,
          durationSec: probe?.durationSec ?? null,
          status: "active",
          lastCheckedAt: new Date(),
          sortOrder: n,
        });
        await db
          .update(songs)
          .set({ sourceCount: existingVersions.length + 2 })
          .where(eq(songs.id, otherArtist.id));
        await db
          .update(candidates)
          .set({ status: "shipped" })
          .where(eq(candidates.id, c.id));
        versions++;
      }
      continue;
    }

    // New canonical. Song ids are the source id, so /song/<id> is stable; if
    // that id is taken by another artist's copy, suffix rather than collide.
    let songId = c.youtubeId;
    for (let n = 1; n <= 50; n++) {
      const taken = await db.query.songs.findFirst({
        where: (s, { eq: e }) => e(s.id, songId),
        columns: { id: true },
      });
      if (!taken) break;
      songId = `${c.youtubeId}-b${n === 1 ? "" : n}`;
    }

    if (!apply) {
      console.log(`  would create "${title}" as ${songId}`);
    } else {
      await db.insert(songs).values({
        id: songId,
        artistId: c.artistId,
        title,
        slug: slugify(title),
        youtubeId: c.youtubeId,
        durationSec: probe?.durationSec ?? null,
        status: "active",
        lastCheckedAt: new Date(),
        surfacedAt: new Date(),
        sourceCount: 1,
      });
      await db
        .update(candidates)
        .set({ status: "shipped" })
        .where(eq(candidates.id, c.id));
      canonicals++;
    }
  }

  console.log(
    `\n${apply ? "shipped" : "would ship"}: ${canonicals} new track(s), ${versions} alternate take(s)`,
  );

  if (!apply) {
    console.log("\nnothing was written. re-run with --apply to commit.");
    return;
  }

  // ISR caches are per-deployment and do not exist in a standalone script, so
  // revalidatePath throws here ("static generation store missing"). That is
  // expected outside a Next.js runtime. Pages pick the new tracks up on their
  // next scheduled revalidation, or immediately after the next deploy.
  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/");
    if (artistId) {
      const a = await db.query.artists.findFirst({
        where: (t, { eq: e }) => e(t.id, artistId!),
        columns: { slug: true },
      });
      if (a) revalidatePath(`/artist/${a.slug}`);
    }
    console.log("revalidated / and the artist page.");
  } catch {
    console.log(
      "pages will pick these up on their next ISR window, or after the next deploy",
    );
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
