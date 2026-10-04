import type { MetadataRoute } from "next";

import { getActiveSongs, getArtists } from "@/lib/queries";

const SITE_URL = process.env.SITE_URL || "https://outtake.vercel.app";

export const revalidate = 3600;

/**
 * One sitemap, not one per artist.
 *
 * At 3,000 songs and 88 artists this is ~3,090 URLs, comfortably inside the
 * sitemap protocol's 50,000 URL / 50 MB per-file ceiling. Splitting by artist
 * would only become necessary well past the current scale target.
 *
 * Song URLs are listed even though song pages are not prerendered
 * (`generateStaticParams` returns []) — the crawler triggers the on-demand ISR
 * render, which is the whole reason that pattern exists.
 *
 * lastmod comes from surfaced_at, so a page that has not changed does not claim
 * to have. Vercel charges no ISR write unit when regenerated output is identical,
 * so an unstable lastmod here would cost real money.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let songs: Awaited<ReturnType<typeof getActiveSongs>> = [];
  let artistRows: Awaited<ReturnType<typeof getArtists>> = [];

  try {
    [songs, artistRows] = await Promise.all([getActiveSongs(), getArtists()]);
  } catch {
    // No database at build time. An empty sitemap is better than a build failure,
    // and the real one is generated on the next successful build.
  }

  return [
    {
      url: SITE_URL,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/submit`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...artistRows
      .filter((a) => a.activeCount > 0)
      .map((a) => ({
        url: `${SITE_URL}/artist/${a.slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ...songs.map((s) => ({
      url: `${SITE_URL}/song/${s.songId}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
