import SongsForm from "@/components/admin/SongsForm";
import { getArtists } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SongsPage() {
  const artists = (await getArtists()).map((a) => ({ slug: a.slug, name: a.name }));
  return <SongsForm artists={artists} />;
}
