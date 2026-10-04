import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";

import type { DB } from "./db";
import { getArtists, getQueueManifest, type Variant } from "./queries";

import { probeYouTube, type ProbeResult } from "./probe";
import {
  artists,
  pendingSubmissions,
  songs,
  songVersions,
  versionIdOf,
  nextStatusFor,
  type SongStatus,
} from "./schema";
import { extractYouTubeId, initials as initialsOf, slugify } from "./utils";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Ctx {
  db: DB | null;
  admin: boolean;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Liveness plus a data-freshness signal.
 *
 * `oldestUnverifiedAt` is the thing to watch: the freshness sweep is
 * oldest-verified-first, so if that timestamp stops advancing the sweep is not
 * draining. Surfacing it here means "is the archive still trustworthy?" is
 * answerable from a single unauthenticated request.
 */
export async function handleHealth(ctx: Ctx) {
  if (!ctx.db) {
    return {
      service: "outtake",
      status: "degraded",
      mode: "no-database",
      time: new Date().toISOString(),
      error: "DATABASE_URL is not set — the archive cannot be read.",
    };
  }
  try {
    const d = ctx.db;
    const [artistCount, canonical, versions, oldest] = await Promise.all([
      d.select({ n: count() }).from(artists),
      d.select({ n: count() }).from(songs).where(eq(songs.status, "active")),
      d.select({ n: count() }).from(songVersions).where(eq(songVersions.status, "active")),
      d
        .select({ at: sql<Date | null>`min(${songs.lastCheckedAt})` })
        .from(songs)
        .where(eq(songs.status, "active")),
    ]);
    const oldestAt = oldest[0]?.at ? new Date(oldest[0].at).toISOString() : null;
    return {
      service: "outtake",
      status: "ok",
      mode: "db",
      time: new Date().toISOString(),
      artists: Number(artistCount[0]?.n ?? 0),
      tracks: Number(canonical[0]?.n ?? 0),
      versions: Number(versions[0]?.n ?? 0),
      oldestUnverifiedAt: oldestAt,
      oldestUnverifiedAgeHours: oldestAt
        ? Math.round((Date.now() - new Date(oldestAt).getTime()) / 36e5)
        : null,
    };
  } catch (err) {
    return { service: "outtake", status: "degraded", error: String(err) };
  }
}

export async function handleArtists(ctx: Ctx) {
  return { artists: await getArtists() };
}

/**
 * The whole catalog, columnar, for the client queue and search.
 *
 * Fetched once per session on first play rather than embedded in page props — see
 * components/vault/useCatalog.ts for the payload measurements.
 */
export async function handleQueueManifest(ctx: Ctx) {
  if (!ctx.db) throw new ApiError(503, "database unavailable");
  return getQueueManifest();
}

/**
 * Paged. At 3,000 tracks an unpaginated `?all=1` response is a ~700 KB JSON
 * payload on every call, which is a denial-of-service surface as much as a
 * performance problem. `total` comes from a separate count so a client can page
 * without fetching everything to learn how much there is.
 */
export async function handleSongs(
  ctx: Ctx,
  opts: { all?: boolean; limit?: number; offset?: number } = {},
) {
  if (!ctx.db) throw new ApiError(503, "database unavailable");
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where = opts.all ? undefined : eq(songs.status, "active");
  const [rows, totalRows] = await Promise.all([
    ctx.db
      .select({
        id: songs.id,
        songId: songs.id,
        title: songs.title,
        youtubeId: songs.youtubeId,
        durationSec: songs.durationSec,
        status: songs.status,
        surfacedAt: songs.surfacedAt,
        sourceCount: songs.sourceCount,
        artistName: artists.name,
        artistSlug: artists.slug,
      })
      .from(songs)
      .innerJoin(artists, eq(songs.artistId, artists.id))
      .where(where)
      .orderBy(asc(artists.name), asc(songs.title))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ n: count() }).from(songs).where(where),
  ]);

  return {
    total: Number(totalRows[0]?.n ?? 0),
    limit,
    offset,
    songs: rows.map((r) => ({
      ...r,
      status: r.status as SongStatus,
      surfacedAt: iso(r.surfacedAt),
    })),
  };
}

export async function handleSongById(ctx: Ctx, id: string, opts: { all?: boolean } = {}) {
  const canon = id.includes("__v") ? id.split("__v")[0]! : id;

  if (!ctx.db) throw new ApiError(503, "database unavailable");

  {
    const songRow = await ctx.db.query.songs.findFirst({
      with: { artist: true },
      where: (s, { eq: e }) => e(s.id, canon),
    });
    if (!songRow) throw new ApiError(404, "song not found");

    const versionRows = await ctx.db.query.songVersions.findMany({
      where: (v, { eq: e }) => e(v.songId, canon),
      orderBy: (v, { asc: a }) => a(v.sortOrder),
    });

    const playableVersions = versionRows.filter((v) => opts.all || v.status === "active");

    const wantedVersion =
      id.includes("__v") && !opts.all
        ? playableVersions.find((v) => v.id === id) ?? null
        : null;

    const artistName = songRow.artist.name;
    const artistSlug = songRow.artist.slug;

    const song: Variant = wantedVersion
      ? {
          id: wantedVersion.id,
          songId: canon,
          title: wantedVersion.label || songRow.title,
          youtubeId: wantedVersion.youtubeId,
          artistName,
          artistSlug,
          durationSec: songRow.durationSec,
          label: wantedVersion.label ?? null,
          status: wantedVersion.status as SongStatus,
          surfacedAt: iso(songRow.surfacedAt),
          sourceCount: 1 + playableVersions.length,
        }
      : {
          id: songRow.id,
          songId: canon,
          title: songRow.title,
          youtubeId: songRow.youtubeId,
          artistName,
          artistSlug,
          durationSec: songRow.durationSec,
          label: null,
          status: songRow.status as SongStatus,
          surfacedAt: iso(songRow.surfacedAt),
          sourceCount: 1 + playableVersions.length,
        };

    return {
      song,
      versions: playableVersions.map((v) => ({
        id: v.id,
        songId: canon,
        title: v.label || songRow.title,
        youtubeId: v.youtubeId,
        artistName,
        artistSlug,
        durationSec: songRow.durationSec,
        label: v.label ?? null,
        status: v.status as SongStatus,
        surfacedAt: iso(songRow.surfacedAt),
        sourceCount: 1 + playableVersions.length,
      })),
    };
  }
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Listener reports were retired: the player auto-falls through dead
 *  embeds and the daily refresh re-probes everything, so a separate
 *  report flow only added surface without adding trust. */
export async function handleReport() {
  throw new ApiError(410, "reports retired — dead links heal via auto-fallback + refresh");
}

/** Fields are length-capped so a single submission cannot bloat a row. */
const MAX_URL = 300;
const MAX_ARTIST = 120;
const MAX_TITLE = 200;
const MAX_NOTE = 1000;

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
};

export async function handleSubmit(ctx: Ctx, body: Record<string, unknown> = {}) {
  if (!ctx.db) throw new ApiError(503, "database unavailable");

  // Honeypot. A real browser leaves this hidden field empty; naive bots fill
  // every input they find.
  if (typeof body.website === "string" && body.website.trim()) {
    throw new ApiError(400, "rejected");
  }

  const youtubeUrl = clip(body.youtubeUrl, MAX_URL);
  if (!youtubeUrl) throw new ApiError(400, "youtubeUrl is required");
  if (!extractYouTubeId(youtubeUrl)) throw new ApiError(400, "not a valid YouTube url or id");

  const suggestedArtist = clip(body.suggestedArtist, MAX_ARTIST);
  const suggestedTitle = clip(body.suggestedTitle, MAX_TITLE);
  const note = clip(body.note, MAX_NOTE);

  // One open submission per source video. Without this a submit loop fills the
  // review queue with identical rows and the queue stops carrying signal.
  try {
    const dupe = await ctx.db
      .select({ id: pendingSubmissions.id })
      .from(pendingSubmissions)
      .where(
        and(
          eq(pendingSubmissions.youtubeUrl, youtubeUrl),
          eq(pendingSubmissions.status, "pending"),
        ),
      )
      .limit(1);
    if (dupe.length) throw new ApiError(409, "already submitted — it's in the review queue");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, "database unavailable");
  }

  let inserted;
  try {
    inserted = await ctx.db
      .insert(pendingSubmissions)
      .values({
        id: crypto.randomUUID(),
        youtubeUrl,
        suggestedArtist,
        suggestedTitle,
        note,
        status: "pending",
      })
      .returning();
  } catch {
    throw new ApiError(503, "database unavailable");
  }

  return { ok: true, id: inserted[0]?.id };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: Ctx) {
  if (!ctx.admin) throw new ApiError(401, "unauthorized");
  if (!ctx.db) throw new ApiError(503, "database unavailable");
  try {
    await ctx.db.execute(sql`select 1`);
  } catch {
    throw new ApiError(503, "database unavailable");
  }
}

export async function handleAdminVerify(_ctx: Ctx, url: string) {
  const result = await probeYouTube(url);
  return { probe: result };
}

export async function handleAdminPending(ctx: Ctx, opts: { all?: boolean } = {}) {
  await requireAdmin(ctx);
  const rows = await ctx.db!.query.pendingSubmissions.findMany({
    orderBy: (p, { asc: a }) => a(p.createdAt),
    ...(opts.all ? {} : { where: (p, { eq: e }) => e(p.status, "pending") }),
  });
  return { pending: rows };
}

export async function handleAdminApprove(
  ctx: Ctx,
  body: { id?: string; artist?: string; title?: string },
) {
  await requireAdmin(ctx);
  const id = body.id;
  if (!id) throw new ApiError(400, "id is required");

  const sub = await ctx.db!.query.pendingSubmissions.findFirst({
    where: (p, { eq: e }) => e(p.id, id),
  });
  if (!sub) throw new ApiError(404, "submission not found");

  const probe = await probeYouTube(sub.youtubeUrl);
  if (!probe.playable) {
    await ctx.db!
      .update(pendingSubmissions)
      .set({ status: "rejected", reviewedAt: new Date() })
      .where(eq(pendingSubmissions.id, id));
    throw new ApiError(422, `video is not playable (${probe.status})`);
  }

  // Reviewer corrections win; fall back to the submission, then the probe.
  const artistName = body.artist?.trim() || sub.suggestedArtist || probe.author;
  const created = await upsertSongFromProbe(ctx, {
    probe,
    artistName,
    title: body.title?.trim() || sub.suggestedTitle || probe.title || null,
    versionLabel: null,
  });

  await ctx.db!
    .update(pendingSubmissions)
    .set({
      status: "shipped",
      probeResult: probe as unknown as object,
      reviewedAt: new Date(),
    })
    .where(eq(pendingSubmissions.id, id));

  return { ok: true, ...created };
}

export async function handleAdminReject(ctx: Ctx, body: { id?: string }) {
  await requireAdmin(ctx);
  const id = body.id;
  if (!id) throw new ApiError(400, "id is required");
  const updated = await ctx.db!
    .update(pendingSubmissions)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(eq(pendingSubmissions.id, id))
    .returning();
  if (!updated.length) throw new ApiError(404, "submission not found");
  return { ok: true };
}

export async function handleAdminAddArtist(
  ctx: Ctx,
  body: { name?: string; slug?: string; avatarUrl?: string; bio?: string },
) {
  await requireAdmin(ctx);
  const name = body.name?.trim();
  if (!name) throw new ApiError(400, "name is required");
  const slug = body.slug?.trim() || slugify(name);
  if (!slug) throw new ApiError(400, "invalid slug");

  const existing = await ctx.db!.query.artists.findFirst({
    where: (a, { eq: e }) => e(a.slug, slug),
  });
  if (existing) return { ok: true, artist: existing, created: false };

  const inserted = await ctx.db!
    .insert(artists)
    .values({
      id: crypto.randomUUID(),
      slug,
      name,
      avatarUrl: body.avatarUrl?.trim() || null,
      bio: body.bio?.trim() || null,
    })
    .returning();

  return { ok: true, artist: inserted[0], created: true };
}

/** The add-song flow: probe first, never trust the client for status. */
export async function handleAdminAddSong(
  ctx: Ctx,
  body: {
    youtubeUrl?: string;
    artist?: string;
    title?: string;
    versionLabel?: string;
  },
) {
  await requireAdmin(ctx);
  const url = body.youtubeUrl?.trim();
  if (!url) throw new ApiError(400, "youtubeUrl is required");
  const artistName = body.artist?.trim();
  if (!artistName) throw new ApiError(400, "artist is required");

  const probe = await probeYouTube(url);
  if (!probe.playable) {
    throw new ApiError(422, `video is not playable (${probe.status})`);
  }

  const created = await upsertSongFromProbe(ctx, {
    probe,
    artistName,
    title: body.title ?? probe.title,
    versionLabel: body.versionLabel?.trim() || null,
  });

  return { ok: true, ...created, probe };
}

/**
 * Rolling freshness sweep, one bounded slice per call.
 *
 * The previous version selected 120 rows with no ordering and probed them
 * sequentially. Two failures followed: the oldest-verified rows were never
 * preferred, so a subset was re-probed forever while the rest starved, and 120
 * sequential network calls could not finish inside the function timeout, so the
 * daily job silently died partway through. At 3,000 tracks a full sweep needs to
 * be resumable, not bigger.
 *
 * Callers loop `while remaining > 0`. See .github/workflows/refresh.yml.
 */
export async function handleAdminRefresh(
  ctx: Ctx,
  body: { force?: boolean; budget?: number } = {},
  limit = 200,
) {
  await requireAdmin(ctx);
  const staleness = body.force
    ? new Date(0)
    : new Date(Date.now() - 6 * 60 * 60 * 1000);
  const budget = Math.max(1, Math.min(Number(body.budget ?? limit) || limit, 500));

  const db = ctx.db!;
  // Oldest verification first, never-checked rows first. Without this the sweep
  // re-picks the same arbitrary rows every run.
  const staleSongs = await db
    .select({
      id: songs.id,
      youtubeId: songs.youtubeId,
      durationSec: songs.durationSec,
      status: songs.status,
      deadStreak: songs.deadStreak,
    })
    .from(songs)
    .where(
      or(isNull(songs.lastCheckedAt), sql`${songs.lastCheckedAt} < ${staleness}`),
    )
    .orderBy(sql`${songs.lastCheckedAt} asc nulls first`)
    .limit(budget);

  const remainingBudget = Math.max(0, budget - staleSongs.length);
  const staleVersions = await db
    .select({
      id: songVersions.id,
      youtubeId: songVersions.youtubeId,
      status: songVersions.status,
      deadStreak: songVersions.deadStreak,
      durationSec: songVersions.durationSec,
    })
    .from(songVersions)
    .where(
      or(isNull(songVersions.lastCheckedAt), sql`${songVersions.lastCheckedAt} < ${staleness}`),
    )
    .orderBy(sql`${songVersions.lastCheckedAt} asc nulls first`)
    .limit(remainingBudget);

  let probed = 0;
  const results: string[] = [];
  // oEmbed has no Cache-Control and varies on Referer, so every probe is a real
  // origin hit. Twenty at a time keeps a 200-row slice inside the function
  // timeout without hammering youtube.com from a single-threaded loop.
  const CONCURRENCY = 20;

  const runPool = async <T,>(items: T[], worker: (item: T) => Promise<void>) => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (item === undefined) break;
        await worker(item);
      }
    });
    await Promise.all(runners);
  };

  await runPool(staleSongs, async (s) => {
    // Skip the duration fetch unless we actually need it — it costs an extra
    // origin hit (or a Data API unit) and is the reason a full sweep used to
    // blow past the function timeout.
    const needsDuration = s.durationSec == null;
    const probe = await probeYouTube(s.youtubeId, { withDuration: needsDuration });
    const next = nextStatusFor(s.status as SongStatus, probe, s.deadStreak);
    await db
      .update(songs)
      .set({
        status: next.status,
        deadStreak: next.deadStreak,
        durationSec: probe.durationSec ?? s.durationSec,
        lastCheckedAt: new Date(),
      })
      .where(eq(songs.id, s.id));
    probed++;
    results.push(`song:${s.youtubeId}:${probe.status}->${next.status}`);
  });

  await runPool(staleVersions, async (v) => {
    const needsDuration = v.durationSec == null;
    const probe = await probeYouTube(v.youtubeId, { withDuration: needsDuration });
    const next = nextStatusFor(v.status as SongStatus, probe, v.deadStreak);
    await db
      .update(songVersions)
      .set({
        status: next.status,
        deadStreak: next.deadStreak,
        durationSec: probe.durationSec ?? v.durationSec,
        lastCheckedAt: new Date(),
      })
      .where(eq(songVersions.id, v.id));
    probed++;
    results.push(`version:${v.youtubeId}:${probe.status}->${next.status}`);
  });

  // One more cheap count so the caller knows whether to loop again. This is what
  // turns a timeout-prone single drain into a resumable job.
  const [stillStaleSongs] = await db
    .select({ n: count() })
    .from(songs)
    .where(or(isNull(songs.lastCheckedAt), sql`${songs.lastCheckedAt} < ${staleness}`));
  const [stillStaleVersions] = await db
    .select({ n: count() })
    .from(songVersions)
    .where(
      or(isNull(songVersions.lastCheckedAt), sql`${songVersions.lastCheckedAt} < ${staleness}`),
    );
  const remaining = Number(stillStaleSongs?.n ?? 0) + Number(stillStaleVersions?.n ?? 0);

  // `results` is capped: a 500-row slice would otherwise return a few thousand
  // lines of JSON and burn response time for no operational value.
  return {
    ok: true,
    probed,
    remaining,
    done: remaining === 0,
    results: results.slice(0, 50),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


interface UpsertSongArgs {
  probe: ProbeResult;
  artistName: string;
  title: string | null;
  versionLabel?: string | null;
}

/**
 * The only path that can create an ACTIVE song. The probe must already be
 * playable. Upserts the artist (auto-registers song-only collab artists), then
 * either creates the canonical song or, if this artist already owns a song with
 * that youtube id, appends a version.
 */
async function upsertSongFromProbe(
  ctx: Ctx,
  args: UpsertSongArgs,
): Promise<{ songId: string; versionId: string | null }> {
  await requireAdmin(ctx);
  const db = ctx.db!;
  const { probe, artistName, versionLabel } = args;
  const title = args.title?.trim() || probe.title || `Untitled (${probe.youtubeId})`;

  const artistSlug = slugify(artistName);
  let artistRow = await db.query.artists.findFirst({
    where: (a, { eq: e }) => e(a.slug, artistSlug),
  });
  if (!artistRow) {
    // id = slug, matching scripts/import-catalog.ts. The admin API used to write
    // randomUUID() here, which meant imports and admin-created artists never
    // reconciled on the same row. Lookup is by slug either way, so switching to
    // slug is safe going forward; existing UUID rows keep working untouched.
    const inserted = await db
      .insert(artists)
      .values({ id: artistSlug, slug: artistSlug, name: artistName, avatarUrl: null, bio: null })
      .returning();
    artistRow = inserted[0];
  }

  // Scope every branch to the artist. This query used to OR in a global
  // `id === probe.youtubeId` match, so if any artist already owned that video the
  // lookup succeeded regardless of who was being added — the video was appended
  // as an extra version of *their* song and the new artist silently got nothing.
  // That also made the -b copy path below unreachable for exactly the case it
  // exists to handle.
  const existingSong = await db.query.songs.findFirst({
    where: (s, { and: a }) => a(eq(s.artistId, artistRow!.id), eq(s.youtubeId, probe.youtubeId)),
  });

  if (existingSong) {
    const nextIndex = await db
      .select({ n: count() })
      .from(songVersions)
      .where(eq(songVersions.songId, existingSong.id));
    const idx = Number(nextIndex[0]?.n ?? 0);
    const inserted = await db
      .insert(songVersions)
      .values({
        id: versionIdOf(existingSong.id, idx + 1),
        songId: existingSong.id,
        label: versionLabel ?? `Version ${idx + 1}`,
        youtubeId: probe.youtubeId,
        status: "active",
        lastCheckedAt: new Date(),
        sortOrder: idx + 1,
      })
      .returning();
    // Keep the denormalized take count honest for the discovery rail.
    await db
      .update(songs)
      .set({ sourceCount: sql`${songs.sourceCount} + 1` })
      .where(eq(songs.id, existingSong.id));
    return { songId: existingSong.id, versionId: inserted[0]?.id ?? null };
  }

  // New canonical song for this artist. Song ids are the source id so
  // `/song/[id]` is stable, but one video can belong to several artists (collab
  // cuts, re-shared leaks) and ids are globally unique. Allocate the first free
  // variant instead of checking once — the old single check collided again on
  // the third artist and the insert would throw.
  let fluffyId = probe.youtubeId;
  for (let n = 1; n <= 50; n++) {
    const taken = await db.query.songs.findFirst({
      where: (s, { eq: e }) => e(s.id, fluffyId),
      columns: { id: true },
    });
    if (!taken) break;
    fluffyId = `${probe.youtubeId}-b${n === 1 ? "" : n}`;
  }

  const inserted = await db
    .insert(songs)
    .values({
      id: fluffyId,
      artistId: artistRow!.id,
      title,
      slug: slugify(title),
      youtubeId: probe.youtubeId,
      durationSec: probe.durationSec,
      status: "active",
      lastCheckedAt: new Date(),
    })
    .returning();

  return { songId: inserted[0]?.id ?? fluffyId, versionId: null };
}