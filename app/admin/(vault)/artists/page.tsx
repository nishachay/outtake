import ArtistsForm from "@/components/admin/ArtistsForm";
import { getCatalog } from "@/lib/dataloader";

export const dynamic = "force-dynamic";

export default function ArtistsPage() {
  return <ArtistsForm artists={getCatalog().artists} />;
}