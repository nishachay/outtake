/** Left command rail: brand, search, Home/Favorites, About, theme, curator. */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Home, Info, Moon, PanelLeftClose, Search, Sun } from "lucide-react";
import { usePlayer } from "./player-context";

const ICON_STROKE = 1.75;

export default function LeftRail() {
  const player = usePlayer();
  const pathname = usePathname();
  const collapsed = player.railCollapsed;
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
      else setTheme(document.documentElement.getAttribute("data-theme") || "dark");
    } catch {
      /* ignore */
    }
  }, []);

  // Auto-collapse the rail on narrow screens (the original had no breakpoints).
  const setRailCollapsed = player.setRailCollapsed;
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setRailCollapsed(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setRailCollapsed]);

  const applyTheme = (next: string) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  };

  const homeActive = pathname === "/" && !player.favoritesOnly;

  return (
    <aside className={`left-nav-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="nav-brand-header">
        <Link href="/" className="nav-brand-logo" data-tooltip="Expand Sidebar" onClick={() => player.setFavoritesOnly(false)}>
          <span className="logo-full">{"[ OUTTAKE ]"}</span>
          <span className="logo-compact">{"[ O ]"}</span>
        </Link>
        <button
          className="sidebar-collapse-btn"
          data-tooltip="Collapse Sidebar"
          title="Toggle Sidebar Collapse"
          onClick={player.toggleRail}
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={18} strokeWidth={ICON_STROKE} />
        </button>
      </div>

      <div
        className="nav-search-box"
        data-tooltip="Search Outtakes"
        onClick={() => {
          if (collapsed) player.setRailCollapsed(false);
        }}
      >
        <Search size={14} strokeWidth={ICON_STROKE} className="nav-search-icn" />
        {!collapsed && (
          <input
            type="text"
            className="nav-search-input"
            placeholder="Search outtakes..."
            autoComplete="off"
            value={player.searchQuery}
            onChange={(e) => player.setSearchQuery(e.target.value)}
            aria-label="Search outtakes"
          />
        )}
      </div>

      <div className="nav-divider" />

      <nav className="nav-menu-group">
        <Link
          href="/"
          className={`nav-item-btn${homeActive ? " active" : ""}`}
          data-tooltip="Home"
          onClick={() => player.setFavoritesOnly(false)}
        >
          <Home size={18} strokeWidth={ICON_STROKE} />
          <span>Home</span>
        </Link>
        <button
          className={`nav-item-btn${player.favoritesOnly ? " active" : ""}`}
          data-tooltip="Favorites"
          onClick={() => player.setFavoritesOnly(!player.favoritesOnly)}
        >
          <Heart size={18} strokeWidth={ICON_STROKE} />
          <span>Favorites</span>
        </button>
      </nav>

      <div className="nav-bottom-group">
        <div className="nav-divider" />
        <button className="nav-item-btn" data-tooltip="About Archive" onClick={() => player.setAboutOpen(true)}>
          <Info size={18} strokeWidth={ICON_STROKE} />
          <span>About Archive</span>
        </button>
        <button
          className="nav-item-btn"
          data-tooltip="Theme Toggle"
          onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "light" ? (
            <Moon size={18} strokeWidth={ICON_STROKE} />
          ) : (
            <Sun size={18} strokeWidth={ICON_STROKE} />
          )}
          <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
        </button>
      </div>
    </aside>
  );
}
