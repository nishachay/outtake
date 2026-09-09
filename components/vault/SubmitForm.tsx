/** "Found an outtake?" submission form in the vault pill language. */
"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";

export default function SubmitForm() {
  const [url, setUrl] = useState("");
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || state === "sending") return;
    setState("sending");
    setMessage("");
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          suggestedArtist: artist.trim() || undefined,
          suggestedTitle: title.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data as { ok?: boolean }).ok) {
        setState("sent");
        setMessage("Locked in — the vault will probe this link before it ships.");
        setUrl("");
        setArtist("");
        setTitle("");
        setNote("");
      } else {
        setState("error");
        setMessage((data as { error?: string }).error || "Could not queue that link — try again.");
      }
    } catch {
      setState("error");
      setMessage("Vault unreachable — try again in a moment.");
    }
  };

  return (
    <form className="vault-form" onSubmit={submit}>
      <div className="vault-field">
        <label htmlFor="outtake-url">YouTube link</label>
        <input
          id="outtake-url"
          className="vault-input"
          placeholder="https://youtube.com/watch?v=…"
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
      </div>
      <div className="vault-field">
        <label htmlFor="outtake-artist">Artist (optional)</label>
        <input
          id="outtake-artist"
          className="vault-input"
          placeholder="Who's vault is this from?"
          autoComplete="off"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        />
      </div>
      <div className="vault-field">
        <label htmlFor="outtake-title">Title (optional)</label>
        <input
          id="outtake-title"
          className="vault-input"
          placeholder="What should we call it?"
          autoComplete="off"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="vault-field">
        <label htmlFor="outtake-note">Note (optional)</label>
        <textarea
          id="outtake-note"
          className="vault-textarea"
          placeholder="Era, leak story, alternate takes…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <button className="vault-submit-btn" type="submit" disabled={state === "sending" || !url.trim()}>
        {state === "sending" ? (
          <LoaderCircle size={15} strokeWidth={2} style={{ animation: "svg-spin 1s linear infinite" }} />
        ) : (
          <Send size={15} strokeWidth={1.75} />
        )}
        <span>{state === "sending" ? "Queueing…" : "Submit to queue"}</span>
      </button>
      {message && (
        <p className={`vault-form-note ${state === "sent" ? "ok" : "err"}`}>{message}</p>
      )}
    </form>
  );
}
