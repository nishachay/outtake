import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getArtistBySlug, getCatalog, getSongsForArtist } from "@/lib/dataloader";
import { toDeckSongs } from "@/lib/vault";
import ArtistAvatar from "@/components/vault/ArtistAvatar";
import ArtistClient from "@/components/vault/ArtistClient";

export const revalidate = 3600;

export function generateStaticParams() {
  return getCatalog().artists.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const artist = getArtistBySlug(slug);
  if (!artist) return { title: "Artist not found" };
  const count = getSongsForArtist(slug).filter((t) => !t.id.includes("__v")).length;
  return {
    title: artist.name,
    description: `${count} verified unreleased tracks by ${artist.name} — every one machine-verified as playable.`,
  };
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = getArtistBySlug(slug);
  if (!artist) notFound();

  const tracks = getSongsForArtist(slug);
  const canonicals = tracks.filter((t) => !t.id.includes("__v") && t.status === "active");
  if (canonicals.length === 0) notFound();
  const songs = toDeckSongs(canonicals, tracks);

  return (
    <>
      <div>
        <Link href="/" className="back-to-home-btn">
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span>Back to All Artists</span>
        </Link>

        <div className="artist-hero-banner">
          <div className="artist-hero-avatar">
            <ArtistAvatar
              src={artist.avatarUrl}
              name={artist.name}
              initials={artist.initials}
              variant="hero"
            />
          </div>
          <div className="artist-hero-meta">
            <h1 className="artist-hero-name pixel-text">{artist.name}</h1>
            <div className="artist-hero-sub">
              {artist.tag ?? "Unreleased Vault & Studio Outtakes"}
            </div>
            <div className="artist-hero-badge">{songs.length} Unreleased Grails</div>
          </div>
        </div>

        <ArtistClient songs={songs} slug={slug} />
      </div>
    </>
  );
}
