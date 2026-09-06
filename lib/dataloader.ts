import catalog from "../scripts/catalog.json";
import { initials as initialsOf, slugify } from "./utils";

/** Bundled, verified catalog. Ships with the app so the public site works with no DB. */
interface RawCatalog {
  artists: Array<{
    slug?: string;
    name: string;
    initials?: string;
    tag?: string;
    avatarUrl?: string | null;
    bio?: string | null;
  }>;
  songs: Array<{
    id: string;
    title: string;
    artist: string;
    youtubeId: string;
    duration?: number | null;
    notes?: string | null;
    status?: "active" | "dead" | "private";
    versions?: Array<{
      label?: string;
      youtubeId: string;
      notes?: string | null;
    }>;
  }>;
}

const raw = catalog as RawCatalog;

export interface Variant {
  id: string; // canonical song id, or `${songId}__v${n}` for a version
  songId: string;
  title: string;
  youtubeId: string;
  artistName: string;
  artistSlug: string;
  durationSec: number | null;
  label: string | null; // e.g. "Demo Take 3"
  status: "active" | "dead" | "private";
  reportCount: number;
}

export interface ArtistView {
  slug: string;
  name: string;
  initials: string;
  tag: string | null;
  avatarUrl: string | null;
  trackCount: number;
  activeCount: number;
}

interface ArtistMap {
  [slug: string]: { name: string; avatarUrl: string | null; tag: string | null };
}

function artistSlugFor(name: string): string {
  const match = raw.artists.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return match?.slug ?? slugify(name);
}

function buildArtistMap(): ArtistMap {
  const map: ArtistMap = {};
  for (const a of raw.artists) {
    map[a.slug ?? slugify(a.name)] = {
      name: a.name,
      avatarUrl: a.avatarUrl ?? null,
      tag: a.tag ?? null,
    };
  }
  return map;
}

function buildVariants(): Variant[] {
  const out: Variant[] = [];
  for (const s of raw.songs) {
    const artistSlug = artistSlugFor(s.artist);
    const base: Variant = {
      id: s.id,
      songId: s.id,
      title: s.title,
      youtubeId: s.youtubeId,
      artistName: s.artist,
      artistSlug,
      durationSec: s.duration ?? null,
      label: null,
      status: s.status ?? "active",
      reportCount: 0,
    };
    out.push(base);
    if (s.versions?.length) {
      s.versions.forEach((v, i) => {
        out.push({
          ...base,
          id: `${s.id}__v${i + 1}`,
          title: v.label || s.title,
          youtubeId: v.youtubeId,
          label: v.label ?? `Version ${i + 1}`,
        });
      });
    }
  }
  return out;
}

function buildArtists(variants: Variant[]): ArtistView[] {
  const map = buildArtistMap();
  const slugs = new Set<string>(raw.artists.map((a) => a.slug ?? slugify(a.name)));
  variants.forEach((v) => slugs.add(v.artistSlug));

  return [...slugs].map((slug) => {
    const meta = map[slug];
    const tracks = variants.filter((v) => v.artistSlug === slug);
    return {
      slug,
      name: meta?.name ?? slug,
      initials: initialsOf(meta?.name ?? slug),
      tag: meta?.tag ?? null,
      avatarUrl: meta?.avatarUrl ?? null,
      trackCount: tracks.length,
      activeCount: tracks.filter((v) => v.status === "active").length,
    };
  });
}

export interface CatalogResult {
  artists: ArtistView[];
  tracks: Variant[];
}

export function getCatalog(): CatalogResult {
  const variants = buildVariants();
  return { artists: buildArtists(variants), tracks: variants };
}

export function getArtistBySlug(slug: string): ArtistView | null {
  return getCatalog().artists.find((a) => a.slug === slug) ?? null;
}

export function getSongsForArtist(slug: string): Variant[] {
  return getCatalog().tracks.filter((v) => v.artistSlug === slug);
}

export function getSongById(id: string): Variant | null {
  return getCatalog().tracks.find((v) => v.id === id) ?? null;
}

/** All canonical variants (for artist pages / song lists / SEO sitemaps). */
export function getCanonicalVariants(): Variant[] {
  return getCatalog().tracks.filter((v) => !v.id.includes("__v"));
}