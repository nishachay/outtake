import SongsForm from "@/components/admin/SongsForm";
import { getCatalog } from "@/lib/dataloader";

export const dynamic = "force-dynamic";

export default function SongsPage() {
  const artists = getCatalog().artists.map((a) => ({ slug: a.slug, name: a.name }));
  return <SongsForm artists={artists} />;
}