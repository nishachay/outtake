/**
 * The catalog, in the browser.
 *
 * Public pages render a screenful of tracks server-side, but three features need
 * the whole catalog: the play queue, the ⌘K palette, and favorites. Passing it as
 * component props made the home page 132 KB of HTML — re-serialized on every
 * navigation and re-parsed every time.
 *
 * So it is fetched once from /api/manifest on first need, cached at module scope
 * for the rest of the session, and inflated back into DeckSong. At 3,168 rows the
 * manifest is 7.2 KB brotli / 10.3 KB gzip against 269.8 KB of raw JSON.
 *
 * The decoded result is memoised on the promise itself, so N concurrent callers
 * trigger exactly one request rather than a request storm on first render.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

import type { DeckSong, VersionSource } from "@/lib/vault";

interface Manifest {
  v: 1;
  rows: Array<[string, string, string, string, string, number | null, number]>;
  artistCounts: Record<string, number>;
}

/** Module-scope so the fetch happens once per session, not once per component. */
let inflight: Promise<DeckSong[]> | null = null;

function inflate(rows: Manifest["rows"]): DeckSong[] {
  return rows.map(([songId, title, artistSlug, artistName, youtubeId, durationSec, takeCount]) => {
    // The manifest carries only the canonical video id. Alternate takes are
    // resolved from the song page when one is opened, so a track with V2s does not
    // multiply the payload by its version count.
    const sources: VersionSource[] = [{ key: "canonical", num: "V1", name: "Original", vid: youtubeId }];
    for (let i = 2; i <= takeCount; i++) {
      sources.push({ key: `v${i - 1}`, num: `V${i}`, name: `Version ${i - 1}`, vid: youtubeId });
    }
    return { id: songId, songId, title, artistName, artistSlug, youtubeId, durationSec, sources };
  });
}

async function fetchCatalog(): Promise<DeckSong[]> {
  const res = await fetch("/api/manifest", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  // A shape change must not be silently mis-read: wrong row arity would produce
  // tracks with undefined fields and a queue that plays nothing.
  if (manifest.v !== 1 || !Array.isArray(manifest.rows)) {
    throw new Error("unsupported manifest version");
  }
  return inflate(manifest.rows);
}

function load(): Promise<DeckSong[]> {
  if (!inflight) {
    inflight = fetchCatalog().catch((err) => {
      // Allow a later attempt to retry rather than caching the failure forever.
      inflight = null;
      throw err;
    });
  }
  return inflight;
}

export interface CatalogState {
  /** null until loaded. Callers must handle the empty case. */
  songs: DeckSong[] | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch after a track ships, bypassing the session cache. */
  refresh: () => void;
}

export function useCatalog(active: boolean): CatalogState {
  const [songs, setSongs] = useState<DeckSong[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // Warm the cache only when something needs it — never on page load.
    if (inflight) {
      // Reuse the shared promise; still resolve it into state here.
      inflight.then(
        (list) => {
          if (!cancelled) setSongs(list);
        },
        () => {
          if (!cancelled) setError("catalog unavailable");
        },
      );
      return;
    }
    setLoading(true);
    setError(null);
    load()
      .then((list) => {
        if (!cancelled) setSongs(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "catalog unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, nonce]);

  const refresh = useCallback(() => {
    inflight = null;
    setNonce((n) => n + 1);
  }, []);

  return { songs, loading, error, refresh };
}

/** Preload without subscribing. Used on hover/focus so the first play is instant. */
export function prefetchCatalog(): void {
  void load().catch(() => {
    /* prefetch failures are not user-facing */
  });
}
