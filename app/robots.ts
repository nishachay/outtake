import type { MetadataRoute } from "next";

const SITE = process.env.SITE_URL || "https://outtake.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
