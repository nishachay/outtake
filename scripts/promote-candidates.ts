/**
 * Triage staged candidates and promote the keepers into `songs`.
 *
 *   npx tsx --env-file=.env scripts/promote-candidates.ts --artist kanye-west [--apply]
 *
 * Three outcomes per candidate:
 *
 *   reject   dead, private, blocked, malformed, duplicate of something already
 *            held, outside a sane duration, or matching the blocklist
 *   flag     playable but ambiguous — auto-rejected candidates never are, and
 *            anything the duration rules cannot decide waits for a human at
 *            /admin/review
 *   keep     playable, sane duration, not already held
 *
 * Dry run is the default. Nothing is written without --apply.
 *
 * Note this is separate from `npm run db:prefilter`, which triages the
 * `pending_submissions` table fed by the public /submit form. Both do the same
 * job against different tables.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray, sql } from "drizzle-orm";

import * as schema from "../lib/schema";
import { artists, candidates, songs, songVersions, versionIdOf } from "../lib/schema";
import { probeYouTube } from "../lib/probe";
import { slugify } from "../lib/utils";

/**
 * Titles that indicate the video is not a recording of the music. Deliberately
 * narrow: a bare "live" or "review" appears in legitimate demo titles.
 */
const BLOCK_KEYWORDS = [
  "interview",
  "reaction",
  "documentary",
  "podcast",
  "trailer",
  "explained",
  "press conference",
  "red carpet",
  "full concert",
  "album review",
  "track review",
];

const MIN_SEC = 30;
const MAX_SEC = 1200;

/** Probes in flight at once. oEmbed sends no Cache-Control and varies on
 *  Referer, so every probe is a real origin hit — 12 keeps it polite and fast. */
const CONCURRENCY = 12;

interface Args {
  artist: string | null;
  apply: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  let artist: string | null = null;
  let apply = false;
  let limit = 500;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--artist") artist = argv[++i] ?? null;
    else if (a === "--apply") apply = true;
    else if (a === "--limit") limit = Number(argv[++i]) || 500;
    else throw new Error(`unknown flag: ${a}`);
  }
  return { artist, apply, limit };
}

type DB = ReturnType<typeof makeDb>;
function makeDb(url: string) {
  return drizzle(neon(url), { schema });
}

async function main() {
  const { artist, apply, limit } = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const db = makeDb(url);

  let artistId: string | null = null;
  let artistName = "";
  if (artist) {
    const a = await db.query.artists.findFirst({
      where: (t, { eq: e }) => e(t.slug, artist),
    });
    if (!a) throw new Error(`no artist with slug "${artist}"`);
    artistId = a.id;
    artistName = a.name;
  }

  const batch = await db
    .select({
      id: candidates.id,
      artistId: candidates.artistId,
      youtubeId: candidates.youtubeId,
      title: candidates.title,
      author: candidates.author,
    })
    .from(candidates)
    .where(
      and(
        eq(candidates.status, "new"),
        artistId ? eq(candidates.artistId, artistId) : undefined,
      ),
    )
    .limit(limit);

  console.log(
    `${batch.length} new candidate(s)${artistName ? ` for ${artistName}` : ""}\n`,
  );
  if (!batch.length) {
    console.log("nothing to triage.");
    return;
  }

  // Everything already held anywhere: songs, versions, and any candidate from a
  // different playlist. Deduping on id alone would collapse legitimate collab
  // copies that belong to two artists.
  const held = new Set<string>();
  const heldSongs = await db.select({ id: songs.youtubeId }).from(songs);
  for (const s of heldSongs) held.add(s.id);
  const heldVersions = await db.select({ id: songVersions.youtubeId }).from(songVersions);
  for (const v of heldVersions) held.add(v.id);

  // Candidates already promoted from any other playlist. The batch is status
  // 'new', so there is no overlap with these and no id exclusion is needed.
  const promoted = await db
    .select({ youtubeId: candidates.youtubeId })
    .from(candidates)
    .where(inArray(candidates.status, ["keep", "shipped"]));
  for (const p of promoted) held.add(p.youtubeId);

  console.log(`${held.size} video id(s) already held\n`);

  type Outcome = "keep" | "flag" | "reject";
  const verdicts = new Map<
    string,
    { outcome: Outcome; reason: string; probe?: Awaited<ReturnType<typeof probeYouTube>> }
  >();

  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
    while (cursor < batch.length) {
      const c = batch[cursor++]!;
      if (!c) break;

      if (held.has(c.youtubeId)) {
        verdicts.set(c.id, { outcome: "reject", reason: "already held" });
        continue;
      }

      // Duration matters to the decision: without it nothing can be auto-kept,
      // because a 4-second clip and a 4-minute demo are both 'active'. It costs
      // one extra origin hit, and with the API key set that is a unit against a
      // 10,000/day allowance rather than a watch-page scrape. Pay it.
      const probe = await probeYouTube(c.youtubeId, { withDuration: true });

      if (probe.status === "invalid") {
        verdicts.set(c.id, { outcome: "reject", reason: "malformed id", probe });
        continue;
      }
      if (probe.status === "unknown") {
        // Could be private, deleted, or a network blip. Counted, not decided.
        verdicts.set(c.id, { outcome: "reject", reason: "unverifiable", probe });
        continue;
      }
      if (probe.status === "blocked") {
        verdicts.set(c.id, { outcome: "reject", reason: "embedding disabled", probe });
        continue;
      }

      const text = `${probe.title || c.title || ""} ${probe.author || c.author || ""}`.toLowerCase();
      const blocked = BLOCK_KEYWORDS.find((k) => text.includes(k));
      if (blocked) {
        verdicts.set(c.id, { outcome: "reject", reason: `blocklist: ${blocked}`, probe });
        continue;
      }

      const dur = probe.durationSec;
      if (dur !== null && (dur < MIN_SEC || dur > MAX_SEC)) {
        verdicts.set(c.id, {
          outcome: "reject",
          reason: `duration ${dur}s outside ${MIN_SEC}-${MAX_SEC}`,
          probe,
        });
        continue;
      }

      // A genuinely unknown duration is the only case a human has to settle.
      // Everything else with a sane duration is verified and playable, which is
      // the bar this project sets.
      verdicts.set(
        c.id,
        dur === null
          ? { outcome: "flag", reason: "duration unavailable — confirm by ear", probe }
          : { outcome: "keep", reason: `verified, ${dur}s`, probe },
      );
    }
  });
  await Promise.all(runners);

  const tally: Record<Outcome, number> = { keep: 0, flag: 0, reject: 0 };
  for (const v of verdicts.values()) tally[v.outcome]++;

  // Rejections and flags are the interesting output. Printing every keep would
  // bury them, and the keeps are already summarised in the tally.
  console.log("VERDICTS (rejections and flags)");
  for (const c of batch) {
    const v = verdicts.get(c.id);
    if (!v || v.outcome === "keep") continue;
    const tag = v.outcome === "flag" ? "FLAG  " : "REJECT";
    console.log(
      `  ${tag} ${c.youtubeId}  ${(c.title ?? "").slice(0, 44).padEnd(46)} ${v.reason}`,
    );
  }
  console.log(
    `\nkeep=${tally.keep} flag=${tally.flag} reject=${tally.reject} (of ${batch.length})`,
  );

  if (!apply) {
    console.log("\nnothing was written. re-run with --apply to commit these verdicts.");
    return;
  }

  for (const c of batch) {
    const v = verdicts.get(c.id);
    if (!v) continue;
    await db
      .update(candidates)
      .set({
        status: v.outcome === "keep" ? "keep" : v.outcome === "flag" ? "flag" : "rejected",
        rejectReason: v.outcome === "reject" ? v.reason : null,
        probeResult: v.probe ?? null,
        probedAt: new Date(),
      })
      .where(eq(candidates.id, c.id));
  }
  console.log(`\nwrote verdicts for ${batch.length} candidates.`);
  console.log(
    `${tally.keep} kept, ${tally.flag} awaiting review at /admin/review, ${tally.reject} rejected.`,
  );
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
