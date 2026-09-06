/** Artist avatar with initials fallback (broken images degrade gracefully). */
"use client";

import { useState } from "react";

interface ArtistAvatarProps {
  src: string | null;
  name: string;
  initials: string;
  variant: "card" | "hero";
}

export default function ArtistAvatar({ src, name, initials, variant }: ArtistAvatarProps) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    if (variant === "hero") return <>{initials}</>;
    return <span className="av-avatar-fb">{initials}</span>;
  }
  return (
    <img
      className="av-img"
      src={src as string}
      alt={name}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
