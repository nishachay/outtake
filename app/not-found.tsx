import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div>
      <h1 className="section-pixel-title pixel-text" style={{ fontSize: 24 }}>
        Lost in the archive?
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginTop: 8,
          maxWidth: 460,
          lineHeight: 1.6,
        }}
      >
        This pressing doesn&apos;t exist — it may have been pulled, never shipped, or the link
        is wrong. Everything else in the archive is verified playable.
      </p>
      <div style={{ marginTop: 16 }}>
        <Link href="/" className="back-to-home-btn" style={{ marginBottom: 0 }}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span>Back to the archive</span>
        </Link>
      </div>
    </div>
  );
}
