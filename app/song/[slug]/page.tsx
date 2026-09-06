import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCatalog, getSongsForArtist } from "@/lib/dataloader";
import { toDeckSongs } from "@/lib/vault";
import { fmtTime } from "@/lib/vault";
import { youtubeWatchUrl } from "@/lib/utils";
import VaultCover from "@/components/vault/VaultCover";
import SongClient from "@/components/vault/SongClient";

export const revalidate = 3600;

export function generateStaticParams() {
  return getCatalog()
    .tracks.filter((t) => !t.id.includes("__v"))
    .map((t) => ({ slug: t.songId }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const canonical = getCatalog().tracks.find((t) => t.songId === slug && !t.id.includes("__v"));
  if (!canonical) return { title: "Track not found" };
  return {
    title: `${canonical.title} — ${canonical.artistName}`,
    description: `Unreleased vault outtake by ${canonical.artistName} — machine-verified as playable.`,
    openGraph: {
      title: `${canonical.title} — ${canonical.artistName}`,
      description: `Unreleased vault outtake — machine-verified as playable.`,
      images: [`https://i.ytimg.com/vi/${canonical.youtubeId}/hqdefault.jpg`],
    },
  };
}

export default async function SongPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = getCatalog();
  const canonical = catalog.tracks.find((t) => t.songId === slug && !t.id.includes("__v"));
  if (!canonical || canonical.status !== "active") notFound();

  const artistTracks = getSongsForArtist(canonical.artistSlug);
  const artistCanonicals = artistTracks.filter((t) => !t.id.includes("__v") && t.status === "active");
  const artistSongs = toDeckSongs(artistCanonicals, artistTracks);
  const song = artistSongs.find((s) => s.songId === slug);
  if (!song) notFound();

  const queueKey = `artist:${canonical.artistSlug}`;
  const dur = song.durationSec ?? 0;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: song.title,
    byArtist: { "@type": "MusicGroup", name: song.artistName },
    url: youtubeWatchUrl(song.youtubeId),
    duration: `PT${Math.floor(dur / 60)}M${Math.floor(dur % 60)}S`,
  };

  return (
    <>
      <div>
        <Link href={`/artist/${song.artistSlug}`} className="back-to-home-btn">
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span>Back to {song.artistName}</span>
        </Link>

        <div className="detail-grid">
          <div className="detail-cover">
            <VaultCover
              id={song.songId}
              title={song.title}
              artist={song.artistName}
              durationSec={song.durationSec}
              variant="label"
            />
          </div>
          <div>
            <h1 className="detail-title pixel-text">{song.title}</h1>
            <p className="detail-sub">
              <Link href={`/artist/${song.artistSlug}`}>{song.artistName}</Link>
              {" · "}
              {fmtTime(song.durationSec)}
              {song.sources.length > 1 ? ` · ${song.sources.length} versions` : ""}
            </p>
            <SongClient song={song} artistSongs={artistSongs} queueKey={queueKey} />
            <p className="detail-note">
              Every vault cut is machine-verified as playable before it ships — and re-checked
              daily. If this link ever dies, flag it from the deck and the vault re-verifies it.
            </p>
            <p className="detail-source">
              Verified playable ·{" "}
              <a href={youtubeWatchUrl(song.youtubeId)} target="_blank" rel="noopener noreferrer">
                source on YouTube
              </a>
            </p>
          </div>
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
