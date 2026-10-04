import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getArtistBySlug, getArtistSlugs, getSongsForArtist } from "@/lib/queries";
import ArtistClient from "@/components/vault/ArtistClient";
import ArtistAvatar from "@/components/vault/ArtistAvatar";

export const revalidate = 3600;

/**
 * Artist pages are the SEO surface: at 88 artists these are the pages that have
 * to rank for "[artist] unreleased / vault / outtakes". So they need real
 * per-artist context, not a generic list.
 */
export async function generateStaticParams() {
  try {
    return (await getArtistSlugs()).map((slug) => ({ slug }));
  } catch {
    // No database at build time. Pages still resolve on demand via dynamicParams.
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug).catch(() => null);
  if (!artist || artist.activeCount === 0) return { title: "Artist not found" };
  const tagline = artist.tag ? ` — ${artist.tag}` : "";
  return {
    title: `${artist.name}${tagline}`,
    description: `${artist.activeCount} verified unreleased outtakes by ${artist.name}. Every link machine-verified as playable from a public upload.`,
  };
}

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug).catch(() => null);
  if (!artist || artist.activeCount === 0) notFound();

  const tracks = await getSongsForArtist(slug);
  if (!tracks.length) notFound();

  const runtime = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0);
  const years = tracks
    .map((t) => /\b(19|20)\d{2}\b/.exec(t.title)?.[0])
    .filter((y): y is string => Boolean(y))
    .map(Number);
  const span = years.length
    ? `${Math.min(...years)}–${Math.max(...years)}`
    : null;
  const multiTake = tracks.filter((t) => t.sources.length > 1).length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artist.name,
    description: artist.bio ?? artist.tag ?? `Unreleased studio outtakes by ${artist.name}.`,
    ...(span ? { foundingDate: String(Math.min(...years)) } : {}),
  };

  return (
    <>
      <a href="/" className="back-to-home-btn">
        <ArrowLeft size={14} strokeWidth={1.75} />
        Back to All Artists
      </a>

      <div className="artist-hero-banner">
        <ArtistAvatar
          src={artist.avatarUrl}
          name={artist.name}
          initials={artist.initials}
          variant="hero"
        />
        <div className="artist-hero-meta">
          <h1 className="artist-hero-name pixel-text">{artist.name}</h1>
          <div className="artist-hero-sub">{artist.tag ?? "Unreleased Studio Outtakes"}</div>
          <div className="artist-hero-badge">
            {artist.activeCount} Unreleased Outtake{artist.activeCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Archive statistics. Makes the page read as a catalogue rather than a
          list, and gives the crawler real per-artist context. */}
      <dl className="artist-stats">
        <div>
          <dt>Tracks</dt>
          <dd>{tracks.length}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{Math.round(runtime / 60)} min</dd>
        </div>
        {span ? (
          <div>
            <dt>Titled</dt>
            <dd>{span}</dd>
          </div>
        ) : null}
        <div>
          <dt>Multi-take</dt>
          <dd>{multiTake}</dd>
        </div>
        <div>
          <dt>Last verified</dt>
          <dd>rolling</dd>
        </div>
      </dl>

      <ArtistClient songs={tracks} slug={slug} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
