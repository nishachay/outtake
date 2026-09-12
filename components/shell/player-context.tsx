/** Vault player engine — hidden YouTube iframe audio with the vault UX:
 *  queue, V1/V2 version picker memory, scrub bar, likes, repeat-one,
 *  keyboard shortcuts, auto-fallback. */
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DeckSong, VersionSource } from "@/lib/vault";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const LIKES_KEY = "m2d_likes_v1";
const VERSION_KEY = "m2d_version_pref_v1";
const LAST_KEY = "m2d_last_song_v1";

interface PlayerContextValue {
  queue: DeckSong[];
  queueKey: string;
  index: number;
  song: DeckSong | null;
  srcKey: string;
  source: VersionSource | null;
  playing: boolean;
  cur: number;
  tot: number;
  sidebarOpen: boolean;
  railCollapsed: boolean;
  aboutOpen: boolean;
  searchQuery: string;
  favoritesOnly: boolean;
  shuffle: boolean;
  repeat: boolean;
  likedCount: number;
  lastSong: DeckSong | null;
  resumeLast: () => void;
  loadList: (queue: DeckSong[], queueKey: string) => void;
  playQueue: (queue: DeckSong[], index: number, queueKey: string, forceSrcKey?: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (pct: number) => void;
  selectVersion: (key: string) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setRailCollapsed: (collapsed: boolean) => void;
  toggleRail: () => void;
  setAboutOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setFavoritesOnly: (only: boolean) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  isLiked: (id: string) => boolean;
  toggleLike: (id: string) => void;
  /** Pause progress polling while the scrub bar is dragged. */
  setScrubbing: (v: boolean) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<DeckSong[]>([]);
  const [queueKey, setQueueKey] = useState("");
  const [index, setIndex] = useState(-1);
  const [srcKey, setSrcKey] = useState("canonical");
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [tot, setTot] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  // Persisted state starts at the SSR-safe default and hydrates from
  // localStorage after mount — so the first client render matches the
  // server HTML exactly (no hydration mismatch from resume/likes).
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [versionPrefs, setVersionPrefs] = useState<Record<string, string>>({});
  const [lastSong, setLastSong] = useState<DeckSong | null>(null);

  useEffect(() => {
    setLikedIds(readJson<string[]>(LIKES_KEY, []));
    setVersionPrefs(readJson<Record<string, string>>(VERSION_KEY, {}));
    setLastSong(readJson<DeckSong | null>(LAST_KEY, null));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytRef = useRef<any>(null);
  const [ytReady, setYtReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrubbingRef = useRef(false);

  // Ref mirror for use inside YT event callbacks (avoids stale closures).
  const live = useRef({ queue: queue, index: index, srcKey: srcKey, shuffle: shuffle, repeat: repeat });
  live.current = { queue, index, srcKey, shuffle, repeat };

  const song: DeckSong | null = index >= 0 && index < queue.length ? queue[index] : null;
  const source: VersionSource | null =
    song?.sources.find((s) => s.key === srcKey) ?? song?.sources[0] ?? null;

  const preferredKey = useCallback(
    (s: DeckSong): string => {
      const saved = versionPrefs[s.songId];
      if (saved && s.sources.some((x) => x.key === saved)) return saved;
      return s.sources[0]?.key ?? "canonical";
    },
    [versionPrefs],
  );

  const playSource = useCallback((vid: string | null) => {
    const p = ytRef.current;
    if (!vid || !p) return;
    try {
      if (p.unMute) p.unMute();
      if (p.setVolume) p.setVolume(100);
      p.loadVideoById(vid);
      p.playVideo();
    } catch (e) {
      console.warn("Audio play error:", e);
    }
  }, []);

  const playQueue = useCallback(
    (nextQueue: DeckSong[], nextIndex: number, nextKey: string, forceSrcKey?: string) => {
      if (nextIndex < 0 || nextIndex >= nextQueue.length) return;
      const s = nextQueue[nextIndex];
      const key =
        forceSrcKey && s.sources.some((x) => x.key === forceSrcKey)
          ? forceSrcKey
          : (() => {
              const saved = readJson<Record<string, string>>(VERSION_KEY, {});
              if (saved[s.songId] && s.sources.some((x) => x.key === saved[s.songId])) {
                return saved[s.songId];
              }
              return s.sources[0]?.key ?? "canonical";
            })();
      setQueue(nextQueue);
      setQueueKey(nextKey);
      setIndex(nextIndex);
      setSrcKey(key);
      setVersionPrefs((prev) => {
        if (prev[s.songId] === key) return prev;
        const nextPrefs = { ...prev, [s.songId]: key };
        try {
          localStorage.setItem(VERSION_KEY, JSON.stringify(nextPrefs));
        } catch {
          /* ignore */
        }
        return nextPrefs;
      });
      setCur(0);
      setTot(s.durationSec ?? 0);
      setPlaying(true);
      setSidebarOpen(true);
      const src = s.sources.find((x) => x.key === key) ?? s.sources[0];
      playSource(src?.vid ?? s.youtubeId);
    },
    [playSource],
  );

  /** Register a stage list as the queue context (no autoplay).
   *  Carries the deck position when the current song is in the new list,
   *  so navigating mid-play never blanks the deck. */
  const loadList = useCallback((nextQueue: DeckSong[], nextKey: string) => {
    const { queue: q, index: i, srcKey: cur } = live.current;
    const curSong = i >= 0 && i < q.length ? q[i] : null;
    const carry = curSong ? nextQueue.findIndex((s) => s.songId === curSong.songId) : -1;
    setQueue(nextQueue);
    setQueueKey(nextKey);
    if (curSong && carry >= 0) {
      const s = nextQueue[carry];
      setIndex(carry);
      setSrcKey(s.sources.some((x) => x.key === cur) ? cur : (s.sources[0]?.key ?? "canonical"));
    } else {
      setIndex(-1);
      setSrcKey("canonical");
      setCur(0);
      setTot(0);
    }
  }, []);

  const toggle = useCallback(() => {
    const p = ytRef.current;
    if (song && p) {
      try {
        if (p.unMute) p.unMute();
        if (p.setVolume) p.setVolume(100);
        if (live.current && playing) p.pauseVideo();
        else p.playVideo();
      } catch (e) {
        console.warn("Audio toggle error:", e);
      }
      return;
    }
    if (!song && queue.length > 0) playQueue(queue, 0, queueKey || "home");
  }, [song, playing, queue, queueKey, playQueue]);

  const next = useCallback(() => {
    const { queue: q, index: i, shuffle: sh } = live.current;
    if (!q.length) return;
    if (sh) return playQueue(q, Math.floor(Math.random() * q.length), queueKey);
    playQueue(q, (i + 1) % q.length, queueKey);
  }, [playQueue, queueKey]);

  const prev = useCallback(() => {
    const { queue: q, index: i } = live.current;
    if (!q.length) return;
    playQueue(q, (i - 1 + q.length) % q.length, queueKey);
  }, [playQueue, queueKey]);

  const seek = useCallback(
    (pct: number) => {
      const p = ytRef.current;
      if (!p || !ytReady) return;
      try {
        const d = p.getDuration() || 0;
        if (d > 0) {
          p.seekTo(pct * d, true);
          setCur(pct * d);
        }
      } catch {
        /* ignore */
      }
    },
    [ytReady],
  );

  const selectVersion = useCallback(
    (key: string) => {
      const s = song;
      if (!s) return;
      const src = s.sources.find((x) => x.key === key);
      if (!src) return;
      setSrcKey(key);
      setVersionPrefs((prev) => {
        const nextPrefs = { ...prev, [s.songId]: key };
        try {
          localStorage.setItem(VERSION_KEY, JSON.stringify(nextPrefs));
        } catch {
          /* ignore */
        }
        return nextPrefs;
      });
      setPlaying(true);
      playSource(src.vid);
    },
    [song, playSource],
  );

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const toggleRail = useCallback(() => setRailCollapsed((v) => !v), []);
  const toggleShuffle = useCallback(() => setShuffle((v) => !v), []);
  const toggleRepeat = useCallback(() => setRepeat((v) => !v), []);

  const likedSet = useMemo(() => new Set(likedIds), [likedIds]);
  const isLiked = useCallback((id: string) => likedSet.has(id), [likedSet]);
  const toggleLike = useCallback((id: string) => {
    setLikedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(LIKES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ── YouTube IFrame API boot ──
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let player: any = null;

    const onStateChange = (ev: { data: number }) => {
      const S = window.YT?.PlayerState;
      if (!S) return;
      if (ev.data === S.PLAYING) {
        setPlaying(true);
      } else if (ev.data === S.PAUSED) {
        setPlaying(false);
      } else if (ev.data === S.ENDED) {
        setPlaying(false);
        const { queue: q, index: i, shuffle: sh, repeat: rp } = live.current;
        if (!q.length) return;
        if (rp) {
          // Honest repeat-one: replay the same track from the top.
          const s = q[i];
          if (!s) return;
          setCur(0);
          setPlaying(true);
          const src = s.sources.find((x) => x.key === live.current.srcKey) ?? s.sources[0];
          const p = ytRef.current;
          if (src && p) {
            try {
              p.seekTo(0, true);
              p.playVideo();
            } catch {
              /* ignore */
            }
          }
          return;
        }
        const ni = sh ? Math.floor(Math.random() * q.length) : (i + 1) % q.length;
        const s = q[ni];
        if (!s) return;
        const saved = readJson<Record<string, string>>(VERSION_KEY, {});
        const key =
          saved[s.songId] && s.sources.some((x) => x.key === saved[s.songId])
            ? saved[s.songId]
            : (s.sources[0]?.key ?? "canonical");
        setIndex(ni);
        setSrcKey(key);
        setCur(0);
        setTot(s.durationSec ?? 0);
        const src = s.sources.find((x) => x.key === key) ?? s.sources[0];
        const p = ytRef.current;
        if (src && p) {
          try {
            p.loadVideoById(src.vid);
            p.playVideo();
          } catch {
            /* ignore */
          }
        }
      }
    };

    const onError = () => {
      const { queue: q, index: i, srcKey: cur } = live.current;
      const s = q[i];
      if (!s) return;
      // Auto-fall through to the next alternate version, else next track.
      const pos = s.sources.findIndex((x) => x.key === cur);
      const nextSrc = pos >= 0 ? s.sources[pos + 1] : null;
      if (nextSrc) {
        setSrcKey(nextSrc.key);
        const p = ytRef.current;
        if (p) {
          try {
            p.loadVideoById(nextSrc.vid);
            p.playVideo();
          } catch {
            /* ignore */
          }
        }
      } else {
        window.setTimeout(() => {
          const l = live.current;
          if (!l.queue.length) return;
          const ni = (l.index + 1) % l.queue.length;
          const ns = l.queue[ni];
          if (!ns) return;
          setIndex(ni);
          setSrcKey(ns.sources[0]?.key ?? "canonical");
          setCur(0);
          setTot(ns.durationSec ?? 0);
          const p = ytRef.current;
          const first = ns.sources[0];
          if (first && p) {
            try {
              p.loadVideoById(first.vid);
              p.playVideo();
            } catch {
              /* ignore */
            }
          }
        }, 600);
      }
    };

    const create = () => {
      if (cancelled || ytRef.current) return;
      const el = document.getElementById("yt-player");
      if (!el || !window.YT?.Player) return;
      try {
        player = new window.YT.Player("yt-player", {
          height: "1",
          width: "1",
          playerVars: { playsinline: 1, controls: 0, rel: 0, disablekb: 1 },
          events: {
            onReady: (e: { target: { setVolume: (v: number) => void } }) => {
              if (cancelled) return;
              try {
                e.target.setVolume(85);
              } catch {
                /* ignore */
              }
              setYtReady(true);
            },
            onStateChange,
            onError,
          },
        });
        ytRef.current = player;
      } catch (e) {
        console.warn("YouTube player init failed:", e);
      }
    };

    if (window.YT?.Player) {
      create();
    } else {
      window.onYouTubeIframeAPIReady = create;
      if (!document.querySelector('script[data-vault-yt="1"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.async = true;
        tag.defer = true;
        tag.setAttribute("data-vault-yt", "1");
        document.body.appendChild(tag);
      }
    }
    return () => {
      cancelled = true;
      try {
        player?.destroy?.();
      } catch {
        /* ignore */
      }
      if (ytRef.current === player) ytRef.current = null;
    };
  }, []);

  // ── Progress polling (250ms, paused while scrubbing) ──
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(() => {
      const p = ytRef.current;
      if (!p?.getCurrentTime || scrubbingRef.current) return;
      try {
        const c = p.getCurrentTime() || 0;
        const d = p.getDuration() || 0;
        setCur(c);
        if (d > 0) setTot(d);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [playing]);

  const setScrubbing = useCallback((v: boolean) => {
    scrubbingRef.current = v;
  }, []);

  // ── Keyboard controls.
  // Typing always wins; Space/arrows on a focused control belong to that
  // control (prevents double-toggles and seek-vs-track-change fights).
  // Escape always collapses the deck.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Escape") {
        setSidebarOpen(false);
        return;
      }
      if (
        t &&
        (t.tagName === "BUTTON" ||
          t.tagName === "A" ||
          t.tagName === "SELECT" ||
          t.getAttribute("role") === "button" ||
          t.getAttribute("role") === "slider" ||
          t.getAttribute("role") === "link")
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        toggleRef.current();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        nextRef.current();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        prevRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const nextRef = useRef(next);
  nextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;

  // ── Remember the last played song for "Resume" on an empty deck ──
  const songId = song?.songId;
  useEffect(() => {
    if (!song) return;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(song));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  const resumeLast = useCallback(() => {
    const saved = readJson<DeckSong | null>(LAST_KEY, null);
    const target = saved ?? lastSongRef.current;
    if (target && target.sources?.length) playQueue([target], 0, "resume");
  }, [playQueue]);
  const lastSongRef = useRef(lastSong);
  lastSongRef.current = lastSong;

  // ── Tab title follows playback ──
  const songTitle = song?.title;
  useEffect(() => {
    if (songTitle) {
      document.title = `${playing ? "▶ " : ""}${songTitle} — Outtake`;
    } else {
      document.title = "[ OUTTAKE ] — Unreleased Music Archive";
    }
  }, [songTitle, playing]);

  const value: PlayerContextValue = {
    queue,
    queueKey,
    index,
    song,
    srcKey,
    source,
    playing,
    cur,
    tot,
    sidebarOpen,
    railCollapsed,
    aboutOpen,
    searchQuery,
    favoritesOnly,
    shuffle,
    repeat,
    likedCount: likedIds.length,
    lastSong,
    resumeLast,
    loadList,
    playQueue,
    toggle,
    next,
    prev,
    seek,
    selectVersion,
    setSidebarOpen,
    toggleSidebar,
    setRailCollapsed,
    toggleRail,
    setAboutOpen,
    setSearchQuery,
    setFavoritesOnly,
    toggleShuffle,
    toggleRepeat,
    isLiked,
    toggleLike,
    setScrubbing,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
