import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getSongById, getSongsForArtist } from "@/lib/queries";
import { fmtTime } from "@/lib/vault";
import SongClient from "@/components/vault/SongClient";
import VaultCover from "@/components/vault/VaultCover";

export const revalidate = 3600;
export const dynamicParams = true;

/**
 * Deliberately NOT in generateStaticParams.
 *
 * Prerendering 3,000 song pages made the build scale with the catalog (it was
 * already ~10 minutes at 288). Instead the first visit renders and ISR-caches,
 * and app/sitemap.ts lists every song URL so crawlers trigger the renders. Keep it
 * that way — adding these paths back is the single easiest way to make the build
 * unusable at scale.
 */
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const song = await getSongById(slug).catch(() => null);
  if (!song) return { title: "Track not found" };
  return {
    title: `${song.title} — ${song.artistName}`,
    description: `An unreleased outtake by ${song.artistName}, machine-verified as playable from a public upload. ${song.sources.length > 1 ? `Includes ${song.sources.length - 1} alternate take${song.sources.length === 2 ? "" : "s"}.` : ""} Not hosted here — we link out.`,
  };
}

export default async function SongPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const song = await getSongById(slug).catch(() => null);
  if (!song) notFound();

  const artistTracks = await getSongsForArtist(song.artistSlug);
  const position = artistTracks.findIndex((s) => s.songId === song.songId);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: song.title,
    byArtist: { "@type": "MusicGroup", name: song.artistName },
    durationSec: song.durationSec ?? undefined,
    url: `https://www.youtube.com/watch?v=${song.youtubeId}`,
    isFamilyFriendly: false,
  };

  return (
    <>
      <a href={`/artist/${song.artistSlug}`} className="back-to-home-btn">
        <ArrowLeft size={14} strokeWidth={1.75} />
        Back to {song.artistName}
      </a>

      <div className="detail-grid">
        <div className="detail-cover">
          <VaultCover
            id={song.songId}
            title={song.title}
            artistSlug={song.artistSlug}
            artistName={song.artistName}
          />
        </div>
        <div>
          <h1 className="detail-title pixel-text">{song.title}</h1>
          <div className="detail-sub">
            <a href={`/artist/${song.artistSlug}`}>{song.artistName}</a>
            {" · "}
            {fmtTime(song.durationSec)}
            {song.sources.length > 1 ? ` · ${song.sources.length} takes` : ""}
          </div>

          <SongClient
            song={song}
            artistSongs={artistTracks}
            queueKey={`artist:${song.artistSlug}`}
            position={position}
          />

          <p className="detail-note">
            This recording is not hosted here. The link points to a public YouTube upload and
            was machine-verified as playable within the last day. If it has stopped working,
            it will be re-checked on the next sweep.
          </p>

          <a
            className="detail-source"
            href={`https://www.youtube.com/watch?v=${song.youtubeId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the original upload on YouTube ↗
          </a>
        </div>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
