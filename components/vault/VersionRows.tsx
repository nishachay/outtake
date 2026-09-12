/** Alternate-takes list — structured version rows shared by the deck
 *  and the song detail. One row per take: index, name, state affordance. */
"use client";

import { Play } from "lucide-react";
import type { VersionSource } from "@/lib/vault";

interface VersionRowsProps {
  sources: VersionSource[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  /** Animate the active row's EQ bars (i.e. audio is actually playing). */
  live?: boolean;
  label?: string;
}

export default function VersionRows({
  sources,
  activeKey,
  onSelect,
  live = false,
  label = "Alternate takes",
}: VersionRowsProps) {
  if (sources.length < 2) return null;
  return (
    <div className="ver-list">
      <div className="ver-list-head">
        <span>{label}</span>
        <span className="ver-count">{sources.length}</span>
      </div>
      <div className="ver-rows" role="group" aria-label={label}>
        {sources.map((src) => {
          const active = src.key === activeKey;
          return (
            <button
              key={src.key}
              type="button"
              aria-pressed={active}
              className={`ver-row${active ? " active" : ""}`}
              title={`Play ${src.name}`}
              onClick={() => onSelect(src.key)}
            >
              <span className="ver-idx">{src.num}</span>
              <span className="ver-name">{src.name}</span>
              {active ? (
                <span className={`ver-eq${live ? "" : " paused"}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Play size={12} strokeWidth={2} className="ver-play" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
