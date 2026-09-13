"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, SkipForward, X } from "lucide-react";

import { extractYouTubeId, formatDuration, youtubeEmbedUrl } from "@/lib/utils";

interface ProbeInfo {
  playable: boolean;
  status: string;
  title: string;
  author: string;
  durationSec: number | null;
}

interface ReviewItem {
  id: string;
  youtubeUrl: string;
  suggestedArtist: string | null;
  suggestedTitle: string | null;
  note: string | null;
  status: string;
  probeResult: ProbeInfo | null;
  createdAt: string;
}

type Action = "approve" | "reject";

function prefill(item: ReviewItem) {
  return {
    artist: item.suggestedArtist || item.probeResult?.author || "",
    title: item.suggestedTitle || item.probeResult?.title || "",
  };
}

/** Focus-mode ear-check queue: one candidate, embedded player, keyboard
 *  shortcuts (A approve · R reject · S skip). Built for hundreds of rows. */
export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [infoBusy, setInfoBusy] = useState(false);
  const [fetchedProbe, setFetchedProbe] = useState<ProbeInfo | null>(null);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({ approved: 0, rejected: 0, skipped: 0 });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pending");
      const data = (await res.json()) as { pending?: ReviewItem[]; error?: string };
      if (res.ok && data.pending) {
        setItems(data.pending);
        setIdx(0);
      } else {
        setError(data.error ?? "Could not load queue");
      }
    } catch {
      setError("Queue unavailable — is the database configured?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = items[idx] ?? null;

  // Reset the form every time the focus item changes.
  useEffect(() => {
    if (!current) return;
    const p = prefill(current);
    setArtist(p.artist);
    setTitle(p.title);
    setFetchedProbe(null);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length]);

  const youtubeId = useMemo(
    () => (current ? extractYouTubeId(current.youtubeUrl) : null),
    [current],
  );

  const probe = fetchedProbe ?? current?.probeResult ?? null;

  async function fetchInfo() {
    if (!current || infoBusy) return;
    setInfoBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/verify?url=${encodeURIComponent(current.youtubeUrl)}`);
      const data = (await res.json()) as { probe?: ProbeInfo; error?: string };
      if (res.ok && data.probe) {
        setFetchedProbe(data.probe);
        if (!artist.trim() && data.probe.author) setArtist(data.probe.author);
        if (!title.trim() && data.probe.title) setTitle(data.probe.title);
      } else {
        setError(data.error ?? "Could not fetch video info");
      }
    } catch {
      setError("Network error");
    } finally {
      setInfoBusy(false);
    }
  }

  const advance = useCallback(
    (kind: Action | "skip") => {
      setStats((s) => ({
        approved: s.approved + (kind === "approve" ? 1 : 0),
        rejected: s.rejected + (kind === "reject" ? 1 : 0),
        skipped: s.skipped + (kind === "skip" ? 1 : 0),
      }));
      setItems((prev) => prev.filter((_, i) => i !== idx));
      // idx now points at the next item (or past the end → done state).
    },
    [idx],
  );

  const act = useCallback(
    async (kind: Action | "skip") => {
      if (!current || busy) return;
      if (kind === "skip") {
        advance("skip");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const body =
          kind === "approve"
            ? { id: current.id, artist: artist.trim(), title: title.trim() }
            : { id: current.id };
        const res = await fetch(`/api/admin/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (res.ok && data.ok) {
          advance(kind);
        } else {
          setError(data.error ?? `${kind} failed`);
        }
      } catch {
        setError("Network error");
      } finally {
        setBusy(false);
      }
    },
    [current, busy, artist, title, advance],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "a") void act("approve");
      else if (k === "r") void act("reject");
      else if (k === "s" || k === "arrowright") void act("skip");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  const done = stats.approved + stats.rejected + stats.skipped;
  const total = done + items.length;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="admin-h text-2xl font-extrabold tracking-tight">Review queue</h1>
          <p className="mt-1 text-mut">
            Ear-check mode — <kbd className="chip px-1.5">A</kbd> approve ·{" "}
            <kbd className="chip px-1.5">R</kbd> reject · <kbd className="chip px-1.5">S</kbd> skip
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-mut">
            {stats.approved} approved · {stats.rejected} rejected · {stats.skipped} skipped
          </p>
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : "Reload"}
          </button>
        </div>
      </header>

      {total > 0 ? (
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full rounded-full bg-[var(--color-gold)] transition-all"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
      ) : null}

      {error ? <p className="mb-6 rounded-lg border border-rose/40 p-4 text-sm text-rose">{error}</p> : null}

      {loading ? (
        <p className="flex items-center gap-2 text-mut">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      ) : !current ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <Check size={28} className="text-[var(--color-gold)]" />
          <p className="font-medium">Review queue clear.</p>
          <p className="text-sm text-mut">
            {done > 0
              ? `Session: ${stats.approved} shipped, ${stats.rejected} rejected, ${stats.skipped} skipped.`
              : "No pending candidates. New funnel rows will appear here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div>
            {youtubeId ? (
              <iframe
                key={current.id}
                src={youtubeEmbedUrl(youtubeId)}
                title="Review player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="aspect-video w-full rounded-2xl border border-line"
              />
            ) : (
              <p className="rounded-2xl border border-rose/40 p-6 text-sm text-rose">
                Not a valid YouTube URL — reject it.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mut">
              <span className="chip">
                {items.length} left · #{idx + 1} in view
              </span>
              {probe ? (
                <>
                  <span className={`chip ${probe.playable ? "" : "!text-rose"}`}>
                    {probe.playable ? "playable" : probe.status}
                  </span>
                  {probe.author ? <span className="chip">@{probe.author}</span> : null}
                  {probe.durationSec != null ? (
                    <span className="chip">{formatDuration(probe.durationSec)}</span>
                  ) : null}
                </>
              ) : (
                <button className="chip hover:text-fg" onClick={fetchInfo} disabled={infoBusy}>
                  {infoBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  fetch video info
                </button>
              )}
            </div>
            {current.note ? <p className="mt-3 text-sm text-mut">“{current.note}”</p> : null}
          </div>

          <div className="card space-y-4 p-6">
            <div>
              <label className="label" htmlFor="review-artist">
                Artist
              </label>
              <input
                id="review-artist"
                className="input"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist name"
              />
            </div>
            <div>
              <label className="label" htmlFor="review-title">
                Title
              </label>
              <input
                id="review-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Song title"
              />
            </div>
            <p className="break-all font-mono text-xs text-mut">{current.youtubeUrl}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button className="btn btn-gold" disabled={busy || !youtubeId} onClick={() => act("approve")}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Approve & ship
              </button>
              <button className="btn btn-ghost !text-rose" disabled={busy} onClick={() => act("reject")}>
                <X size={15} /> Reject
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => act("skip")}>
                <SkipForward size={15} /> Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
