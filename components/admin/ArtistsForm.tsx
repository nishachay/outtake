"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import type { ArtistView } from "@/lib/dataloader";

interface StreamedArtist extends ArtistView {
  existing?: boolean;
}

export default function ArtistsAdminPage({
  artists,
}: {
  artists: ArtistView[];
}) {
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function createArtist() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), avatarUrl: avatarUrl.trim(), bio: bio.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; artist?: StreamedArtist; error?: string };
      if (res.ok && data.ok) {
        setMsg({
          ok: true,
          text: data.artist?.existing
            ? `"${data.artist.name}" already existed.`
            : `Created "${data.artist?.name}".`,
        });
        setName("");
        setAvatarUrl("");
        setBio("");
      } else {
        setMsg({ ok: false, text: data.error ?? "Failed" });
      }
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Artists</h1>
        <p className="mt-1 text-mut">Add an artist or review the roster.</p>
      </header>

      <div className="mb-10 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <form
          className="card space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            createArtist();
          }}
        >
          <h2 className="font-bold">New artist</h2>
          <div>
            <label className="label">Name *</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Frank Ocean" />
          </div>
          <div>
            <label className="label">Avatar URL (optional)</label>
            <input className="input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…/avatar.jpg" />
          </div>
          <div>
            <label className="label">Bio (optional)</label>
            <textarea className="input min-h-20 resize-y" value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <button className="btn btn-gold w-full" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Add artist
          </button>
          {msg ? (
            <p className={msg.ok ? "text-sm text-gold" : "text-sm text-rose"}>{msg.text}</p>
          ) : null}
        </form>

        <div className="card p-6">
          <h2 className="mb-4 font-bold">Roster ({artists.length})</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {artists.map((a) => (
              <li key={a.slug} className="rounded-lg border border-line px-3 py-2">
                <p className="text-sm font-semibold">{a.name}</p>
                <p className="text-xs text-mut">
                  {a.activeCount}/{a.trackCount} playable · /artist/{a.slug}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}