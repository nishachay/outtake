import Link from "next/link";
import { PlusCircle, RefreshCw } from "lucide-react";
import { and, count, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { pendingSubmissions, songs } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const db = getDb();

  let total = 0;
  let active = 0;
  let dead = 0;
  let blocked = 0;
  let unknown = 0;
  let pending = 0;
  let recent: Array<{ id: string; title: string; artist: string; at: Date | null }> = [];

  if (db) {
    const [byStatus, pendingRow, recentRows] = await Promise.all([
      db
        .select({ status: songs.status, n: count() })
        .from(songs)
        .groupBy(songs.status),
      db.select({ n: count() }).from(pendingSubmissions).where(eq(pendingSubmissions.status, "pending")),
      db
        .select({
          id: songs.id,
          title: songs.title,
          artist: sql<string>`(select name from artists where id = ${songs.artistId})`,
          at: songs.surfacedAt,
        })
        .from(songs)
        .orderBy(desc(songs.surfacedAt))
        .limit(5),
    ]);

    for (const row of byStatus) {
      const n = Number(row.n);
      total += n;
      if (row.status === "active") active += n;
      else if (row.status === "dead") dead += n;
      else if (row.status === "blocked") blocked += n;
      else if (row.status === "unknown") unknown += n;
    }
    pending = Number(pendingRow[0]?.n ?? 0);
    recent = recentRows as typeof recent;
  }

  /**
   * The status breakdown is the admin's most useful signal. `unknown` in
   * particular is the one to watch: it means a probe could not confirm the video
   * exists and the row has not yet missed twice, so the track is hidden but not
   * gone. A rising `unknown` count usually means the sweep is falling behind.
   */
  const stats = [
    { label: "Total tracks", value: total },
    { label: "Playable now", value: active },
    { label: "Blocked", value: blocked },
    { label: "Unconfirmed", value: unknown },
    { label: "Dead", value: dead },
    { label: "Pending review", value: pending },
  ];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="admin-h text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-mut">
            {db
              ? "The health of the archive at a glance."
              : "No database configured — set DATABASE_URL."}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            const { revalidatePath } = await import("next/cache");
            revalidatePath("/admin");
            revalidatePath("/");
          }}
        >
          <button className="btn btn-ghost" type="submit">
            <RefreshCw size={16} /> Refresh
          </button>
        </form>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <p className="text-sm text-mut">{s.label}</p>
            <p className="mt-2 text-4xl font-extrabold tracking-tight">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-4 font-bold">Recently surfaced</h2>
          {recent.length ? (
            <ul className="space-y-2 text-sm">
              {recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{t.title}</span>
                  <span className="chip">{t.artist}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mut">Nothing yet.</p>
          )}
        </div>

        <div className="card p-6">
          <h2 className="mb-4 font-bold">Actions</h2>
          <div className="grid gap-3">
            <Link href="/admin/songs" className="btn btn-gold w-full justify-between">
              <span className="flex items-center gap-2">
                <PlusCircle size={16} /> Add a song
              </span>
              <span>probe → approve</span>
            </Link>
            <Link href="/admin/review" className="btn btn-ghost w-full">
              Ear-check queue
            </Link>
            <Link href="/admin/pending" className="btn btn-ghost w-full">
              Review pending submissions ({pending})
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
