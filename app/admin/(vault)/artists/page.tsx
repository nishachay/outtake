import ArtistsForm from "@/components/admin/ArtistsForm";
import { getArtists } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ArtistsPage() {
  // 88 rows with SQL-aggregated counts — cheap, and no longer a full catalog
  // rebuild just to render an admin roster.
  const artists = await getArtists();
  return <ArtistsForm artists={artists} />;
}
