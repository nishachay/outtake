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

/** Generative cover duotones: deep base, lifted top, jewel accent. */
export interface CoverDuo {
  bg: string;
  hi: string;
  accent: string;
}

export const COVER_DUOTONES: CoverDuo[] = [
  { bg: "#0f1216", hi: "#1b2430", accent: "#5b8fd4" }, // steel blue
  { bg: "#0f1513", hi: "#182b26", accent: "#3fae8f" }, // petrol green
  { bg: "#111410", hi: "#1e2b1c", accent: "#6fa055" }, // moss
  { bg: "#141016", hi: "#261c33", accent: "#9a6fd0" }, // amethyst
  { bg: "#150f13", hi: "#2b1a24", accent: "#d4698a" }, // rose
  { bg: "#131110", hi: "#292019", accent: "#c08a4d" }, // bronze
  { bg: "#0e141b", hi: "#17293d", accent: "#4d9bd4" }, // night navy
  { bg: "#0e1515", hi: "#16302f", accent: "#3fb3ae" }, // deep teal
  { bg: "#140f15", hi: "#2a1c30", accent: "#b06fc0" }, // plum
  { bg: "#141009", hi: "#2c2113", accent: "#d08a3e" }, // ember
  { bg: "#101014", hi: "#22222e", accent: "#8a8fa8" }, // moon gray
  { bg: "#120e0e", hi: "#2a1a1a", accent: "#d05a5a" }, // oxblood red
];

/** Per-song accent color — feeds the dyed vinyl label + cover accent bar. */
export function vaultAccent(song: { id?: string; youtubeId?: string; title?: string }): string {
  return COVER_DUOTONES[vaultHash(song) % COVER_DUOTONES.length].accent;
}

/** Deterministic photographic treatment per song: focal crop, zoom, shade.
 *  Same portrait, different framing — like contact-sheet variations. */
export interface CoverTreatment {
  accent: string;
  position: string;
  scale: number;
  shade: number;
}

const FOCAL_POINTS = ["50% 22%", "50% 35%", "50% 48%", "36% 30%", "64% 30%"];

export function coverTreatment(song: { id?: string; youtubeId?: string; title?: string }): CoverTreatment {
  const h = vaultHash(song);
  return {
    accent: vaultAccent(song),
    position: FOCAL_POINTS[h % FOCAL_POINTS.length],
    scale: 1.06 + ((h >>> 4) % 5) * 0.05,
    shade: 0.42 + ((h >>> 9) % 3) * 0.09,
  };
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
