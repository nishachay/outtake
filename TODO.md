# OUTTAKE — Scale the Archive

> **Focus: make the site better. Scale the catalog to 3,000+ tracks. Publish it.**
> Revenue, email, accounts, and payments are deliberately **out of scope** until
> the catalog is deep and the site is fast. Nothing here is a growth feature.
>
> **North-star:** verified plays per week.
> **Rule:** nothing ships unverified. Promotions never enter a verified track list.

---

## The critical path

Getting 3,000 tracks in **and** usable is six things, in order:

1. Neon is the only source of truth (the bundle stops being the runtime source)
2. The probe verdict is fixed (today it ships blocked videos and deletes private ones)
3. A YouTube Data API key (scraping is prohibited — and slower)
4. A harvester that reads playlists into a staging table
5. A review queue that works on thousands
6. A player that doesn't feel random, and a search that finds things

Everything else is polish.

**Done so far on `feat/scale-foundation`:** the whole verdict mapping and dead-streak
confirmation (Phase 1), the refresh drain loop end to end (Phase 3.1–3.3, 3.5), the
collab scoping fix, submit validation + rate limiting, and the player engine
(6.1–6.5, 6.7) including the Up Next panel. Neon is live: project `mute-bread-01474345`,
Postgres 18.6, 288 songs / 12 artists imported, `/api/health` reports `mode: "db"`.

**Remaining blocker: `neon login` is a browser OAuth flow** — `neon link`,
`neon config init` and `neon deploy` cannot run without it. Run it from your own
terminal. Everything else can proceed without it.

⚠️ Two credentials were pasted into chat: the Neon owner password (in
`DATABASE_URL`) and a live `YOUTUBE_API_KEY`. Rotate both if this transcript is
ever shared.

---

## Blocker: two keys, from you

- [ ] **`DATABASE_URL`** — free Neon project → `.env`. Without it nothing is verifiable.
- [ ] **`YOUTUBE_API_KEY`** — console.cloud.google.com → enable YouTube Data API v3.
      Not optional anymore: playlist scraping is prohibited three ways over
      (consumer ToS §3, Dev Policies III.E.6, III.D.7) and the pagination endpoint
      `/youtubei/` is `Disallow`ed in robots.txt. The API costs **1 unit per 50
      videos** against a **10,000/day** default = **500,000 playlist items/day
      free.** Your 8 Kanye playlists are ~16 units.

---

## Phase 1 — Fix the trust layer

The single most important phase. The verdict mapping is **inverted**, which means
today's site both ships unplayable videos and destroys private ones.

Measured against real videos today:

| Real state | oEmbed | Current code | Correct |
|---|---|---|---|
| active, embeddable | `200` | `active` ✅ | `active` |
| exists, embedding disabled | `401` | `private` ❌ | `blocked` |
| **private** | **`404`** | **`dead`** ❌ | `unknown` |
| **region-blocked / claim-blocked** | **`200`** | **`active`** ❌ | `active` + flag |

- [x] **1.1** `lib/probe.ts` → `ProbeStatus = "active" | "blocked" | "dead" |
      "unknown" | "invalid"`.
      `200` = *exists + embeddable, NOT proven playable* · `401` = `blocked` ·
      `404` = `unknown` (YouTube won't distinguish private from deleted) ·
      `400` = `invalid` · network throw/timeout = `unknown`, **never `dead`**.
- [x] **1.2** Fix the `oembedTitle` stub — error paths return empty title/author.
- [x] **1.3** `lib/schema.ts`: `SONG_STATUSES` gains `blocked`/`unknown`; add
      `dead_streak`, `surfaced_at`, `source_count`, `play_count`,
      `source_provider`, `era`.
- [x] **1.4** **N=2 consecutive verified-dead probes** before a row becomes `dead`.
- [x] **1.5** `export-catalog` must **never drop a row at `unknown`**. Today a
      300ms Vercel timeout marks a track dead and the next export deletes it from
      the archive permanently. That is the bug most likely to lose you real
      catalog.
- [x] **1.6** Only fetch duration when a track is newly `active` or duration is
      null. The watch-page scrape is the 1–3s cost that makes refresh time out.
- [x] **1.7** Add `candidates` staging table (see Phase 4) so a bad harvest is a
      DELETE, not a git revert across 3,000 rows.

### Player-side verification (the part that scales)

`videos.list` **cannot** confirm embed playability. Google documents this
verbatim: *"Even if the uploader's settings allow embedding, videos may still be
blocked from playback in embedded players due to platform policies or third-party
claims (such as Content ID)."*

Only the player knows. The `onError` handler already exists for auto-fallback —
it should also report. Codes: `100` removed/private · `101`/`150` owner blocks
embedding · `5` HTML5/Content-ID claim block · `153` missing Referer.

- [ ] **1.8** `onError` → `POST /api/events` (fire-and-forget, never blocks
      playback) → update status + `dead_streak` in Neon.
      **Listeners become the second-stage verifier.** That's how 3,000 tracks stay
      honest without 3,000 probes/day.

---

## Phase 2 — Postgres is the only source of truth

The static bundle is **not** being kept for scale reasons — it's a Terms of
Service problem. YouTube Dev Policies III.E.4.d: API data must not be stored
**longer than 30 days** without refresh, and the 36-month derived-metrics
amendment explicitly excludes *"video titles, creator names"*. `catalog.json` is
ids + titles + names, committed to git, never deleted.

- [x] **2.1** `npm run db:push` — apply the Phase 1 schema.
- [x] **2.2** `db:import` → 288 tracks into Neon.
- [ ] **2.3** New `lib/queries.ts` replacing `lib/dataloader.ts` as the read path.
      **Every read targeted, every read `LIMIT`ed. Nothing loads the full
      catalog.** `getHomeFeed()`, `getArtistPage(slug, cursor)`,
      `getSong(id)`, `getArtists()`. `getCatalog()` is O(n) with no memoization
      and is called 2–3× per page — it must not exist.
      Indexes that make it work: `(artist_id, status, title)`,
      `(status, surfaced_at)`, `(status, last_checked_at)`.
- [~] **2.4** API reads the DB (`mode: db` confirmed); pages still use the bundle (`revalidate = 3600`) +
      `revalidateTag` on ingest. **One query per cache window per page**, CDN
      serves the rest.
- [ ] **2.5** `scripts/catalog.json` → **deleted from the runtime path.** A build
      step dumps DB → disk so `next build` can prerender, then discards it. Never
      committed, never hand-edited.
- [x] **2.6** Fix `upsertSongFromProbe`: the `id === probe.youtubeId` match is
      **not artist-scoped**, so a Drake collab video is appended as a *version of
      Charlie Puth's song* and the documented `-b` path never runs.
- [~] **2.7** Unify artist ids — `import-catalog` writes `id = slug`, the admin
      API writes `randomUUID()`. Two shapes in one table means imports and admin
      creates never reconcile.
- [x] **2.8** Add `artists.tag` + `artists.initials` columns. `catalog.json` has
      both and the schema doesn't, so **every DB-backed artist hero has been
      losing its tagline.**
- [~] **2.9** Validate every API body. `POST /api/submit` is unvalidated,
      unthrottled, and writes to the DB — add a rate limit + honeypot.
- [ ] **2.10** `robots.ts` → `Disallow: /admin`, `/api/`.

---

## Phase 3 — Refresh that finishes

Today: 120 **sequential** probes, no `orderBy`, against a 60–300s function
ceiling — so the same rows get picked every day, the rest starve, and the
freshness claim is already false at 288 tracks.

- [x] **3.1** `POST /api/admin/refresh?budget=400` — claim ≤400 rows via
      `FOR UPDATE SKIP LOCKED`, `orderBy(last_checked_at ASC NULLS FIRST)`,
      probe at concurrency 20, return `{ processed, remaining }` **immediately**.
- [x] **3.2** The GitHub Actions workflow **loops** `while remaining > 0`.
      3,000 ÷ 400 ≈ 8 iterations × ~30s ≈ 4 min runner time. Free tier is
      2,000 min/mo.
- [x] **3.3** Exit non-zero if `remaining > 0` after N iterations — a partial
      drain must show red, not silently skip tracks. Also delete the current
      `|| echo "no-op"` which makes total failure invisible.
- [ ] **3.4** Rolling ~7-day cohort instead of re-probing everything daily:
      3,000/7 ≈ 430/day. Player auto-fallback covers the gap.
- [x] **3.5** `concurrency: group: refresh`.
- [ ] **3.6** ⚠️ When the repo goes public, **GitHub auto-disables scheduled
      workflows after 60 days of inactivity.** Add a staleness alarm.

---

## Phase 4 — Harvest at scale

Throughput is quota-bound, not time-bound. The bottleneck was always the
hand-written pipeline.

- [ ] **4.1** `scripts/harvest-playlist.ts` — `playlistItems.list` (1 unit / 50
      videos), writes to `candidates` with provenance (`source`, `source_url`).
- [ ] **4.2** `scripts/harvest-trackers.ts` — parse `scripts/tracker-roster.md`
      (576 leads) for candidate ids.
- [ ] **4.3** Shared candidate store: `candidates` table. **Never dedupe on id** —
      keep `-b` collab copies. Auto-reject: dead, held, blocklist keywords,
      duration outside (30, 1200)s. **Flag, never auto-reject,** "confirm by ear".
- [ ] **4.4** Probe with 10–20× concurrency; duration only when active (1.6).
- [ ] **4.5** `--apply` promotes `candidates` → `songs` + `song_versions`, then
      fires `revalidateTag`. **A new track goes live without a human deploying.**
- [ ] **4.6** Per-run funnel yield logged per artist (automate what
      `scripts/sourcing-pilot.md` does by hand).

---

## Phase 5 — 88 artists / 3,000 tracks

- [ ] **5.1 Start with the 8 Kanye West playlists.** 400–800 candidates, the
      biggest single haul available.
- [ ] **5.2** Then by expected yield: Playboi Carti, A$AP Rocky, Frank Ocean,
      Ken Carson, Young Thug, Travis Scott, Eminem, Don Toliver, Trippie Redd,
      Kendrick Lamar, Destroy Lonely, Yeat, Future, Baby Keem.
- [ ] **5.3 Roster cleanup:** dedupe against the existing 12. Verify identity for
      `Dave Blunts` (Dave Blue?). `Prettifun` / `Unc and Phew` / `EsDeeKid` /
      `Aristotle Benoit` — confirm these are recording artists, not brands or
      promoters. Slugs: `tyler-the-creator`, `ty-dolla-sign`, `dr-dre`, `nwa`,
      `mf-doom`.
- [ ] **5.4** Slug uniqueness test rejecting near-duplicates (`drake` / `drake-2`).
- [ ] **5.5 Portraits for 76 new artists.** Expect ~0 Wikimedia hits passing the
      face-forward standard — **don't burn 3 weeks here.** Primary fallback is the
      existing `ArtistAvatar` initials; an initials plate on a vault card reads as
      an intentional library catalog card. If you want per-artist color, **self-host
      DiceBear `disco` as build-time-generated SVG** seeded from the slug,
      committed to `public/assets/artists/` — never a runtime API call, and
      **artist tiles only.** Track covers keep the portrait or the initials plate;
      swapping those for identicons is a downgrade from what `VaultCover` does.
- [ ] **5.6** Per-artist `tag` line — editorial, sells the archive framing.
- [ ] **5.7 Balance guardrail:** no artist above ~12% of the catalog. Charlie Puth
      is 34% today; harvester priority must be breadth-first.
- [ ] **5.8** Artist pages stay on-demand (`generateStaticParams → []`) so build
      time doesn't scale with the catalog. Prerender home + artists only.

---

## Phase 6 — Player stops feeling random

Diagnosed in code:
- `next()` (`:230`) and ENDED (`:334`) both do
  `Math.floor(Math.random() * q.length)` — a **fresh dice roll per skip**. Can
  replay the same song, can go backwards.
- ENDED **duplicates** `playQueue` inline instead of calling `next()`. Two paths,
  already drifted.
- `repeat` is 2-state. Should be off/all/one.
- `HomeClient.tsx:49` — clicking a rail card queues **all 288 songs**, not that rail.
- `ArtistClient` queues the *filtered* list → clearing search leaves a phantom queue.

- [x] **6.1** Real shuffle: shuffled **order array computed once per queue**
      (Fisher–Yates, seeded from queueKey so SSR and client agree), then walk it.
      Off by default, not persisted.
- [x] **6.2** ENDED calls `next()`. Delete the duplicated inline block.
- [x] **6.3** `repeat`: 3-state off → all → one.
- [x] **6.4** `next`/`prev` read `queueKey` from `live.current`, not the closure.
- [x] **6.5** **"Up next" queue panel.** The queue is currently invisible — that is
      *why* it feels random. Biggest missing Spotify affordance.
- [ ] **6.6** **Visible player on the turntable platter**, ≥200×200 viewport, and
      **delete `#yt-mount`**. The 1×1 `opacity: 0.001` player is a "background
      player not displayed in the page," which Dev Policies III.I.9 prohibits.
      Better design anyway — you see the video. `controls: 0` is a documented
      playerVar so hiding YouTube's controls is fine; overlaying *your own* UI on
      the player's pixels is not. Add `origin=` and
      `Referrer-Policy: strict-origin-when-cross-origin` (missing Referer = error 153).
- [x] **6.7** Rail cards queue *that rail's* list.
- [ ] **6.8** Volume control. `onReady` sets 85, `playSource` resets to 100.
- [ ] **6.9** Restore queue position on reload (only last song persists today).
- [ ] **6.10** `?` shortcuts overlay — Space/←/→/Esc exist and are undiscoverable.

---

## Phase 7 — Performance

- [ ] **7.1** Split `PlayerProvider` into 4 contexts: `TransportContext` (once
      per track), `ProgressContext` (the only 4Hz consumer), `PrefsContext`,
      `UIContext`. Today **every** `usePlayer()` consumer re-renders 4×/sec —
      including all 97 `TrackRow`s on `/artist/charlie-puth`.
- [ ] **7.2** `React.memo` `TrackRow`, `VersionRows`, `VaultCover`, `ArtistAvatar`.
- [ ] **7.3** Lazy-load the YT engine on first play. `iframe_api` + a third-party
      iframe currently load on *every* page including `/submit` and 404.
- [ ] **7.4** Stop mutating refs during render: `live.current` (`:125`),
      `toggleRef/nextRef/prevRef` (`:522–526`), `lastSongRef` (`:546`).
- [ ] **7.5** Stop writing `localStorage` inside state updater functions
      (`:291`, `:268`, `:175`) — idempotent-only under StrictMode today.
- [ ] **7.6** **Columnar manifest as a content-hashed static asset.** Home shows
      ~20 tracks but serializes 288 into client props. Measured for 3,000
      tracks: array-of-objects **33.8 KB** brotli → columnar **21.3 KB**, and it
      eliminates the RSC duplication. Content-hashed + `immutable` in `/public`,
      lazy-loaded on first play. **Not** a TS module (parsed by every visitor on
      every route). **Not** an API route (burns function invocations).
- [ ] **7.7** `next/image` for portraits — 12 files, 864KB unoptimized JPEG, no
      responsive sizes, no AVIF/WebP.
- [ ] **7.8** Remove the lucide runtime (9.7KB raw) from the shell — inline ~24 SVGs.
- [ ] **7.9** Dedupe `lib/vault.ts` + `lib/portraits.ts` — currently in 3 chunks.
- [ ] **7.10** Delete dead code: `preferredKey` (`:131`, unreachable → the whole
      `versionPrefs` state is write-only); `lib/utils.ts` dead shorts guard +
      duplicate bare-id regex.
- [ ] **7.11** Restore `document.title` on unmount (`:548` leaks across routes).
- [ ] **7.12** Fix `ArtistsForm` reading `data.artist.existing` when the handler
      returns `created` — the success message is always wrong.

**Targets:** LCP < 1.8s · INP < 200ms · CLS < 0.05 throttled mobile ·
Lighthouse 90+ ×4 · works with JS disabled · **100–150 KB gz first load**
(median mobile site ships 558 KB and still fails CWV).

---

## Phase 8 — Search + discovery

- [ ] **8.1** Build-time search artifact → content-hashed static asset.
- [ ] **8.2** **MiniSearch** (`fuzzy: 0.2`, `prefix: true`, `boost: {title: 3}`) in
      a **Web Worker**, loaded on first `⌘K`. Benchmarked at 3,000 records:
      5.9 KB gzip, 2.84 ms query, 1.74 ms typo.
      **Do not use Fuse.js** — no index, Bitap-scans every document per keystroke:
      **88 ms/query**, 13 dropped frames per keypress, guaranteed INP failure.
- [ ] **8.3** `⌘K` / `Ctrl+K` / `/` opens. `Esc` closes. `↑↓` + `Enter`. Focus trap
      + restore. `role="dialog"` + `aria-activedescendant`.
- [ ] **8.4** Grouped results: Tracks / Artists / Actions. Recent searches.
- [ ] **8.5** "No results for X → suggest it" → feeds ingest. Turns a dead-end
      search into catalog supply.
- [ ] **8.6** Keep a minimal inline input on mobile — ⌘K doesn't exist on phones.
- [ ] **8.7 /discover** — deterministic seeded rails, extending `lib/feed.ts`
      discipline (never `array.slice`, or SSG and hydration diverge):
      **Freshly surfaced** · **Unheard** · **Completion pressure** (your
      least-finished artist) · **Multi-version** (2+ takes) · **Era adjacency** ·
      **Long unheard**. Works with **zero accounts** — personalization from
      localStorage stats.
- [ ] **8.8 /today** — indexable, `daily` sitemap priority, own OG image.
- [ ] **8.9 Progress meter** on artist pages + home hero ("heard 12 of 97").
      Cheapest retention feature in the backlog.

---

## Phase 9 — Artist page

Current build already has hero card / play all / sort chips / rows. Real gaps at
88 artists:

- [ ] **9.1 Alphabetical index jump** — mandatory past ~50 tracks. Finding "1984"
      in a 97-row scroll is hopeless.
- [ ] **9.2** Sticky mini-header on scroll.
- [ ] **9.3 Measure before virtualizing.** ~300 DOM rows is borderline, and
      virtualized lists break Ctrl+F and hide off-screen rows from screen readers.
      If it's actually slow: `@tanstack/react-virtual` (8.1 KB, explicit React 19
      `useFlushSync: false` guidance). Not `react-virtuoso` (20.2 KB).
- [ ] **9.4 Archive stats block** — tracks · total runtime · years spanned ·
      versions · avg duration · last verified. Makes it feel like an archive.
- [ ] **9.5 "Not heard" filter** + progress meter.
- [ ] **9.6 "Recently added"** above the track list.
- [ ] **9.7 Per-artist share card** (`opengraph-image.tsx`) — currently hotlinks
      `i.ytimg.com`: no control, no branding, third-party dependency in the share path.
- [ ] **9.8 Verified timestamp** ("all 97 links verified 4h ago"). The best
      feature in the product is currently invisible.
- [ ] **9.9 Official releases block** — Spotify/Apple/Bandcamp. Adds outbound
      value and reduces the "only here for leaks" perception.
- [ ] **9.10 Mobile audit on a real 390px device.** `#app` is `100vh` +
      `overflow:hidden`; the rail collapses to 68px of icons at ≤900px, so 44px
      touch targets are living in a 68px rail.
- [ ] **9.11 A11y:** turntable and capsule are `role="button"` divs with no
      `tabIndex`; About modal has no focus trap/restore; collapsed-rail labels
      are CSS-only tooltips.

---

## Phase 10 — Legitimacy (small, but not optional)

Deliberately minimal. This is the one place I won't cut, because you asked for a
publishable site and this is what makes it publishable without becoming a
liability.

- [ ] **10.1 `/report` restored.** It returns 410 today — **you removed your
      takedown channel.** For an indexing site that's the largest legal exposure
      you have. Minimum viable: per-track **"hide this now"** (instant unlist),
      a DMCA contact, and auto-hide at 3 verified complaints.
- [ ] **10.2 `/about` rewritten** — what OUTTAKE is, that **you host nothing**,
      how verification works, that everything links to public YouTube uploads,
      takedown policy, rights-holder contact.
- [ ] **10.3** Song-page footer: *"Not hosted here. We link to a public YouTube
      upload. All rights belong to the rights holder."*
- [ ] **10.4** Name a DMCA agent. **Honor a valid notice by hiding content
      immediately**, not after deliberation.
- [ ] **10.5** Enforceable voice guard — `lib/copy.ts` banned-terms list
      (`grail`, `leak`, `rare`, `exclusive`, `authentic`) + a test scanning
      `app/**` and `components/**`.
- [ ] **10.6** Faster takedown SLA, no official-release affiliate, for
      higher-risk artists: Michael Jackson, MF DOOM, XXXTentacion, Pop Smoke,
      Capital STEEz.

---

## Phase 11 — Docs & open source

- [ ] **11.1 `README.md` rewrite.** It documents scripts that **no longer exist**
      (`fetch_artist_art.js`, `discover_youtube.js`, `db:verify`, `db:build`,
      `db:seed`, `refresh_songs.js`) and a report system you retired.
- [ ] **11.2** Delete or rewrite `RECOMMENDATIONS.md` (same staleness; also uses
      the banned word "grails"). Rewrite `SECURITY.md`.
- [ ] **11.3** `CONTRIBUTING.md` — how to add a track, what "verified" means, how
      to run the harvester, review criteria.
- [ ] **11.4** `CODE_OF_CONDUCT.md`, PR template, issue templates
      (`bug_report`, `track_submission`, `feature`). Keep MIT (code only).
- [ ] **11.5** Delete the untracked `stonk + poly/` folder (10 PNGs).
- [ ] **11.6** Open-source the harvester + prefilter + probe = **yes** —
      contributors bringing candidate IDs is the growth strategy.
      `scripts/artists.md` / `tracker-roster.md`: **check licensing first.**
- [ ] **11.7** Complete `scripts/portrait-credits.json` — 12 portrait files, only
      10 credited. `charlie-puth` and `the-weeknd` missing. Provenance must be
      complete before the repo is public.
- [ ] **11.8** CI smoke tests: `npm start` → assert `/api/health` 200, `/` renders,
      a known `/song/<id>` 200s, `/api/admin/pending` 401s without a bearer key.

---

## Sequencing

```
1  Trust layer        ← inverted verdict. Worst bugs in the repo.
2  Postgres only      ← deletes the bundle from the read path
3  Refresh finishes   ← freshness claim becomes true
4  Harvest pipeline   ← the lever
5  88 artists         ← breadth
6  Player             ← stops feeling random
7  Performance        ← 4Hz re-render is the whole app's bottleneck
8  Search + discover
9  Artist page
10 Legitimacy
11 Docs + OSS
```

**1 → 2 → 3 → 4 → 5 gets you 3,000 tracks. 6–9 makes them usable.**

---

## Hosting

**Vercel Pro $20/mo — required.** Hobby is *"restricted to non-commercial,
personal use only."* You're building a publishable public site.

- ISR storage is **unlimited**; the binding limit is **200k ISR writes/mo**.
- **ISR writes are ~0 if page output is deterministic** — Vercel: *"When
  revalidation runs and the content hasn't changed, no ISR write units are
  incurred."* This is why §6.1 seeds shuffle from queueKey and why `lib/feed.ts`
  uses day/week hashes: **it's a billing constraint, not just hydration.**
- **No `new Date()` or `Math.random()` anywhere in a rendered path.**

**Total: ~$21/mo** — Vercel Pro $20 + Neon free tier (1GB; 3,000 tracks ≈ 1.5MB)
+ Data API free + domain.

---

## Out of scope for now

Deliberately dropped, not forgotten. Revisit **after** ≥30 artists are live:
email/newsletter · accounts · payments · ad slots · analytics tooling ·
embeddable player · contributor credits · Next.js 16 upgrade (16 is Active LTS,
15 is Maintenance LTS; in 16 `middleware.ts` → `proxy.ts`, which touches auth).

Also still unanswered: **which repo did Amrit mean for SEO?**

---

## Definition of done

- [ ] Verdict mapping fixed; `unknown`/`blocked` states; dead-streak rule
- [ ] `onError` → DB verification live
- [ ] Postgres is the only source of truth; `catalog.json` gone from the runtime
- [ ] Refresh drains to `remaining: 0` in CI, visibly, with no starvation
- [ ] Harvester + candidates table; 8 Kanye playlists processed
- [ ] **≥30 artists, ≥1,000 tracks live**
- [ ] Shuffle is an order; Up Next visible; rail cards queue their own rail
- [ ] Visible player on the platter; no hidden player
- [ ] `⌘K` search; `/discover`; progress meters
- [ ] LCP < 1.8s, INP < 200ms, CLS < 0.05 throttled mobile, Lighthouse 90+ ×4
- [ ] Works with JS disabled; mobile audited on a 390px device
- [ ] `/about` + `/report` + DMCA contact published
- [ ] README/CONTRIBUTING/SECURITY accurate; repo public-ready
- [ ] Deterministic page output — zero ISR writes from unchanged revalidations