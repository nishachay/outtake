/** Vault cover art — the artist's own portrait under a dark archival
 *  treatment: seeded focal crop + zoom, shade gradient, film-grain frame,
 *  one restrained accent bar. Real photography, no text, no invented art. */
import { coverTreatment } from "@/lib/vault";
import { portraitFor } from "@/lib/portraits";

interface VaultCoverProps {
  id: string;
  title: string;
  artistSlug: string;
  artistName: string;
}

export default function VaultCover({ id, title, artistSlug, artistName }: VaultCoverProps) {
  const t = coverTreatment({ id, title });
  const src = portraitFor(artistSlug);

  return (
    <div className="v-cover" role="img" aria-label={`${title} by ${artistName} cover art`}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ objectPosition: t.position, transform: `scale(${t.scale})` }}
        />
      ) : null}
      <span
        className="vc-shade"
        style={{
          background: `linear-gradient(180deg, rgba(5,6,8,${t.shade - 0.18}) 0%, rgba(5,6,8,${t.shade + 0.18}) 100%)`,
        }}
      />
      <span className="vc-bar" style={{ background: t.accent }} />
    </div>
  );
}
