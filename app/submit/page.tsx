import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import SubmitForm from "@/components/vault/SubmitForm";

export const metadata: Metadata = {
  title: "Submit an outtake",
  description: "Found an unreleased outtake? Submit the link — every submission is probed before it ships.",
};

export default function SubmitPage() {
  return (
    <div>
      <Link href="/" className="back-to-home-btn">
        <ArrowLeft size={14} strokeWidth={1.75} />
          <span>Back to the archive</span>
      </Link>
      <h1 className="section-pixel-title pixel-text" style={{ fontSize: 24 }}>
        Found an outtake?
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, marginBottom: 16, maxWidth: 560 }}>
        Drop the YouTube link below. Every submission is probed — only currently-playable
        videos ship, the rest never surface.
      </p>
      <SubmitForm />
    </div>
  );
}
