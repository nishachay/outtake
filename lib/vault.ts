/** Vault domain helpers — the original vault UI's cover system, deck-song
 *  model, and formatting. Deterministic covers, never scraped thumbnails. */
import type { Variant } from "./dataloader";

/** One playable source for a song: canonical original + alternate versions. */
export interface VersionSource {
  key: string;
  num: string;
  name: string;
  vid: string;
}

/** A canonical song with its ordered playable sources for the deck. */
export interface DeckSong {
  id: string;
  songId: string;
  title: string;
  artistName: string;
  artistSlug: string;
  youtubeId: string;
  durationSec: number | null;
  sources: VersionSource[];
}

/** Original vault palettes: [ink, deep, accent]. */
export const VAULT_PALETTES: Array<[string, string, string]> = [
  ["#16181f", "#1e2a4a", "#2e5b8a"], // ink slate → steel blue
  ["#10181c", "#12323a", "#14606b"], // ink petrol
  ["#131b17", "#123226", "#176b46"], // ink emerald
  ["#19131f", "#2a1c40", "#4a2f7a"], // ink amethyst (muted)
  ["#1b1318", "#3a1d27", "#8a2f43"], // ink rose
  ["#171411", "#2e2417", "#8a6430"], // ink bronze
  ["#10151d", "#1a2636", "#294e75"], // ink night navy
  ["#0f1a1d", "#153a40", "#1f6a6b"], // ink deep teal
  ["#19131c", "#33203f", "#6a3060"], // ink plum
  ["#1a1410", "#3a2015", "#7a3a16"], // ink ember
];

function seedOf(song: { id?: string; youtubeId?: string; title?: string }): string {
  return song.id || song.youtubeId || song.title || "";
}

/** FNV-1a hash — deterministic per song, stable across renders/deploys. */
export function vaultHash(song: { id?: string; youtubeId?: string; title?: string }): number {
  const str = seedOf(song);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function vaultPalette(song: { id?: string; youtubeId?: string; title?: string }): [string, string, string] {
  return VAULT_PALETTES[vaultHash(song) % VAULT_PALETTES.length];
}

/** Per-song accent color for covers + the dyed vinyl label. */
export function vaultAccent(song: { id?: string; youtubeId?: string; title?: string }): string {
  return vaultPalette(song)[2];
}

export function vaultCoverVars(song: { id?: string; youtubeId?: string; title?: string }): React.CSSProperties {
  return { "--coverAccent": vaultAccent(song) } as React.CSSProperties;
}

export function vaultCatno(song: { id?: string; youtubeId?: string; title?: string }): string {
  return `OUT·${1000 + (vaultHash(song) % 9000)}`;
}

export function vaultSide(song: { id?: string; youtubeId?: string; title?: string }): string {
  return vaultHash(song) % 2 ? "A" : "B";
}

export function vaultInitial(title: string): string {
  const t = (title || "?").trim();
  return t.charAt(0).toUpperCase() || "?";
}

/** Strip a leading "<Artist> - " prefix from a title (artist-aware). */
export function cleanTitle(title: string, artist: string): string {
  const art = (artist || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(title || "")
    .replace(new RegExp(`^${art}\\s*[-—]\\s*`, "i"), "")
    .trim();
}

/** m:ss duration for player UI (0:00 fallback, like the original). */
export function fmtTime(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || !isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  return `${Math.floor(totalSeconds / 60)}:${String(Math.floor(totalSeconds % 60)).padStart(2, "0")}`;
}

/**
 * Group canonical variants with their active alternate versions into
 * deck-ready songs. Mirrors the original activeVersionList():
 * canonical "V1 Original" first, then V2+ alts (skipping dupes).
 */
export function toDeckSongs(canonicals: Variant[], all: Variant[]): DeckSong[] {
  return canonicals.map((c) => {
    const alts = all.filter(
      (v) =>
        v.songId === c.songId &&
        v.id !== c.id &&
        v.status === "active" &&
        v.youtubeId &&
        v.youtubeId !== c.youtubeId,
    );
    const sources: VersionSource[] = [
      { key: "canonical", num: "V1", name: "Original", vid: c.youtubeId },
      ...alts.map((v, i) => ({
        key: v.id,
        num: `V${i + 2}`,
        name: v.label || "Alt",
        vid: v.youtubeId,
      })),
    ];
    return {
      id: c.id,
      songId: c.songId,
      title: cleanTitle(c.title, c.artistName),
      artistName: c.artistName,
      artistSlug: c.artistSlug,
      youtubeId: c.youtubeId,
      durationSec: c.durationSec,
      sources,
    };
  });
}
