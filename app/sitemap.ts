import type { MetadataRoute } from "next";

import { getCanonicalVariants, getCatalog } from "@/lib/dataloader";

const SITE = process.env.SITE_URL || "https://outtake.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const catalog = getCatalog();
  const canonicals = getCanonicalVariants().filter((t) => t.status === "active");
  return [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/submit`, changeFrequency: "monthly", priority: 0.5 },
    ...catalog.artists.map((a) => ({
      url: `${SITE}/artist/${a.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...canonicals.map((t) => ({
      url: `${SITE}/song/${t.songId}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
