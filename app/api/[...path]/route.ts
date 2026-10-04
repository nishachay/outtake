import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ApiError, type Ctx } from "@/lib/api-core";
import * as api from "@/lib/api-core";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-instance fixed-window rate limit for the unauthenticated write endpoints.
 *
 * Deliberately in-memory and per-instance: this is one serverless function, so
 * the limit is approximate across concurrent instances rather than exact. That
 * is the right trade here — it stops the trivial submit-loop/spam case without
 * adding a Redis dependency or a network round-trip to the hot path. Do not treat
 * it as an abuse-prevention system of record.
 *
 * Admin requests bypass it: CI refreshes call in bursts by design.
 */
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  submit: { max: 5, windowMs: 60_000 },
  verify: { max: 30, windowMs: 60_000 },
};
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(bucket: string): boolean {
  const limit = RATE_LIMITS[bucket];
  if (!limit) return false;
  const now = Date.now();
  const entry = hits.get(bucket);
  if (!entry || entry.resetAt <= now) {
    hits.set(bucket, { count: 1, resetAt: now + limit.windowMs });
    return false;
  }
  entry.count++;
  // Opportunistic cleanup so the map cannot grow unbounded on a long-lived
  // instance.
  if (hits.size > 500) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  return entry.count > limit.max;
}

function isAdmin(req: NextRequest): Promise<boolean> {
  return (async () => {
    const bearer = req.headers.get("authorization");
    const expected = process.env.ADMIN_KEY;
    if (expected && bearer === `Bearer ${expected}`) return true;

    try {
      const session = await auth();
      return Boolean(session?.user);
    } catch {
      return false;
    }
  })();
}

async function wrap(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * `/api/manifest` is read once per client session on first play and then reused for
 * every queue, search and favorites lookup. It replaces passing the entire catalog
 * into client component props, which is what makes the home page 132 KB of HTML.
 *
 * Long CDN reuse is deliberate: a newly surfaced track reaches the artist page as
 * soon as that page revalidates, and `stale-while-revalidate` means a cold cache
 * never blocks a play. The payload carries a `v` schema version so a client can
 * discard a shape it does not understand rather than mis-reading it.
 */
async function wrapCached(fn: () => Promise<unknown>) {
  const res = await wrap(fn);
  if (res.status === 200) {
    res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  }
  return res;
}

async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

async function makeCtx(req: NextRequest): Promise<Ctx> {
  return { db: getDb(), admin: await isAdmin(req) };
}

// The catch-all lives at /api/[...path], so `path` never includes the leading
// "api" segment. e.g. /api/admin/verify -> path = ["admin","verify"].
function isAdminPath(key: string): boolean {
  return key.startsWith("admin/");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.join("/");
  const search = req.nextUrl.searchParams;
  const c = await makeCtx(req);

  return wrap(async () => {
    if (isAdminPath(key) && !c.admin) throw new ApiError(401, "unauthorized");

    if (key === "health") return api.handleHealth(c);
    if (key === "manifest") return wrapCached(() => api.handleQueueManifest(c));
    if (key === "artists") return api.handleArtists(c);
    if (key === "songs") {
      return api.handleSongs(c, { all: search.get("all") === "1" });
    }
    if (key === "admin/verify") {
      if (!c.admin && rateLimited("verify")) throw new ApiError(429, "too many requests");
      return api.handleAdminVerify(c, search.get("url") ?? "");
    }
    if (key === "admin/pending") {
      return api.handleAdminPending(c, { all: search.get("all") === "1" });
    }

    const song = key.match(/^songs\/(.+)$/);
    if (song) {
      return api.handleSongById(c, decodeURIComponent(song[1]!), {
        all: search.get("all") === "1",
      });
    }

    throw new ApiError(404, "endpoint not found");
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.join("/");
  const c = await makeCtx(req);
  const body = await readJson(req);

  return wrap(async () => {
    if (isAdminPath(key) && !c.admin) throw new ApiError(401, "unauthorized");

    if (key === "report") {
      return api.handleReport();
    }
    if (key === "submit") {
      if (rateLimited("submit")) throw new ApiError(429, "too many submissions — try again shortly");
      return api.handleSubmit(c, body);
    }
    if (key === "admin/approve") {
      return api.handleAdminApprove(c, body as Parameters<typeof api.handleAdminApprove>[1]);
    }
    if (key === "admin/reject") {
      return api.handleAdminReject(c, body as Parameters<typeof api.handleAdminReject>[1]);
    }
    if (key === "admin/artists") {
      return api.handleAdminAddArtist(c, body as Parameters<typeof api.handleAdminAddArtist>[1]);
    }
    if (key === "admin/songs") {
      return api.handleAdminAddSong(c, body as Parameters<typeof api.handleAdminAddSong>[1]);
    }
    if (key === "admin/refresh") {
      return api.handleAdminRefresh(c, body as Parameters<typeof api.handleAdminRefresh>[1]);
    }

    throw new ApiError(404, "endpoint not found");
  });
}