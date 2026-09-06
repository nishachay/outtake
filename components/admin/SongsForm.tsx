"use client";

import { useState } from "react";
import { Check, Loader2, Search, TriangleAlert } from "lucide-react";

interface ProbeShape {
  playable: boolean;
  status: "active" | "private" | "dead" | "invalid";
  title: string;
  author: string;
  durationSec: number | null;
  youtubeId: string;
  error?: string;
}

interface ArtistOpt {
  slug: string;
  name: string;
}

export default function SongsAdminPage({ artists }: { artists: ArtistOpt[] }) {
  const [url, setUrl] = useState("");
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [probe, setProbe] = useState<ProbeShape | null>(null);
  const [probing, setProbing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function runProbe() {
    setMsg(null);
    setProbe(null);
    setProbing(true);
    try {
      const res = await fetch(`/api/admin/verify?url=${encodeURIComponent(url.trim())}`);
      const data = (await res.json()) as { probe?: ProbeShape; error?: string };
      if (res.ok && data.probe) setProbe(data.probe);
      else setMsg({ ok: false, text: data.error ?? "Probe failed" });
    } catch {
      setMsg({ ok: false, text: "Network error during probe" });
    } finally {
      setProbing(false);
    }
  }

  async function approve() {
    if (!probe) return;
    setApproving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          artist: artist.trim(),
          title: title.trim() || probe.title,
          versionLabel: versionLabel.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; songId?: string; error?: string };
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: `Live under id ${data.songId}.` });
        setProbe(null);
        setUrl("");
        setTitle("");
        setVersionLabel("");
      } else {
        setMsg({ ok: false, text: data.error ?? "Approve failed" });
      }
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setApproving(false);
    }
  }

  const playable = !!probe?.playable;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Add song / version</h1>
        <p className="mt-1 text-mut">
          Paste a URL — we probe it live. Approve only becomes available when playable.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="card space-y-4 p-6">
          <div>
            <label className="label">YouTube URL *</label>
            <input
              className="input"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Artist *</label>
              <input
                className="input"
                list="artist-list"
                required
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Type or pick"
              />
              <datalist id="artist-list">
                {artists.map((a) => (
                  <option key={a.slug} value={a.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="label">Version label (optional)</label>
              <input
                className="input"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                placeholder="Demo Take 3"
              />
            </div>
          </div>

          <button className="btn btn-ghost w-full" onClick={runProbe} disabled={probing || !url.trim()}>
            {probing ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {probing ? "Probing…" : "Probe video"}
          </button>

          {probe ? (
            <div
              className={`rounded-xl border p-4 text-sm ${
                playable ? "border-gold/50" : "border-rose/50"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                <span className={playable ? "text-gold" : "text-rose"}>
                  {playable ? "Playable" : `Not playable (${probe.status})`}
                </span>
                {!playable ? <TriangleAlert size={15} /> : <Check size={15} />}
              </div>
              <p className="mt-2">Title: {probe.title || "—"}</p>
              <p>Author: {probe.author || "—"}</p>
              <p>Duration: {probe.durationSec ? `${probe.durationSec}s` : "—"}</p>
              {probe.error ? <p className="text-rose">{probe.error}</p> : null}
            </div>
          ) : null}

          {probe && playable ? (
            <div>
              <label className="label">Override title (optional)</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={probe.title}
              />
              <button className="btn btn-gold mt-4 w-full" onClick={approve} disabled={approving || !artist.trim()}>
                {approving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Approve → make live
              </button>
            </div>
          ) : null}

          {msg ? (
            <p className={msg.ok ? "text-sm text-gold" : "text-sm text-rose"}>{msg.text}</p>
          ) : null}
        </div>

        <div className="card p-6">
          <h2 className="mb-4 font-bold">How verify-first works</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-mut">
            <li>You paste a YouTube URL.</li>
            <li>We probe it (oEmbed) and show the real title, author, and playability.</li>
            <li>Nothing can become live unless the probe says playable.</li>
            <li>Public endpoints never set status — only this admin flow or the daily refresh can.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}