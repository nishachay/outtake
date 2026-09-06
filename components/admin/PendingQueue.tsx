"use client";

import { useEffect, useState } from "react";
import { Check, Inbox, Loader2, X } from "lucide-react";

interface PendingItem {
  id: string;
  youtubeUrl: string;
  suggestedArtist: string | null;
  suggestedTitle: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

export default function PendingAdminPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pending");
      const data = (await res.json()) as { pending?: PendingItem[]; error?: string };
      if (res.ok && data.pending) setItems(data.pending);
      else setError(data.error ?? "Could not load queue");
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

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setItems((prev) => prev.filter((p) => p.id !== id));
      } else {
        setError(data.error ?? `${action} failed`);
      }
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Pending queue</h1>
          <p className="mt-1 text-mut">Public submissions waiting for verification.</p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : "Refresh"}
        </button>
      </header>

      {error ? <p className="mb-6 rounded-lg border border-rose/40 p-4 text-sm text-rose">{error}</p> : null}

      {loading ? (
        <p className="flex items-center gap-2 text-mut">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <Inbox size={28} className="text-mut" />
          <p className="font-medium">Queue is clear.</p>
          <p className="text-sm text-mut">New public submissions will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id} className="card flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="break-all font-mono text-sm text-gold">{p.youtubeUrl}</p>
                <p className="mt-1 truncate text-sm">
                  {p.suggestedArtist ? <span className="font-semibold">{p.suggestedArtist}</span> : null}
                  {p.suggestedArtist && p.suggestedTitle ? " · " : ""}
                  {p.suggestedTitle ?? ""}
                </p>
                {p.note ? <p className="mt-1 text-sm text-mut">“{p.note}”</p> : null}
                <p className="mt-1 text-xs text-mut">{new Date(p.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="btn btn-gold"
                  disabled={busyId === p.id}
                  onClick={() => act(p.id, "approve")}
                >
                  {busyId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Verify & ship
                </button>
                <button
                  className="btn btn-ghost !text-rose"
                  disabled={busyId === p.id}
                  onClick={() => act(p.id, "reject")}
                >
                  <X size={15} /> Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}