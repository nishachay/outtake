import { alternateTakes, deepArchive, outtakeOfTheDay } from "@/lib/feed";
import { getActiveSongs, getArtists } from "@/lib/queries";
import HomeClient, { type HomeArtist } from "@/components/vault/HomeClient";

export const revalidate = 3600;

/**
 * Home reads Postgres directly. The previous version built the entire catalog in
 * memory via getCatalog() on every call and serialized all of it into HomeClient's
 * props — 132 KB of HTML at 288 tracks, because the whole catalog is passed just so
 * the player has a queue.
 *
 * The queue now comes from /api/manifest on first play (a columnar payload, ~10 KB
 * gzip at 3,000 tracks), so this page ships only what it renders.
 */
export default async function Home() {
  const [songs, artistRows] = await Promise.all([getActiveSongs(), getArtists()]);

  const artists: HomeArtist[] = artistRows
    .filter((a) => a.activeCount > 0)
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      initials: a.initials,
      tag: a.tag,
      avatarUrl: a.avatarUrl,
      count: a.activeCount,
    }));

  const hero = outtakeOfTheDay(songs);
  const heroIndex = hero ? songs.findIndex((s) => s.songId === hero.songId) : 0;

  // Only what actually renders goes into the HTML. Rails are seeded and bounded,
  // so this stays a screenful rather than the catalog.
  const altTakes = alternateTakes(songs);
  const deepCuts = deepArchive(songs);
  const shown = new Set([hero?.songId, ...altTakes.map((s) => s.songId), ...deepCuts.map((s) => s.songId)]);
  const visible = songs.filter((s) => shown.has(s.songId));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "[ OUTTAKE ] — Unreleased Music Archive",
    description:
      "A verified archive of unreleased music. Only currently-playable originals — every track machine-verified.",
    numberOfItems: songs.length,
  };

  return (
    <>
      <HomeClient
        songs={visible}
        artists={artists}
        hero={hero}
        heroIndex={heroIndex}
        altTakes={altTakes}
        deepCuts={deepCuts}
        totalTracks={songs.length}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
