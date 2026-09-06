import { getCatalog } from "@/lib/dataloader";
import { toDeckSongs } from "@/lib/vault";
import HomeClient, { type HomeArtist } from "@/components/vault/HomeClient";

export const revalidate = 3600;

export default function Home() {
  const catalog = getCatalog();
  const canonicals = catalog.tracks.filter(
    (t) => !t.id.includes("__v") && t.status === "active",
  );
  const songs = toDeckSongs(canonicals, catalog.tracks);
  const artists: HomeArtist[] = catalog.artists.map((a) => ({
    slug: a.slug,
    name: a.name,
    initials: a.initials,
    tag: a.tag,
    avatarUrl: a.avatarUrl,
    count: canonicals.filter((c) => c.artistSlug === a.slug).length,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "{ OUTTAKE } — Unreleased Music Vault",
    description:
      "A verified archive of unreleased music. Only currently-playable originals — every track machine-verified.",
    numberOfItems: songs.length,
  };

  return (
    <>
      <HomeClient songs={songs} artists={artists} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
