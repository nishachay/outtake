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

/** off → wraps nothing and stops at the end; all → wraps; one → repeats the track. */
type RepeatMode = "off" | "all" | "one";

const identityOrder = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/**
 * Deterministic Fisher–Yates over queue indices.
 *
 * Shuffle used to be `Math.floor(Math.random() * q.length)` evaluated on every
 * skip, which could replay the track you were on, jump backwards, and gave no
 * sense of order at all. Real shuffle is an *order* that you walk.
 *
 * Seeded from the queue signature so the same list always shuffles the same way:
 * two reasons. SSR and hydration must agree, and `Math.random()` reaching
 * rendered output costs ISR write units on Vercel (see AGENTS.md).
 */
function shuffledOrder(n: number, seed: string): number[] {
  const out = identityOrder(n);
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  state = state >>> 0 || 1;
  const next = () => {
    // xorshift32 — seeded, no Math.random, no allocation.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

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
  repeat: RepeatMode;
  /** Next tracks in playback order — the queue is otherwise invisible. */
  upNext: DeckSong[];
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
  /** Turn shuffle on and play a list from the head of a fresh order. */
  shuffleQueue: (queue: DeckSong[], queueKey: string) => void;
  /** off → all → one → off */
  cycleRepeat: () => void;
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
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  // Playback order: a permutation of queue indices, walked by a cursor. Rebuilt
  // only when the queue identity changes or shuffle is toggled.
  const [order, setOrderState] = useState<number[]>([]);
  const [orderPos, setOrderPos] = useState(0);
  const orderRef = useRef<number[]>([]);
  const orderSigRef = useRef("");
  // Persisted state starts at the SSR-safe default and hydrates from
  // localStorage after mount — so the first client render matches the
  // server HTML exactly (no hydration mismatch from resume/likes).
  const [likedIds, setLikedIds] = useState<string[]>([]);
  // Ref, not state: only ever read synchronously inside event handlers, and
  // exposing it through context re-rendered every consumer for no reason.
  const versionPrefsRef = useRef<Record<string, string>>({});
  const [lastSong, setLastSong] = useState<DeckSong | null>(null);

  useEffect(() => {
    setLikedIds(readJson<string[]>(LIKES_KEY, []));
    versionPrefsRef.current = readJson<Record<string, string>>(VERSION_KEY, {});
    setLastSong(readJson<DeckSong | null>(LAST_KEY, null));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytRef = useRef<any>(null);
  const [ytReady, setYtReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrubbingRef = useRef(false);

  // Ref mirror for use inside YT event callbacks (avoids stale closures).
  // Synced in an effect rather than during render — writing refs during render is
  // unsupported under concurrent rendering.
  const live = useRef({ queue, index, srcKey, shuffle, repeat, queueKey, order, orderPos });
  useEffect(() => {
    live.current = { queue, index, srcKey, shuffle, repeat, queueKey, order, orderPos };
  }, [queue, index, srcKey, shuffle, repeat, queueKey, order, orderPos]);

  /** Replace the playback order and cursor together. */
  const commitOrder = useCallback((next: number[], pos: number) => {
    orderRef.current = next;
    setOrderState(next);
    setOrderPos(Math.max(0, Math.min(pos, Math.max(0, next.length - 1))));
  }, []);

  const signatureOf = (q: DeckSong[], key: string): string =>
    `${key}|${q.length}|${q[0]?.songId ?? ""}|${q[q.length - 1]?.songId ?? ""}`;

  const song: DeckSong | null = index >= 0 && index < queue.length ? queue[index] : null;
  const source: VersionSource | null =
    song?.sources.find((s) => s.key === srcKey) ?? song?.sources[0] ?? null;

  /** Remember which take of a song the listener last chose. */
  const rememberVersion = useCallback((songId: string, key: string) => {
    const prev = versionPrefsRef.current;
    if (prev[songId] === key) return;
    versionPrefsRef.current = { ...prev, [songId]: key };
    try {
      localStorage.setItem(VERSION_KEY, JSON.stringify(versionPrefsRef.current));
    } catch {
      /* private mode / quota */
    }
  }, []);

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
              const saved = versionPrefsRef.current[s.songId];
              if (saved && s.sources.some((x) => x.key === saved)) return saved;
              return s.sources[0]?.key ?? "canonical";
            })();

      // Reconcile playback order. Same queue identity → reuse the existing
      // permutation (so shuffling survives a track change). New queue → rebuild.
      const sig = signatureOf(nextQueue, nextKey);
      if (sig !== orderSigRef.current || orderRef.current.length !== nextQueue.length) {
        orderSigRef.current = sig;
        const rebuilt = live.current.shuffle
          ? shuffledOrder(nextQueue.length, sig)
          : identityOrder(nextQueue.length);
        commitOrder(rebuilt, rebuilt.indexOf(nextIndex));
      } else {
        const pos = orderRef.current.indexOf(nextIndex);
        if (pos >= 0) setOrderPos(pos);
      }

      setQueue(nextQueue);
      setQueueKey(nextKey);
      setIndex(nextIndex);
      setSrcKey(key);
      rememberVersion(s.songId, key);
      setCur(0);
      setTot(s.durationSec ?? 0);
      setPlaying(true);
      setSidebarOpen(true);
      const src = s.sources.find((x) => x.key === key) ?? s.sources[0];
      playSource(src?.vid ?? s.youtubeId);
    },
    [playSource, commitOrder, rememberVersion],
  );

  // Same for likes.
  useEffect(() => {
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify(likedIds));
    } catch {
      /* private mode / quota */
    }
  }, [likedIds]);

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

  const stopPlayback = useCallback(() => {
    const p = ytRef.current;
    if (p) {
      try {
        p.pauseVideo();
      } catch {
        /* ignore */
      }
    }
    setPlaying(false);
  }, []);

  /** Replay the current track from the top — repeat-one. */
  const restartCurrent = useCallback(() => {
    const { queue: q, index: i, srcKey: sk } = live.current;
    const s = q[i];
    if (!s) return;
    setCur(0);
    setPlaying(true);
    const src = s.sources.find((x) => x.key === sk) ?? s.sources[0];
    const p = ytRef.current;
    if (src && p) {
      try {
        p.seekTo(0, true);
        p.playVideo();
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** Play whichever track sits at a position in the current order. */
  const playOrderPos = useCallback(
    (pos: number) => {
      const { queue: q, order: ord, queueKey: qk } = live.current;
      if (!q.length || !ord.length) return;
      const idx = ord[Math.max(0, Math.min(pos, ord.length - 1))];
      if (idx === undefined) return;
      playQueue(q, idx, qk);
    },
    [playQueue],
  );

  /**
   * The single auto-advance path. `next`/`prev` and the player's ENDED event all
   * go through this, so there is no duplicated logic to drift.
   *
   * Boundary behaviour follows the familiar convention: with repeat off the queue
   * stops at the end instead of silently wrapping, with repeat all it wraps, and
   * repeat one only affects the ENDED event — pressing next still skips ahead.
   */
  const advance = useCallback(
    (delta: number) => {
      const { order: ord, orderPos: op, repeat: rm } = live.current;
      if (!ord.length) return;
      const target = op + delta;
      if (target < 0) {
        if (rm === "off") return;
        playOrderPos(ord.length - 1);
        return;
      }
      if (target >= ord.length) {
        if (rm === "off") {
          stopPlayback();
          return;
        }
        playOrderPos(0);
        return;
      }
      playOrderPos(target);
    },
    [playOrderPos, stopPlayback],
  );

  const next = useCallback(() => advance(1), [advance]);
  const prev = useCallback(() => advance(-1), [advance]);

  /**
   * Transport callbacks reached through a ref, so the long-lived YT subscription
   * and the keydown listener stay mounted exactly once without capturing stale
   * closures. Declared here because the YT effect below reads it on mount.
   * Synced in an effect — assigning refs during render is unsupported.
   */
  const transportRef = useRef({ toggle, advance, restartCurrent, stopPlayback });
  useEffect(() => {
    transportRef.current = { toggle, advance, restartCurrent, stopPlayback };
  }, [toggle, advance, restartCurrent, stopPlayback]);

  /** Next tracks in playback order, for the deck's "up next" panel. */
  const upNext = useMemo(() => {
    if (!order.length || !queue.length) return [];
    const out: DeckSong[] = [];
    for (let i = orderPos + 1; i < order.length && out.length < 5; i++) {
      const s = queue[order[i]];
      if (s) out.push(s);
    }
    return out;
  }, [order, orderPos, queue]);

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
      rememberVersion(s.songId, key);
      setPlaying(true);
      playSource(src.vid);
    },
    [song, playSource, rememberVersion],
  );

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const toggleRail = useCallback(() => setRailCollapsed((v) => !v), []);

  /**
   * Toggling shuffle keeps the current track playing and reshuffles only what
   * comes after it — flipping the mode mid-track should not interrupt you.
   */
  const toggleShuffle = useCallback(() => {
    const { queue: q, order: ord, orderPos: op, queueKey: qk, shuffle: was } = live.current;
    const willShuffle = !was;
    setShuffle(willShuffle);
    if (!q.length) return;
    const sig = orderSigRef.current || signatureOf(q, qk);
    orderSigRef.current = sig;
    const current = ord[op];
    if (willShuffle) {
      const rest = shuffledOrder(q.length, sig).filter((i) => i !== current);
      commitOrder(current === undefined ? rest : [current, ...rest], 0);
      return;
    }
    const natural = identityOrder(q.length);
    commitOrder(natural, current === undefined ? 0 : natural.indexOf(current));
  }, [commitOrder]);

  const cycleRepeat = useCallback(() => {
    setRepeat((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  /**
   * "Shuffle all" — enable shuffle and start at the head of a fresh order.
   * The order is committed before playQueue runs, so playQueue takes the
   * reuse-order branch and does not rebuild it unshuffled.
   */
  const shuffleQueue = useCallback(
    (nextQueue: DeckSong[], nextKey: string) => {
      if (!nextQueue.length) return;
      setShuffle(true);
      const sig = signatureOf(nextQueue, nextKey);
      orderSigRef.current = sig;
      const fresh = shuffledOrder(nextQueue.length, sig);
      commitOrder(fresh, 0);
      playQueue(nextQueue, fresh[0], nextKey);
    },
    [commitOrder, playQueue],
  );

  const likedSet = useMemo(() => new Set(likedIds), [likedIds]);
  const isLiked = useCallback((id: string) => likedSet.has(id), [likedSet]);
  const toggleLike = useCallback((id: string) => {
    setLikedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
        const { repeat: rm, order: ord, orderPos: op } = live.current;
        if (!ord.length) return;
        if (rm === "one") {
          transportRef.current.restartCurrent();
          return;
        }
        // Hand off to the same advance() the next button uses, so the two cannot
        // drift apart again.
        transportRef.current.advance(1);
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
        transportRef.current.toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        transportRef.current.advance(1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        transportRef.current.advance(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
    upNext,
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
    shuffleQueue,
    cycleRepeat,
    isLiked,
    toggleLike,
    setScrubbing,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
