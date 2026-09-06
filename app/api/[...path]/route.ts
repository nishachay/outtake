import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ApiError, type Ctx } from "@/lib/api-core";
import * as api from "@/lib/api-core";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    if (key === "artists") return api.handleArtists(c);
    if (key === "songs") {
      return api.handleSongs(c, { all: search.get("all") === "1" });
    }
    if (key === "admin/verify") {
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
      return api.handleReport(c, body as Parameters<typeof api.handleReport>[1]);
    }
    if (key === "submit") {
      return api.handleSubmit(c, body as Parameters<typeof api.handleSubmit>[1]);
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