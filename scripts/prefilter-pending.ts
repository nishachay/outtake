/**
 * Mechanical pre-filter for the sourcing review queue.
 *
 *   npm run db:prefilter          (dry run — prints decisions, writes nothing)
 *   npm run db:prefilter:apply    (writes rejections + probe enrichment)
 *
 * Conservative by design: auto-reject only what is mechanically certain
 * (invalid id, already held, in-queue duplicate, unplayable probe,
 * non-audio reference like interviews/reactions). Duration extremes are
 * flagged for the ear-check, never auto-rejected — snippets can be short
 * and compilations can be long.
 *
 * On --apply, every verdict is recorded in probe_result.prefilter and
 * rejects are marked status=rejected (recoverable: /api/admin/approve
 * still ships a rejected row by id if a human disagrees).
 */
import { eq } from "drizzle-orm";

import { getDb } from "../lib/db";
import { getCatalog } from "../lib/dataloader";
import { probeYouTube, type ProbeResult } from "../lib/probe";
import { pendingSubmissions, songs, songVersions } from "../lib/schema";
import { extractYouTubeId } from "../lib/utils";

/** Matched against "<probe title> <probe author>" (lowercased). Keep tight:
 *  bare words like "review" or "live" nuke real song titles. */
const BLOCK_KEYWORDS = [
  "interview",
  "reaction",
  "documentary",
  "podcast",
  "trailer",
  "explained",
  "press conference",
  "red carpet",
  "live footage",
  "full concert",
  "album review",
  "track review",
];

const FLAG_SHORT_SEC = 30;
const FLAG_LONG_SEC = 1200;
const PROBE_THROTTLE_MS = 250;

type Verdict = "keep" | "flag" | "reject";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
    process.exit(1);
  }

  const rows = await db.query.pendingSubmissions.findMany({
    where: (p, { eq: e }) => e(p.status, "pending"),
    orderBy: (p, { asc: a }) => a(p.createdAt),
  });
  console.log(`${rows.length} pending rows. ${apply ? "APPLY mode — writing." : "Dry run — writing nothing."}`);

  // Everything already held: DB mirror + static bundle (belt and braces).
  const held = new Set<string>();
  for (const s of await db.select({ y: songs.youtubeId }).from(songs)) {
    if (s.y) held.add(s.y);
  }
  for (const v of await db.select({ y: songVersions.youtubeId }).from(songVersions)) {
    if (v.y) held.add(v.y);
  }
  for (const t of getCatalog().tracks) held.add(t.youtubeId);

  const seen = new Set<string>();
  let kept = 0;
  let flagged = 0;
  let rejected = 0;

  for (const row of rows) {
    const yid = extractYouTubeId(row.youtubeUrl);
    const reasons: string[] = [];
    let verdict: Verdict = "keep";
    let freshProbe: ProbeResult | null = null;

    if (!yid) {
      verdict = "reject";
      reasons.push("invalid youtube id");
    } else if (held.has(yid)) {
      verdict = "reject";
      reasons.push("already held in catalog");
    } else if (seen.has(yid)) {
      verdict = "reject";
      reasons.push("duplicate within queue (kept earliest)");
    } else {
      seen.add(yid);
      const stored = (row.probeResult ?? null) as ProbeResult | null;
      const probe = stored?.title ? stored : await probeYouTube(row.youtubeUrl);
      if (!stored?.title) {
        freshProbe = probe;
        await sleep(PROBE_THROTTLE_MS);
      }
      if (!probe.playable) {
        verdict = "reject";
        reasons.push(`not playable (${probe.status})`);
      } else {
        const hay = `${probe.title} ${probe.author}`.toLowerCase();
        const hit = BLOCK_KEYWORDS.find((k) => hay.includes(k));
        if (hit) {
          verdict = "reject";
          reasons.push(`non-audio reference (${hit})`);
        } else if (
          probe.durationSec != null &&
          (probe.durationSec < FLAG_SHORT_SEC || probe.durationSec > FLAG_LONG_SEC)
        ) {
          verdict = "flag";
          reasons.push(`duration ${probe.durationSec}s — confirm by ear`);
        }
      }
    }

    const tag = verdict === "reject" ? "REJECT" : verdict === "flag" ? "FLAG  " : "KEEP  ";
    console.log(`[${tag}] ${yid ?? row.youtubeUrl} — ${reasons.join("; ") || "clean"}`);

    if (apply) {
      const base = ((row.probeResult ?? {}) as Record<string, unknown>) ?? {};
      const next = {
        ...base,
        ...(freshProbe ? { ...freshProbe } : {}),
        prefilter: { at: new Date().toISOString(), verdict, reasons },
      } as unknown as Record<string, unknown>;
      if (verdict === "reject") {
        await db
          .update(pendingSubmissions)
          .set({ status: "rejected", reviewedAt: new Date(), probeResult: next })
          .where(eq(pendingSubmissions.id, row.id));
      } else {
        // keep/flag: enrich the row with probe metadata for the review UI.
        await db
          .update(pendingSubmissions)
          .set({ probeResult: next })
          .where(eq(pendingSubmissions.id, row.id));
      }
    }

    if (verdict === "reject") rejected++;
    else if (verdict === "flag") flagged++;
    else kept++;
  }

  console.log(`\nkeep=${kept} flag=${flagged} reject=${rejected}`);
  if (!apply) console.log("Dry run — re-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
