/** Home feed algorithm — every rail is derived from real catalog data,
 *  never hardcoded array slices. All selectors are deterministic (seeded),
 *  so SSG output matches hydration exactly. */
import type { DeckSong } from "./vault";

/** FNV-1a string hash for seeded rotation. */
export function feedHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function weekKey(d: Date): string {
  const start = new Date(d.getFullYear(), 0, 1).getTime();
  return `${d.getFullYear()}-w${Math.floor((d.getTime() - start) / (7 * 864e5))}`;
}

/** Outtake of the day — stable for 24h, identical on server and client. */
export function outtakeOfTheDay(songs: DeckSong[], date = new Date()): DeckSong | null {
  if (!songs.length) return null;
  return songs[feedHash(`outtake-${dayKey(date)}`) % songs.length];
}

/** Songs that genuinely have alternate versions (V2+). */
export function alternateTakes(songs: DeckSong[], n = 6): DeckSong[] {
  return songs.filter((s) => s.sources.length > 1).slice(0, n);
}

/** Weekly rotation through the archive — strided so one artist can't hog it. */
export function deepArchive(songs: DeckSong[], n = 6, date = new Date()): DeckSong[] {
  if (!songs.length) return [];
  const start = feedHash(`deep-${weekKey(date)}`) % songs.length;
  const out: DeckSong[] = [];
  for (let k = 0; k < Math.min(n, songs.length); k++) {
    out.push(songs[(start + k * 7) % songs.length]);
  }
  return out;
}
