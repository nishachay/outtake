/** About-archive modal — the vault's story + live verified counts. */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { usePlayer } from "./player-context";

export default function AboutModal() {
  const player = usePlayer();
  const [counts, setCounts] = useState("288 tracks · 12 artists");

  useEffect(() => {
    if (!player.aboutOpen) return;
    fetch("/api/health", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.tracks === "number" && typeof data.artists === "number") {
          setCounts(`${data.tracks} tracks · ${data.artists} artists`);
        }
      })
      .catch(() => {
        /* keep bundled fallback */
      });
  }, [player.aboutOpen]);

  if (!player.aboutOpen) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) player.setAboutOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="About the archive"
    >
      <div className="modal-card">
        <button className="modal-close" onClick={() => player.setAboutOpen(false)} aria-label="Close about dialog">
          <X size={18} strokeWidth={1.75} />
        </button>
        <h2 className="modal-title pixel-text">{"{ OUTTAKE }"}</h2>
        <p className="modal-sub">Unreleased Music Vault &amp; 3D Vinyl Turntable Player</p>
        <p className="modal-body">
          A private listening archive featuring rare studio outtakes, leaks, acoustic demos, and
          unreleased gems — every track machine-verified as playable before it ships.
        </p>
        <p className="modal-body">
          Verified archive · {counts}. We never host audio — we link to YouTube. Artist
          portraits via Wikimedia Commons contributors.
        </p>
        <div className="modal-link-row">
          <Link href="/submit" className="modal-pill-link" onClick={() => player.setAboutOpen(false)}>
            Found an outtake? Submit it
          </Link>
        </div>
      </div>
    </div>
  );
}
