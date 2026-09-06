import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";

import type { DB } from "./db";
import { getCatalog } from "./dataloader";
import type { Variant } from "./dataloader";
import { probeYouTube, type ProbeResult } from "./probe";
import {
  artists,
  pendingSubmissions,
  reports,
  REPORT_THRESHOLD,
  songs,
  songVersions,
  versionIdOf,
  type SongStatus,
} from "./schema";
import { extractYouTubeId, slugify } from "./utils";

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

export async function handleHealth(ctx: Ctx) {
  if (!ctx.db) {
    const bundle = getCatalog();
    return {
      service: "outtake",
      status: "ok",
      mode: "static-fallback",
      time: new Date().toISOString(),
      artists: bundle.artists.length,
      tracks: bundle.tracks.filter((t) => t.status === "active").length,
    };
  }
  try {
    const artistCount = await ctx.db.select({ n: count() }).from(artists);
    const canonical = await ctx.db.select({ n: count() }).from(songs);
    return {
      service: "outtake",
      status: "ok",
      mode: "db",
      time: new Date().toISOString(),
      artists: artistCount[0]?.n ?? 0,
      tracks: canonical[0]?.n ?? 0,
    };
  } catch (err) {
    return { service: "outtake", status: "degraded", error: String(err) };
  }
}

export async function handleArtists(ctx: Ctx) {
  if (!ctx.db) {
    return { artists: getCatalog().artists };
  }
  try {
    const rows = await ctx.db
      .select({
        slug: artists.slug,
        name: artists.name,
        avatarUrl: artists.avatarUrl,
        bio: artists.bio,
        trackCount: count(songs.id),
      })
      .from(artists)
      .leftJoin(songs, eq(songs.artistId, artists.id))
      .groupBy(artists.id)
      .orderBy(asc(artists.name));
    return {
      artists: rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        avatarUrl: r.avatarUrl,
        bio: r.bio,
        trackCount: r.trackCount,
      })),
    };
  } catch {
    // DB set but momentarily unreachable — never 500 the public site.
    return { artists: getCatalog().artists };
  }
}

export async function handleSongs(ctx: Ctx, opts: { all?: boolean } = {}) {
  if (!ctx.db) {
    const bundle = getCatalog();
    const tracks = opts.all
      ? bundle.tracks
      : bundle.tracks.filter((t) => t.status === "active");
    return { songs: tracks };
  }
  try {
    return { songs: await dbSongs(ctx.db, opts.all ?? false) };
  } catch {
    const bundle = getCatalog();
    const tracks = opts.all
      ? bundle.tracks
      : bundle.tracks.filter((t) => t.status === "active");
    return { songs: tracks };
  }
}

export async function handleSongById(ctx: Ctx, id: string, opts: { all?: boolean } = {}) {
  const canon = id.includes("__v") ? id.split("__v")[0]! : id;

  if (!ctx.db) return staticSongById(id, canon, opts.all ?? false);

  try {
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
          reportCount: wantedVersion.reportCount,
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
          reportCount: songRow.reportCount,
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
        reportCount: v.reportCount,
      })),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // DB set but momentarily unreachable — never 500 the public site.
    return staticSongById(id, canon, opts.all ?? false);
  }
}

function staticSongById(id: string, canon: string, all: boolean) {
  const bundle = getCatalog();
  const variant = bundle.tracks.find((t) => t.id === id);
  if (!variant) throw new ApiError(404, "song not found");
  const versions = bundle.tracks.filter(
    (t) => t.songId === canon && t.id !== canon && (all || t.status === "active"),
  );
  return { song: variant, versions };
}

export async function handleReport(
  ctx: Ctx,
  body: { songId?: string; reason?: string; versionId?: string },
) {
  if (!ctx.db) throw new ApiError(503, "database unavailable");
  const songId = body.songId;
  if (!songId) throw new ApiError(400, "songId is required");

  let songRow;
  try {
    songRow = await ctx.db.query.songs.findFirst({ where: (s, { eq: e }) => e(s.id, songId) });
  } catch {
    throw new ApiError(503, "database unavailable");
  }
  if (!songRow) throw new ApiError(404, "song not found");

  const versionId = body.versionId ?? null;
  const targetVersion = versionId
    ? await ctx.db.query.songVersions.findFirst({
        where: (v, { eq: e }) => e(v.id, versionId),
      })
    : null;
  if (versionId && !targetVersion)
    throw new ApiError(404, "version not found; dead versions are hidden");

  await ctx.db.insert(reports).values({
    id: crypto.randomUUID(),
    songId,
    versionId: versionId ?? null,
    reason: body.reason ?? null,
  });

  if (targetVersion) {
    const next = targetVersion.reportCount + 1;
    await ctx.db
      .update(songVersions)
      .set({
        reportCount: next,
        status: next >= REPORT_THRESHOLD ? "dead" : targetVersion.status,
      })
      .where(eq(songVersions.id, targetVersion.id));
  } else {
    const next = songRow.reportCount + 1;
    await ctx.db
      .update(songs)
      .set({
        reportCount: next,
        status: next >= REPORT_THRESHOLD ? "dead" : songRow.status,
      })
      .where(eq(songs.id, songRow.id));
  }

  return { ok: true, reported: songId };
}

export async function handleSubmit(
  ctx: Ctx,
  body: { youtubeUrl?: string; suggestedArtist?: string; suggestedTitle?: string; note?: string },
) {
  if (!ctx.db) throw new ApiError(503, "database unavailable");
  const youtubeUrl = body.youtubeUrl?.trim();
  if (!youtubeUrl) throw new ApiError(400, "youtubeUrl is required");
  const id = extractYouTubeId(youtubeUrl);
  if (!id) throw new ApiError(400, "not a valid YouTube url or id");

  let inserted;
  try {
    inserted = await ctx.db
      .insert(pendingSubmissions)
      .values({
        id: crypto.randomUUID(),
        youtubeUrl,
        suggestedArtist: body.suggestedArtist?.trim() ?? null,
        suggestedTitle: body.suggestedTitle?.trim() ?? null,
        note: body.note?.trim() ?? null,
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

export async function handleAdminApprove(ctx: Ctx, body: { id?: string }) {
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

  const artistName = sub.suggestedArtist ?? probe.author;
  const created = await upsertSongFromProbe(ctx, {
    probe,
    artistName,
    title: sub.suggestedTitle ?? probe.title ?? null,
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

export async function handleAdminRefresh(
  ctx: Ctx,
  body: { force?: boolean } = {},
  limit = 60,
) {
  await requireAdmin(ctx);
  const staleness = body.force
    ? new Date(0)
    : new Date(Date.now() - 6 * 60 * 60 * 1000);

  const db = ctx.db!;
  const staleSongs = await db
    .select({
      id: songs.id,
      youtubeId: songs.youtubeId,
      durationSec: songs.durationSec,
      status: songs.status,
    })
    .from(songs)
    .where(
      or(isNull(songs.lastCheckedAt), sql`${songs.lastCheckedAt} < ${staleness}`),
    )
    .limit(limit);

  const staleVersions = await db
    .select({
      id: songVersions.id,
      youtubeId: songVersions.youtubeId,
      status: songVersions.status,
    })
    .from(songVersions)
    .where(
      or(isNull(songVersions.lastCheckedAt), sql`${songVersions.lastCheckedAt} < ${staleness}`),
    )
    .limit(limit);

  let probed = 0;
  const results: string[] = [];

  for (const s of staleSongs) {
    const probe = await probeYouTube(s.youtubeId);
    const nextStatus: SongStatus = probe.playable
      ? "active"
      : probe.status === "private"
        ? "private"
        : "dead";
    await db
      .update(songs)
      .set({
        status: nextStatus,
        durationSec: probe.durationSec ?? s.durationSec,
        lastCheckedAt: new Date(),
      })
      .where(eq(songs.id, s.id));
    probed++;
    results.push(`song:${s.youtubeId}:${probe.status}`);
  }

  for (const v of staleVersions) {
    const probe = await probeYouTube(v.youtubeId);
    const nextStatus: SongStatus = probe.playable
      ? "active"
      : probe.status === "private"
        ? "private"
        : "dead";
    await db
      .update(songVersions)
      .set({ status: nextStatus, lastCheckedAt: new Date() })
      .where(eq(songVersions.id, v.id));
    probed++;
    results.push(`version:${v.youtubeId}:${probe.status}`);
  }

  return { ok: true, probed, results };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dbSongs(db: DB, all: boolean): Promise<Variant[]> {
  const songRows = await db.query.songs.findMany({ with: { artist: true, versions: true } });

  const out: Variant[] = [];
  for (const s of songRows) {
    if (!all && s.status !== "active") continue;
    out.push({
      id: s.id,
      songId: s.id,
      title: s.title,
      youtubeId: s.youtubeId,
      artistName: s.artist.name,
      artistSlug: s.artist.slug,
      durationSec: s.durationSec,
      label: null,
      status: s.status as SongStatus,
      reportCount: s.reportCount,
    });
    for (const v of s.versions) {
      if (!all && v.status !== "active") continue;
      out.push({
        id: v.id,
        songId: s.id,
        title: v.label || s.title,
        youtubeId: v.youtubeId,
        artistName: s.artist.name,
        artistSlug: s.artist.slug,
        durationSec: s.durationSec,
        label: v.label ?? null,
        status: v.status as SongStatus,
        reportCount: v.reportCount,
      });
    }
  }
  return out;
}

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
    const inserted = await db
      .insert(artists)
      .values({ id: crypto.randomUUID(), slug: artistSlug, name: artistName, avatarUrl: null, bio: null })
      .returning();
    artistRow = inserted[0];
  }

  const existingSong = await db.query.songs.findFirst({
    where: (s, { or: o, and: a }) =>
      o(
        a(eq(s.artistId, artistRow!.id), eq(s.youtubeId, probe.youtubeId)),
        eq(s.id, probe.youtubeId),
      ),
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
    return { songId: existingSong.id, versionId: inserted[0]?.id ?? null };
  }

  // New canonical song. If the id would collide with another artist's song
  // (re-shared collab cut), keep a stable suffix so ids stay unique per artist.
  const idTaken = await db.query.songs.findFirst({
    where: (s, { eq: e }) => e(s.id, probe.youtubeId),
  });
  const fluffyId = idTaken ? `${probe.youtubeId}-b` : probe.youtubeId;

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