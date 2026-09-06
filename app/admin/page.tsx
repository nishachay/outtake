import Link from "next/link";
import { PlusCircle, RefreshCw } from "lucide-react";

import { getCatalog } from "@/lib/dataloader";
import { getDb } from "@/lib/db";
import { count, eq } from "drizzle-orm";
import { pendingSubmissions, songs } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const bundle = getCatalog();
  const active = bundle.tracks.filter((t) => t.status === "active");

  const db = getDb();
  let pendingCount = 0;
  let deadCount = 0;
  let playlistable: number | null = null;

  if (db) {
    try {
      const [pending] = await db
        .select({ n: count() })
        .from(pendingSubmissions)
        .where(eq(pendingSubmissions.status, "pending"));
      pendingCount = Number(pending?.n ?? 0);

      const [dead] = await db
        .select({ n: count() })
        .from(songs)
        .where(eq(songs.status, "dead"));
      deadCount = Number(dead?.n ?? 0);

      const [pct] = await db.select({ n: count() }).from(songs).where(eq(songs.status, "active"));
      playlistable = Number(pct?.n ?? 0);
    } catch {
      // DB reachable but query failed — degrade to bundled stats
    }
  }

  const stats = [
    { label: "Total tracks", value: bundle.tracks.length, display: true },
    {
      label: "Playable now",
      value: playlistable ?? active.length,
      display: true,
    },
    { label: "Dead / flagged", value: deadCount, display: db !== null },
    { label: "Pending review", value: pendingCount, display: db !== null },
  ];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-mut">The health of the vault at a glance.</p>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats
          .filter((s) => s.display)
          .map((s) => (
            <div key={s.label} className="card p-5">
              <p className="text-sm text-mut">{s.label}</p>
              <p className="mt-2 text-4xl font-extrabold tracking-tight">
                {s.value}
              </p>
            </div>
          ))}
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-4 font-bold">Recently added</h2>
          <ul className="space-y-2 text-sm">
            {bundle.tracks
              .filter((t) => !t.id.includes("__v"))
              .slice(0, 5)
              .map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{t.title}</span>
                  <span className="chip">{t.artistName}</span>
                </li>
              ))}
          </ul>
        </div>

        <div className="card p-6">
          <h2 className="mb-4 font-bold">Actions</h2>
          <div className="grid gap-3">
            <Link
              href="/admin/songs"
              className="btn btn-gold w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <PlusCircle size={16} /> Add a song
              </span>
              <span>probe → approve</span>
            </Link>
            <Link href="/admin/pending" className="btn btn-ghost w-full">
              Review pending submissions ({pendingCount})
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}