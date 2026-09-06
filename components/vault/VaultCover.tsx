/** Owned vault-label cover art — deterministic per-song pressing,
 *  never a scraped thumbnail. Mini (thumbs/rows) and label (featured). */
import { fmtTime, vaultCatno, vaultCoverVars, vaultInitial, vaultSide } from "@/lib/vault";

interface VaultCoverProps {
  id: string;
  title: string;
  artist: string;
  durationSec: number | null;
  variant: "mini" | "label";
}

export default function VaultCover({ id, title, artist, durationSec, variant }: VaultCoverProps) {
  const seed = { id, title };
  if (variant === "label") {
    return (
      <div className="v-cover v-cover--label" style={vaultCoverVars(seed)} role="img" aria-label={`${title} cover art`}>
        <span className="vc-accentbar" />
        <div className="vc-head">
          <span className="vc-mark">Outtake Archive</span>
          <span className="vc-catno">{vaultCatno(seed)}</span>
        </div>
        <div className="vc-disc">
          <span className="vc-ring vc-r1" />
          <span className="vc-ring vc-r2" />
        </div>
        <div className="vc-mid">
          <div className="vc-title">{title}</div>
          <div className="vc-artist">{artist || "Unreleased"}</div>
        </div>
        <div className="vc-meta">
          <span>Side {vaultSide(seed)}</span>
          <span>33⅓ RPM</span>
          <span>{fmtTime(durationSec)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="v-cover v-cover--mini" style={vaultCoverVars(seed)} role="img" aria-label={`${title} cover art`}>
      <span className="vc-accentbar" />
      <span className="vc-ring" />
      <span className="vc-initial">{vaultInitial(title)}</span>
    </div>
  );
}
