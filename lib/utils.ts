/** Shared helpers. No framework-specific imports here (usable by txs, scripts). */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function generateId(prefix?: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds <= 0) return "—";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Extract a YouTube video id from any common URL form or a bare id. */
export function extractYouTubeId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] !== "youtube.com/shorts/") return m[1];
  }

  const bare = text.match(/^([A-Za-z0-9_-]{11})$/);
  return bare ? bare[1] : null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeEmbedUrl(id: string, autoplay = 0): string {
  return `https://www.youtube.com/embed/${id}?autoplay=${autoplay}&playsinline=1&rel=0`;
}

/** Initials for avatar fallback, e.g. "Charlie Puth" -> "CP". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}