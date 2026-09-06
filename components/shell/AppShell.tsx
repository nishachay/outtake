/** Vault app shell: left rail + discovery stage + deck + capsule + modal.
 *  Lives in the root layout so playback persists across route changes. */
"use client";

import { useEffect } from "react";
import { PlayerProvider } from "./player-context";
import LeftRail from "./LeftRail";
import PlayerSidebar from "./PlayerSidebar";
import FloatingCapsule from "./FloatingCapsule";
import AboutModal from "./AboutModal";

export default function AppShell({ children }: { children: React.ReactNode }) {
  // The vault canvas owns the viewport (the original locked body scroll).
  useEffect(() => {
    document.body.classList.add("vault-locked");
    return () => document.body.classList.remove("vault-locked");
  }, []);

  return (
    <PlayerProvider>
      <div id="app">
        <LeftRail />
        <main className="main-stage">
          <section className="discovery-stage">{children}</section>
        </main>
        <PlayerSidebar />
      </div>
      <FloatingCapsule />
      <AboutModal />
      <div id="yt-mount">
        <div id="yt-player" />
      </div>
    </PlayerProvider>
  );
}
